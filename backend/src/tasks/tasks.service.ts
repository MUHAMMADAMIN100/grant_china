import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ActivityService } from '../activity/activity.service';
import { isPrivileged } from '../common/roles';
import { notDeleted } from '../common/soft-delete';

type CurrentUser = { id: string; role: Role };

const TASK_INCLUDE = {
  assignedTo: { select: { id: true, fullName: true, email: true } },
  createdBy: { select: { id: true, fullName: true, email: true } },
} as const;

/** Внутренний контракт для системных (авто-созданных) задач — см. createSystemTask(). */
export interface SystemTaskInput {
  title: string;
  description: string;
  assignedToId: string;
  dueDate?: Date | null;
  /** Ключ идемпотентности, Task.originKey. Формат '<тип>:<id источника>'. */
  originKey: string;
}

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private mail: MailService,
    private realtime: RealtimeGateway,
    private activity: ActivityService,
  ) {}

  async create(dto: CreateTaskDto, user: CurrentUser) {
    if (!isPrivileged(user.role)) {
      throw new ForbiddenException('Только Основатель или администратор может создавать задачи');
    }
    const assignee = await this.prisma.user.findUnique({ where: { id: dto.assignedToId } });
    if (!assignee) throw new NotFoundException('Сотрудник не найден');

    const task = await this.prisma.task.create({
      data: {
        title: dto.title.trim(),
        description: dto.description.trim(),
        assignedToId: dto.assignedToId,
        createdById: user.id,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
      include: TASK_INCLUDE,
    });

    // In-app уведомление назначенному сотруднику
    await this.notifications.notifyUser(assignee.id, {
      type: 'TASK_ASSIGNED',
      title: 'Новая задача',
      message: task.title,
      payload: { taskId: task.id },
    });

    // Email сотруднику
    this.mail
      .send(
        assignee.email,
        `Новая задача: ${task.title}`,
        `<h2>Вам назначена новая задача</h2>
         <p><b>${task.title}</b></p>
         <p style="white-space: pre-wrap">${task.description}</p>
         <p style="color:#666; font-size: 13px">Откройте CRM, чтобы начать выполнение.</p>`,
      )
      .catch(() => undefined);

    // Проблема B аудита: раньше сюда летела вся `task` (в т.ч. email
    // assignedTo/createdBy) — Tasks.tsx на любое task:* просто
    // перезапрашивает список по HTTP (findAll уже фильтрует по правам).
    this.realtime.emitAllStaff('task:new', { id: task.id });
    // notifyUser() выше уже отправил 'notification:new' в user-room
    // назначенного сотрудника — второй, дублирующий emit убран.

    // Раздел 6.3 ТЗ (волна 4): раньше РУЧНОЕ создание задачи не попадало в
    // журнал вообще (в отличие от TASK_AUTO_CREATE у системных задач) —
    // Основатель не видел в «Активности», кто и когда завёл задачу вручную.
    // studentId у Task нет (общая таблица задач, не привязанная к студенту) —
    // так же, как у TASK_AUTO_CREATE ниже.
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'TASK_CREATE',
        details: `Создана задача «${task.title}» для ${assignee.fullName}`,
      })
      .catch(() => undefined);

    return task;
  }

  async findAll(filters: {
    mine?: boolean;
    currentUserId: string;
    role: Role;
    search?: string;
    /** ТЗ 3.2 — «мои задачи по срокам» / общий список «ближайшие сроки». */
    dueFrom?: Date;
    dueTo?: Date;
    /** true — только просроченные незакрытые (dueDate < now, status !== DONE). */
    overdue?: boolean;
  }) {
    const baseWhere: any =
      isPrivileged(filters.role) && !filters.mine
        ? { ...notDeleted }
        : { assignedToId: filters.currentUserId, ...notDeleted };
    const and: Prisma.TaskWhereInput[] = [];
    const search = (filters.search || '').trim();
    if (search) {
      and.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
        ],
      });
    }
    if (filters.dueFrom || filters.dueTo) {
      const dueDate: Prisma.DateTimeNullableFilter = {};
      if (filters.dueFrom) dueDate.gte = filters.dueFrom;
      if (filters.dueTo) dueDate.lte = filters.dueTo;
      and.push({ dueDate });
    }
    if (filters.overdue) {
      and.push({ dueDate: { lt: new Date() }, status: { not: TaskStatus.DONE } });
    }
    const where: Prisma.TaskWhereInput = and.length ? { ...baseWhere, AND: and } : baseWhere;
    return this.prisma.task.findMany({
      where,
      // Незакрытые сверху, внутри — по ближайшему сроку (без срока — в конце),
      // затем по дате создания. См. индекс [assignedToId, status, dueDate].
      orderBy: [{ status: 'asc' }, { dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      include: TASK_INCLUDE,
    });
  }

  /**
   * `user` передаётся только из контроллера. Без него findOne используют
   * внутренние вызовы (update/remove), которые сами проверяют права ПОСЛЕ
   * чтения — сохраняем их прежние коды/тексты ошибок (403).
   */
  async findOne(id: string, user?: CurrentUser) {
    // findFirst, а не findUnique: soft-delete фильтр (deletedAt: null) —
    // не уникальное поле, findUnique его не принимает в `where`.
    const task = await this.prisma.task.findFirst({ where: { id, ...notDeleted }, include: TASK_INCLUDE });
    if (!task) throw new NotFoundException('Задача не найдена');
    // IDOR: любой EMPLOYEE мог прочитать чужую задачу по UUID, зная только
    // GET /tasks/:id. Видеть задачу может привилегированный пользователь,
    // назначенный исполнитель или её автор. 404 (не 403) — чтобы ответ не
    // работал как оракул существования id.
    if (user && !isPrivileged(user.role) && task.assignedToId !== user.id && task.createdById !== user.id) {
      throw new NotFoundException('Задача не найдена');
    }
    return task;
  }

  async update(id: string, dto: UpdateTaskDto, user: CurrentUser) {
    const task = await this.findOne(id);
    const isOwner = task.assignedToId === user.id;
    if (!isPrivileged(user.role) && !isOwner) {
      throw new ForbiddenException('Вы не можете редактировать эту задачу');
    }
    // Сотрудник не может переназначать задачу — только Основатель/администратор
    if (!isPrivileged(user.role) && dto.assignedToId !== undefined) {
      throw new ForbiddenException('Только Основатель или администратор может переназначать задачу');
    }
    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.assignedToId !== undefined ? { assignedToId: dto.assignedToId } : {}),
        ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null } : {}),
      },
      include: TASK_INCLUDE,
    });
    this.realtime.emitAllStaff('task:updated', { id: updated.id });
    return updated;
  }

  async remove(id: string, user: CurrentUser) {
    if (!isPrivileged(user.role)) {
      throw new ForbiddenException('Только Основатель или администратор может удалять задачи');
    }
    await this.findOne(id);
    // Проблема 11 аудита волны 1: раньше здесь было prisma.task.delete() —
    // единственное физическое удаление во всём проекте, нарушение правила
    // №1 (никогда не удалять данные). Soft-delete: помечаем deletedAt,
    // findAll/findOne/stats фильтруют deletedAt: null.
    await this.prisma.task.update({ where: { id }, data: { deletedAt: new Date() } });
    this.realtime.emitAllStaff('task:deleted', { id });
    return { ok: true };
  }

  async stats(user: CurrentUser) {
    const where = isPrivileged(user.role) ? { ...notDeleted } : { assignedToId: user.id, ...notDeleted };
    const [total, todo, inProgress, done] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.count({ where: { ...where, status: TaskStatus.TODO } }),
      this.prisma.task.count({ where: { ...where, status: TaskStatus.IN_PROGRESS } }),
      this.prisma.task.count({ where: { ...where, status: TaskStatus.DONE } }),
    ]);
    return { total, todo, inProgress, done };
  }

  // ------------------------------------------------------------------
  // Внутренний контракт для других модулей (ТЗ 3.2 + волна 4). НЕ выставлен
  // по HTTP. Единственная точка, через которую ConsultationsModule и
  // SchedulerModule создают/переносят/гасят задачи — прямой доступ к
  // prisma.task из них запрещён архитектурой (см. apiSurface проекта).
  // ------------------------------------------------------------------

  /**
   * Идемпотентное создание системной задачи. createdById = null («задача от
   * системы»), без ролевой проверки — вызывающий код (консультация,
   * планировщик) уже прошёл свою собственную авторизацию.
   *
   * Идемпотентность — паттерн A (UNIQUE-INSERT, см. scheduler/job.contract.ts):
   * Task.originKey уникален в БД, поэтому гонка двух одновременных вызовов
   * (два инстанса Railway, повторный тик планировщика) арбитрируется самой
   * базой — второй INSERT падает с P2002, мы ловим её и возвращаем уже
   * существующую задачу вместо дубля.
   */
  async createSystemTask(input: SystemTaskInput) {
    const assignee = await this.prisma.user.findFirst({ where: { id: input.assignedToId, deletedAt: null } });
    if (!assignee) {
      // Не глотаем молча: отсутствие валидного исполнителя — ошибка
      // вызывающего кода (например менеджер консультации был уволен между
      // выбором в форме и сохранением), а не ожидаемая гонка.
      throw new NotFoundException('Исполнитель системной задачи не найден');
    }

    let task;
    try {
      task = await this.prisma.task.create({
        data: {
          title: input.title.trim(),
          description: input.description.trim(),
          assignedToId: input.assignedToId,
          createdById: null,
          dueDate: input.dueDate ?? null,
          originKey: input.originKey,
        },
        include: TASK_INCLUDE,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.task.findUnique({
          where: { originKey: input.originKey },
          include: TASK_INCLUDE,
        });
        if (existing) return existing;
      }
      throw e;
    }

    await this.notifications.notifyUser(assignee.id, {
      type: 'TASK_ASSIGNED',
      title: 'Новая задача',
      message: task.title,
      payload: { taskId: task.id },
    });
    this.mail
      .send(
        assignee.email,
        `Новая задача: ${task.title}`,
        `<h2>Вам назначена новая задача</h2>
         <p><b>${task.title}</b></p>
         <p style="white-space: pre-wrap">${task.description}</p>
         <p style="color:#666; font-size: 13px">Откройте CRM, чтобы начать выполнение.</p>`,
      )
      .catch(() => undefined);
    this.realtime.emitAllStaff('task:new', { id: task.id });

    // Раздел 9 требований волны 3: автосоздание задачи планировщиком (и, в
    // этой волне, консультациями) обязано попадать в журнал — иначе
    // Основатель не отличит "система создала задачу" от "кто-то создал её
    // от имени системы". actorId: null — действие не от конкретного
    // человека (та же семантика, что у createdById: null на самой задаче).
    this.activity
      .log({
        actorId: null,
        actorName: 'Система',
        actorRole: 'SYSTEM',
        action: 'TASK_AUTO_CREATE',
        details: `Автоматически создана задача «${task.title}» для ${assignee.fullName} (${input.originKey})`,
      })
      .catch(() => undefined);

    return task;
  }

  /**
   * Пересинхронизация системной задачи по originKey — например перенос даты
   * повторного звонка на консультации (ТЗ 3.2). Явное действие ПОЛЬЗОВАТЕЛЯ
   * (не планировщика), поэтому если задача была soft-удалена — ВОСКРЕШАЕМ её
   * (риск 9 проекта архитектора: наивный create упал бы на P2002, и менеджер
   * молча остался бы без напоминания). Планировщик этот метод не вызывает —
   * для него «занятый ключ» означает «пользователь уже разобрался с этим».
   */
  async upsertSystemTask(input: SystemTaskInput) {
    const existing = await this.prisma.task.findUnique({ where: { originKey: input.originKey } });
    if (!existing) {
      return this.createSystemTask(input);
    }

    const assignee = await this.prisma.user.findFirst({ where: { id: input.assignedToId, deletedAt: null } });
    if (!assignee) {
      throw new NotFoundException('Исполнитель системной задачи не найден');
    }

    const wasDeleted = Boolean(existing.deletedAt);
    const updated = await this.prisma.task.update({
      where: { id: existing.id },
      data: {
        title: input.title.trim(),
        description: input.description.trim(),
        assignedToId: input.assignedToId,
        dueDate: input.dueDate ?? null,
        deletedAt: null,
        // Воскрешаем всегда в TODO — если задача была удалена, её прежний
        // статус не имеет смысла; если не была удалена, status не трогаем.
        ...(wasDeleted ? { status: TaskStatus.TODO } : {}),
      },
      include: TASK_INCLUDE,
    });

    if (wasDeleted) {
      // Менеджер потерял видимость задачи (она была скрыта как удалённая) —
      // сообщаем заново теми же каналами, что и при первом создании.
      await this.notifications.notifyUser(assignee.id, {
        type: 'TASK_ASSIGNED',
        title: 'Задача восстановлена',
        message: updated.title,
        payload: { taskId: updated.id },
      });
      this.realtime.emitAllStaff('task:new', { id: updated.id });
    } else {
      this.realtime.emitAllStaff('task:updated', { id: updated.id });
    }
    return updated;
  }

  /**
   * Гасит системную задачу по originKey, ЕСЛИ она ещё не взята в работу
   * (TODO). Используется при отмене повторного звонка / удалении
   * консультации — иначе у менеджера навсегда остаётся фантомное напоминание
   * позвонить в никуда (риск 10 проекта архитектора). Если задача уже
   * IN_PROGRESS/DONE — оставляем как есть: менеджер уже что-то с ней сделал,
   * решение отменять её или нет должно быть его, а не автоматическим.
   */
  async softDeleteSystemTaskIfPending(originKey: string): Promise<void> {
    const task = await this.prisma.task.findUnique({ where: { originKey } });
    if (!task || task.deletedAt || task.status !== TaskStatus.TODO) return;
    const result = await this.prisma.task.updateMany({
      where: { id: task.id, status: TaskStatus.TODO, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count > 0) {
      this.realtime.emitAllStaff('task:deleted', { id: task.id });
    }
  }
}
