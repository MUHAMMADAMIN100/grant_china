import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma, Region, Role } from '@prisma/client';
import { containsInsensitive } from '../common/search';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { notDeleted, tombstoneEmail } from '../common/soft-delete';
import { invalidateUserCache } from '../auth/jwt.strategy';
import { ActivityService } from '../activity/activity.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

// Подписи ролей для человекочитаемого журнала (ActivityLog.details) — та же
// терминология, что в UI (frontend-crm/src/api/types.ts): в БД EMPLOYEE не
// переименовываем, меняется только подпись.
const ROLE_LABEL: Record<Role, string> = {
  FOUNDER: 'Основатель',
  ADMIN: 'Администратор',
  EMPLOYEE: 'Менеджер',
};

// ТЗ v3 раздел 4 — подписи регионов для журнала. Совпадают с
// frontend-crm/src/api/types.ts REGION_LABEL.
const REGION_LABEL: Record<Region, string> = {
  TJ: 'Таджикистан',
  CN: 'Китай',
  BOTH: 'Оба региона',
};

type Actor = { id: string; role: Role };

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private realtime: RealtimeGateway,
  ) {}

  async findAll(filters: { search?: string } = {}) {
    const search = (filters.search || '').trim();
    const where: any = { ...notDeleted };
    if (search) {
      where.OR = [
        { email: containsInsensitive(search) },
        { fullName: containsInsensitive(search) },
      ];
    }
    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, fullName: true, role: true, region: true, createdAt: true },
    });
    return users;
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, ...notDeleted },
      select: { id: true, email: true, fullName: true, role: true, region: true, createdAt: true },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return user;
  }

  /** Без выкидывания исключения — для проверок в контроллере. */
  async findOneRaw(id: string) {
    return this.prisma.user.findFirst({
      where: { id, ...notDeleted },
      select: { id: true, role: true },
    });
  }

  /**
   * Проверяет, что после операции над пользователем `id` в системе останется
   * хотя бы один Основатель — и делает это АТОМАРНО с самой операцией.
   *
   * Раньше проверка жила в контроллере отдельным запросом, а запись шла
   * следующим. Между ними помещался второй такой же запрос: два Основателя
   * одновременно понижают друг друга, оба видят founderCount = 2, оба проходят
   * проверку — и в системе не остаётся ни одного FOUNDER. Управлять ролями
   * становится некому, чинится только прямым доступом к БД.
   *
   * Serializable здесь уместен: смена ролей — редкая операция, а Read Committed
   * (умолчание Postgres) от этой гонки не спасает — обе транзакции читают
   * снимок до чужой записи. При конфликте Postgres откатит одну из них,
   * и пользователь просто повторит действие.
   */
  private async withLastFounderGuard<T>(
    targetId: string,
    action: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        const target = await tx.user.findFirst({
          where: { id: targetId, ...notDeleted },
          select: { role: true },
        });
        if (target?.role === Role.FOUNDER) {
          const founderCount = await tx.user.count({
            where: { role: Role.FOUNDER, ...notDeleted },
          });
          if (founderCount <= 1) {
            throw new ForbiddenException(
              'Нельзя убрать последнего Основателя. Сначала назначьте другого.',
            );
          }
        }
        return action(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** Количество пользователей с указанной ролью (для защиты "последнего FOUNDER"). */
  async countByRole(role: 'FOUNDER' | 'ADMIN' | 'EMPLOYEE') {
    return this.prisma.user.count({ where: { role, ...notDeleted } });
  }

  async create(dto: CreateUserDto, actor: Actor) {
    const email = (dto.email || '').trim().toLowerCase();
    const rawPassword = (dto.password || '').trim();

    // Проверяем уникальность среди НЕ-удалённых. Удалённые с этим email
    // имеют tombstone-email вида `<email>.deleted.<ts>`, так что не блокируют.
    const exists = await this.prisma.user.findFirst({ where: { email, ...notDeleted } });
    if (exists) throw new ConflictException('Email уже занят');

    const password = await bcrypt.hash(rawPassword, 10);
    const user = await this.prisma.user.create({
      // region не передаём, если клиент его не прислал — пусть сработает
      // @default(BOTH) из схемы, а не наше представление о «правильном»
      // значении по умолчанию, разъехавшееся с БД.
      data: { email, password, fullName: dto.fullName, role: dto.role, ...(dto.region ? { region: dto.region } : {}) },
      select: { id: true, email: true, fullName: true, role: true, region: true, createdAt: true },
    });

    // 2.12 ТЗ: кадровое событие — Основатель должен видеть в журнале, кто и
    // когда завёл нового сотрудника и с какой ролью.
    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'USER_CREATE',
        details: `Создан сотрудник: ${user.fullName} (${user.email}), роль: ${ROLE_LABEL[user.role]}`,
        payload: { userId: user.id },
      })
      .catch(() => undefined);

    // emitAllStaff: раздел «Пользователи» к студенту не привязан, резать
    // рассылку по региону не по чему. В payload только id — ФИО, почту и роль
    // фронт возьмёт по HTTP, где @Roles(FOUNDER, ADMIN) отсечёт остальных.
    this.realtime.emitAllStaff('user:updated', { id: user.id });
    return user;
  }

  async update(id: string, dto: UpdateUserDto, actor: Actor) {
    const existing = await this.findOne(id);
    const data: any = {};
    // DTO уже tримит/лоуэркейсит через @Transform — здесь повторно
    // нормализуем только как страховка (на случай если кто-то когда-то
    // вызовет сервис не через HTTP-pipeline, например из тестов или сидера).
    if (dto.email) data.email = dto.email.trim().toLowerCase();
    if (dto.fullName) data.fullName = dto.fullName.trim();
    if (dto.role) data.role = dto.role;
    if (dto.region) data.region = dto.region;

    let passwordToVerify: string | null = null;
    if (dto.password) {
      const trimmed = dto.password.trim();
      data.password = await bcrypt.hash(trimmed, 10);
      passwordToVerify = trimmed;
    }

    // Понижение роли проверяем и пишем в одной транзакции — иначе два
    // одновременных понижения оставляют систему без Основателя (см.
    // withLastFounderGuard). Смена только email/имени/пароля роль не трогает,
    // поэтому guard применяем лишь когда роль реально уводится с FOUNDER.
    const demotesFounder = !!dto.role && dto.role !== Role.FOUNDER;
    const runUpdate = (tx: Prisma.TransactionClient | PrismaService) =>
      tx.user.update({
        where: { id },
        data,
        // Включаем password в результат ТОЛЬКО для self-проверки ниже,
        // потом скрываем перед возвратом клиенту.
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          region: true,
          createdAt: true,
          password: passwordToVerify ? true : false,
        } as any,
      });

    const user = demotesFounder
      ? await this.withLastFounderGuard(id, runUpdate)
      : await runUpdate(this.prisma);

    // Sanity-check: если пользователь сменил пароль — сразу проверяем что
    // bcrypt.compare с тем же паролем даёт true. Если нет — значит запись
    // в БД не сохранилась корректно (transaction issue, пишущий триггер,
    // и т.п.). Тогда явно бросаем ошибку, чтобы admin увидел проблему,
    // а не получил ложный «успех».
    if (passwordToVerify) {
      const stored = (user as any).password as string | undefined;
      const ok = stored ? await bcrypt.compare(passwordToVerify, stored) : false;
      if (!ok) {
        this.logger.error(
          `Password verify failed after update for user ${id} — stored hash does not match the new password`,
        );
        throw new InternalServerErrorException(
          'Не удалось сохранить новый пароль. Попробуйте ещё раз.',
        );
      }
      this.logger.log(`Password updated and verified for user ${id} (${user.email})`);
    }

    // БАГ 4 аудита: если роль сменилась — сбрасываем кэш JwtStrategy, иначе
    // до 30 секунд у пользователя ещё будет действовать старая роль во всех
    // проверках прав (см. auth/jwt.strategy.ts).
    //
    // Регион (ТЗ v3 р4) лежит в том же кэше и по той же причине требует сброса:
    // без него менеджер до 30 секунд продолжал бы видеть студентов страны, из
    // которой его только что убрали.
    if (dto.role || dto.region) invalidateUserCache(id);

    // Смена региона — тоже кадровое событие: она меняет, каких студентов
    // сотрудник видит и по каким может проводить платежи.
    if (dto.region && dto.region !== (existing as any).region) {
      this.activity
        .log({
          actorId: actor.id,
          actorRole: actor.role,
          action: 'USER_REGION_CHANGE',
          details: `${user.fullName} (${user.email}): регион ${REGION_LABEL[(existing as any).region as Region] ?? '—'} → ${REGION_LABEL[dto.region]}`,
          payload: { userId: id, before: (existing as any).region, after: dto.region },
        })
        .catch(() => undefined);
    }

    // 2.12 ТЗ: кадровое событие — смена роли сотрудника обязана попасть в
    // журнал Основателя. Пишем только если роль реально изменилась (PATCH
    // мог прийти с тем же значением role, например при правке email/пароля).
    if (dto.role && dto.role !== existing.role) {
      this.activity
        .log({
          actorId: actor.id,
          actorRole: actor.role,
          action: 'USER_ROLE_CHANGE',
          details: `${user.fullName} (${user.email}): роль ${ROLE_LABEL[existing.role]} → ${ROLE_LABEL[dto.role]}`,
          payload: { userId: id, before: existing.role, after: dto.role },
        })
        .catch(() => undefined);
    }

    // Скрываем password из ответа клиенту
    // Событие ПОСЛЕ всех проверок и записи. Уйди оно раньше — сорванная
    // транзакция (например, guard последнего Основателя) обновила бы список
    // у всех при неизменившейся базе.
    this.realtime.emitAllStaff('user:updated', { id });
    const { password: _omit, ...safe } = user as any;
    return safe;
  }

  /**
   * Soft delete: помечаем deletedAt = now() и переименовываем email через
   * tombstone, чтобы освободить адрес для возможного нового сотрудника.
   * Физически из БД ничего НЕ удаляется — данные можно восстановить (FOUNDER
   * выставит deletedAt = null и вернёт оригинальный email).
   */
  async remove(id: string, actor: Actor) {
    const existing = await this.findOne(id);
    // Проверка «не последний Основатель» и запись — атомарно, как в update():
    // два одновременных увольнения Основателей оба видели бы count = 2.
    await this.withLastFounderGuard(id, (tx) =>
      tx.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          email: tombstoneEmail(existing.email),
        },
      }),
    );
    this.logger.log(`User ${id} (${existing.email}) soft-deleted`);
    // БАГ 4 аудита: сбрасываем кэш роли сразу, иначе уволенный сотрудник
    // ещё до 30 секунд может ходить с валидным токеном (см. jwt.strategy.ts).
    invalidateUserCache(id);

    // 2.12 ТЗ: кадровое событие — увольнение сотрудника должно попасть в
    // журнал Основателя. existing.email — оригинальный адрес ДО tombstone.
    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'USER_DELETE',
        details: `Удалён сотрудник: ${existing.fullName} (${existing.email}), роль: ${ROLE_LABEL[existing.role]}`,
        payload: { userId: id },
      })
      .catch(() => undefined);

    this.realtime.emitAllStaff('user:updated', { id });
    return { ok: true };
  }
}
