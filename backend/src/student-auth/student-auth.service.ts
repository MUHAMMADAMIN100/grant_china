import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ActivityService } from '../activity/activity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { STUDENT_RESTRICTED_DOC_TYPES } from '../common/access';
import { MANAGED_DOCUMENT_TYPES } from '../common/documents';

function generatePassword(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// Soft-delete: при include'ах не подтягиваем удалённые документы/заявки.
//
// ВНИМАНИЕ на природу `include`: перечисляются здесь только СВЯЗИ, а все
// скалярные поля Student Prisma отдаёт автоматически. Поэтому связями (а не
// скалярами) сознательно сделаны гранты, договоры и билеты — чтобы они сюда
// не попали, см. комментарии в schema.prisma.
//
// Раздел 5 ТЗ — visaReceived / visaReceivedAt заведены скалярами ИМЕННО
// поэтому: по ТЗ индикатор статуса визы обязан быть в личном кабинете, то
// есть попадание в этот ответ — не утечка, а требование. Ничего чувствительного
// в них нет (два состояния «Да/Нет» и дата отметки), password по-прежнему
// вырезается ниже в me().
const STUDENT_INCLUDE = {
  // MANAGED_DOCUMENT_TYPES — чеки платежей (payments/) и файлы билетов
  // (tickets/) не должны попадать в личный кабинет студента: это документы
  // сотрудника, живущие в своих разделах CRM. См. также
  // STUDENT_RESTRICTED_DOC_TYPES в common/access.ts.
  documents: { where: { deletedAt: null, type: { notIn: MANAGED_DOCUMENT_TYPES } } },
  manager: { select: { id: true, fullName: true, email: true } },
  chinaManager: { select: { id: true, fullName: true, email: true } },
  applications: {
    where: { deletedAt: null },
    select: { id: true, status: true, createdAt: true },
  },
} as const;

// STUDENT_RESTRICTED_DOC_TYPES (BANK/MEDICAL) вынесен в common/access.ts —
// Мы зануляем поле `url` в ответе /me и добавляем флаг `restricted`,
// чтобы фронт мог скрыть ссылку (при этом счётчик «загружено» и метка
// «прикреплено» остаются — студент видит что файл получен).
function sanitizeStudentDocuments<T extends { type: string; url: string }>(
  docs: T[],
): (T & { restricted?: boolean })[] {
  return docs.map((d) => {
    if (STUDENT_RESTRICTED_DOC_TYPES.has(d.type)) {
      return { ...d, url: '', restricted: true };
    }
    return d;
  });
}

@Injectable()
export class StudentAuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private mail: MailService,
    // 26.08.2026 — отметка о визе из кабинета: журнал, уведомление
    // менеджеру, realtime в CRM.
    private activity: ActivityService,
    private notifications: NotificationsService,
    private realtime: RealtimeGateway,
  ) {}

  /**
   * Сбрасывает пароль студента и отправляет новый на email.
   * Возвращает {ok:true} независимо от того, существует ли email — чтобы
   * злоумышленник не мог по ответу узнать, зарегистрирован ли email.
   */
  async forgotPassword(emailRaw: string) {
    if (!emailRaw) throw new BadRequestException('Укажите email');
    const email = emailRaw.trim().toLowerCase();
    // Soft-delete: удалённого студента не реактивируем через forgot-password.
    const student = await this.prisma.student.findFirst({ where: { email, deletedAt: null } });
    if (!student) {
      // Молчим (anti-enumeration). Возвращаем тот же ответ.
      return { ok: true };
    }
    if (student.status === 'ARCHIVED') {
      // Аккаунт в архиве — не сбрасываем
      return { ok: true };
    }
    const newPassword = generatePassword(8);
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.student.update({
      where: { id: student.id },
      data: { password: passwordHash },
    });
    // Отправляем письмо со ссылкой и новым паролем
    const loginUrl = process.env.STUDENT_LOGIN_URL || 'https://grantchina.tj/login';
    this.mail
      .send(
        student.email!,
        'GrantChina — новый пароль для входа в кабинет',
        `<p>Здравствуйте, <b>${student.fullName}</b>!</p>
         <p>Вы запросили сброс пароля. Ваш новый пароль:</p>
         <p style="font-size:18px;font-weight:bold;letter-spacing:1px;">${newPassword}</p>
         <p>Войдите в личный кабинет: <a href="${loginUrl}">${loginUrl}</a></p>
         <p>Если вы не запрашивали смену пароля — обратитесь к менеджеру GrantChina.</p>`,
      )
      .catch(() => undefined);
    return { ok: true };
  }

  async login(email: string, password: string) {
    if (!email || !password) {
      throw new BadRequestException('Укажите email и пароль');
    }
    const normalized = email.trim().toLowerCase();
    // Soft-delete: удалённый студент не может войти.
    const student = await this.prisma.student.findFirst({
      where: { email: normalized, deletedAt: null },
    });
    if (!student || !student.password) {
      throw new UnauthorizedException('Неверный email или пароль');
    }
    const ok = await bcrypt.compare(password, student.password);
    if (!ok) throw new UnauthorizedException('Неверный email или пароль');
    if (student.status === 'ARCHIVED') {
      throw new UnauthorizedException('Ваш аккаунт в архиве. Обратитесь к менеджеру.');
    }
    const token = await this.jwt.signAsync({
      sub: student.id,
      email: student.email,
      role: 'STUDENT',
    });
    return {
      token,
      student: {
        id: student.id,
        email: student.email,
        fullName: student.fullName,
      },
    };
  }

  async me(studentId: string) {
    // Soft-delete: удалённый студент получает 401 при попытке зайти
    // в кабинет (даже с валидным JWT).
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      include: STUDENT_INCLUDE,
    });
    if (!student) throw new UnauthorizedException('Студент не найден');
    // include на верхнеуровневой модели тянет ВСЕ её скаляры — поэтому каждое
    // новое поле Student по умолчанию уезжает студенту, и вырезать лишнее
    // приходится здесь явно. Так когда-то утёк bcrypt-хэш пароля.
    //
    // phoneSearch — служебная строка для поиска по телефону (см. common/phone.ts).
    // Никакой новой информации студенту она не даёт: это цифры его же номера,
    // который тут же лежит в поле phones. Но в контракте API её быть не должно:
    // фронтенд её не читает (проверено по собранным бандлам), а формат поля
    // служебный и может измениться — тогда утечка станет настоящей, причём
    // незаметно.
    const { password, phoneSearch, ...safe } = student as any;
    // Скрываем URL BANK/MEDICAL — студент не должен их скачивать.
    if (safe.documents) {
      safe.documents = sanitizeStudentDocuments(safe.documents);
    }
    return safe;
  }

  // ------------------------------------------------------------------
  // 26.08.2026 — отметка о визе от студента (на подтверждение менеджеру)
  // ------------------------------------------------------------------

  private async loadForVisaClaim(studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        managerId: true,
        chinaManagerId: true,
        visaReceived: true,
        visaClaimReceived: true,
        visaClaimedAt: true,
        visaClaimReviewedAt: true,
      },
    });
    if (!student) throw new UnauthorizedException('Студент не найден');
    return student;
  }

  /**
   * Студент отмечает «визу получил» / «визы ещё нет». Флаг visaReceived НЕ
   * меняется — отметка уходит менеджеру на подтверждение (решение
   * заказчика). Повторная подача той же отметки поверх ожидающей — не
   * ошибка ввода, а лишний клик: отвечаем понятным 400, а не дублируем
   * уведомление менеджеру.
   */
  async claimVisa(studentId: string, received: boolean) {
    const student = await this.loadForVisaClaim(studentId);
    const pending = !!student.visaClaimedAt && !student.visaClaimReviewedAt;
    if (pending && student.visaClaimReceived === received) {
      throw new BadRequestException('Эта отметка уже отправлена и ждёт проверки менеджера');
    }
    if (!pending && student.visaReceived === received) {
      throw new BadRequestException(
        received ? 'В системе уже отмечено, что виза получена' : 'В системе и так отмечено, что визы ещё нет',
      );
    }
    const updated = await this.prisma.student.update({
      where: { id: studentId },
      data: {
        visaClaimReceived: received,
        visaClaimedAt: new Date(),
        visaClaimReviewedAt: null,
        visaClaimApproved: null,
        visaClaimNote: null,
      },
      select: { id: true, managerId: true, chinaManagerId: true },
    });
    const label = received ? 'визу получил' : 'визы ещё нет';
    this.activity
      .log({
        actorId: null,
        actorName: student.fullName,
        actorRole: 'STUDENT',
        action: 'VISA_CLAIM',
        studentId,
        studentName: student.fullName,
        details: `Студент отметил: «${label}» — ждёт подтверждения менеджера`,
      })
      .catch(() => undefined);
    this.notifications
      .notifyForStudent(updated, {
        type: 'VISA_CLAIM',
        title: 'Студент отметил визу',
        message: `${student.fullName}: «${label}». Ждёт подтверждения.`,
        payload: { studentId },
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(updated, 'student:updated', { studentId }, { studentId });
    return { ok: true };
  }

  /** Отозвать ожидающую отметку. Менеджер уведомления об отзыве не получает — просто перестаёт видеть запрос. */
  async withdrawVisaClaim(studentId: string) {
    const student = await this.loadForVisaClaim(studentId);
    const pending = !!student.visaClaimedAt && !student.visaClaimReviewedAt;
    if (!pending) throw new BadRequestException('Нет отметки, ожидающей проверки');
    const updated = await this.prisma.student.update({
      where: { id: studentId },
      data: { visaClaimReceived: null, visaClaimedAt: null },
      select: { id: true, managerId: true, chinaManagerId: true },
    });
    this.activity
      .log({
        actorId: null,
        actorName: student.fullName,
        actorRole: 'STUDENT',
        action: 'VISA_CLAIM',
        studentId,
        studentName: student.fullName,
        details: 'Студент отозвал отметку о визе',
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(updated, 'student:updated', { studentId }, { studentId });
    return { ok: true };
  }

  /** 07.09.2026 — токен прямой загрузки для кабинета, см. AuthService.issueUploadToken. */
  async issueUploadToken(studentId: string) {
    const student = await this.prisma.student.findFirst({ where: { id: studentId, deletedAt: null }, select: { id: true, email: true } });
    if (!student) throw new UnauthorizedException('Студент не найден');
    const token = await this.jwt.signAsync({ sub: student.id, email: student.email, role: 'STUDENT', scope: 'upload' }, { expiresIn: '10m' });
    return { token, expiresIn: 600 };
  }
}
