import { Injectable } from '@nestjs/common';
import { Notification, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { notDeleted } from '../common/soft-delete';
import { canAccessStudentRecord } from '../common/access';
import { isPrivileged } from '../common/roles';

interface NotifyPayload {
  type: string;
  title: string;
  message: string;
  payload?: any;
}

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService, private realtime: RealtimeGateway) {}

  /**
   * Уведомление об изменении студента. Получатели — ТОЛЬКО назначенные
   * менеджеры этого студента плюс FOUNDER/ADMIN (им нужно видеть всё для
   * контроля). Раньше это была notifyAllStaff() — уведомление (ФИО студента
   * + дифф изменённых полей, включая телефоны/email) КАЖДОМУ сотруднику
   * компании, независимо от того, назначен он на этого студента или нет
   * (Проблема C аудита волны 1: рядовой менеджер собирал оттуда телефоны/
   * email/UUID чужих студентов, просто читая свой колокольчик).
   */
  async notifyForStudent(
    student: { managerId: string | null; chinaManagerId?: string | null },
    data: NotifyPayload,
  ) {
    const adminFounders = await this.prisma.user.findMany({
      where: { role: { in: ['FOUNDER', 'ADMIN'] }, ...notDeleted },
      select: { id: true },
    });

    // dedup через Set: managerId/chinaManagerId могут совпадать с FOUNDER/ADMIN
    const recipientIds = new Set<string>(adminFounders.map((u) => u.id));
    if (student.managerId) recipientIds.add(student.managerId);
    if (student.chinaManagerId) recipientIds.add(student.chinaManagerId);
    if (recipientIds.size === 0) return;

    // Уволенные (soft-delete) сотрудники не должны получать уведомления —
    // в связке с БАГОМ 4 (роль/сессия отзывается не сразу) это давало
    // окно, где уволенный ещё читал свежие уведомления по студентам.
    const activeRecipients = await this.prisma.user.findMany({
      where: { id: { in: Array.from(recipientIds) }, ...notDeleted },
      select: { id: true },
    });
    if (!activeRecipients.length) return;

    await this.prisma.notification.createMany({
      data: activeRecipients.map((u) => ({
        userId: u.id,
        type: data.type,
        title: data.title,
        message: data.message,
        payload: data.payload ?? undefined,
      })),
    });
    // Проблема B аудита: сокет шлёт только сигнал — NotificationBell.tsx
    // на любое notification:new просто перезапрашивает список по HTTP
    // (listForUser уже per-user), title/message с ФИО и диффом полей
    // студента в payload сокета не нужны никому из подписчиков.
    for (const u of activeRecipients) {
      this.realtime.emitUser(u.id, 'notification:new', { type: data.type });
    }
  }

  /**
   * Уведомление, привязанное к конкретной заявке. Получатели:
   *  - все FOUNDER и ADMIN (видят все заявки);
   *  - manager заявки (если назначен);
   *  - chinaManager заявки (если назначен).
   *
   * EMPLOYEE без назначения не получает уведомление — он бы всё равно
   * получил 403 при попытке открыть заявку, и это создавало UX-баг.
   */
  async notifyForApplication(applicationId: string, data: NotifyPayload) {
    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { managerId: true, chinaManagerId: true },
    });
    if (!app) return;

    // Проблема 9 аудита волны 1: без фильтра deletedAt уволенный (soft-delete)
    // FOUNDER/ADMIN получал бы notification.createMany() запись и адресный
    // сокет-сигнал — notifyForStudent() уже фильтрует так же, здесь просто
    // приводим к тому же правилу.
    const adminFounders = await this.prisma.user.findMany({
      where: { role: { in: ['FOUNDER', 'ADMIN'] }, ...notDeleted },
      select: { id: true },
    });

    // dedup через Set: managerId/chinaManagerId могут совпадать с FOUNDER/ADMIN
    const recipientIds = new Set<string>(adminFounders.map((u) => u.id));
    if (app.managerId) recipientIds.add(app.managerId);
    if (app.chinaManagerId) recipientIds.add(app.chinaManagerId);
    if (recipientIds.size === 0) return;

    // Тот же фильтр, что и в notifyForStudent(): manager/chinaManager заявки
    // тоже мог быть уволен (soft-delete) — перепроверяем ВСЕХ получателей
    // одним запросом, а не только adminFounders выше.
    const activeRecipients = await this.prisma.user.findMany({
      where: { id: { in: Array.from(recipientIds) }, ...notDeleted },
      select: { id: true },
    });
    if (!activeRecipients.length) return;

    await this.prisma.notification.createMany({
      data: activeRecipients.map((u) => ({
        userId: u.id,
        type: data.type,
        title: data.title,
        message: data.message,
        payload: data.payload ?? undefined,
      })),
    });

    // Точечная realtime-доставка каждому получателю по его user-room —
    // только сигнал, NotificationBell.tsx перезапрашивает список по HTTP.
    for (const u of activeRecipients) {
      this.realtime.emitUser(u.id, 'notification:new', { type: data.type });
    }
  }

  /**
   * Уведомление о НОВОЙ публичной заявке (с лендинга, без менеджера).
   * Получатели — только FOUNDER и ADMIN, чтобы они её назначили.
   */
  async notifyAdminsAndFounders(data: NotifyPayload) {
    // Проблема 9 аудита волны 1: уволенный (soft-delete) FOUNDER/ADMIN не
    // должен получать уведомления о новых заявках — тот же фильтр, что и
    // в notifyForStudent()/notifyForApplication().
    const users = await this.prisma.user.findMany({
      where: { role: { in: ['FOUNDER', 'ADMIN'] }, ...notDeleted },
      select: { id: true },
    });
    if (!users.length) return;
    await this.prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type: data.type,
        title: data.title,
        message: data.message,
        payload: data.payload ?? undefined,
      })),
    });
    for (const u of users) {
      this.realtime.emitUser(u.id, 'notification:new', { type: data.type });
    }
  }

  async notifyUser(userId: string, data: NotifyPayload) {
    const notif = await this.prisma.notification.create({
      data: {
        userId,
        type: data.type,
        title: data.title,
        message: data.message,
        payload: data.payload ?? undefined,
      },
    });
    this.realtime.emitUser(userId, 'notification:new', { id: notif.id, type: data.type });
    return notif;
  }

  /**
   * Проблема 3 аудита волны 1: notifyAllStaff() (удалена в волне 0.1) до
   * этого создавала запись КАЖДОМУ сотруднику на каждое изменение ЛЮБОГО
   * студента — в message лежит «ФИО: Телефоны: X → Y; Email: ...», в
   * payload studentId. Эти строки НЕЛЬЗЯ удалять (правило проекта — только
   * soft-delete), поэтому фильтруем их на ЧТЕНИИ: EMPLOYEE не должен видеть
   * запись про студента/заявку, к которой у него сейчас нет доступа, даже
   * если запись создана до появления этого правила. FOUNDER/ADMIN видят всё
   * как раньше (canAccessStudentRecord() для них всегда true).
   */
  async listForUser(userId: string, role: Role, onlyUnread = false): Promise<Notification[]> {
    const notifications = await this.prisma.notification.findMany({
      where: {
        userId,
        ...(onlyUnread ? { read: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    if (isPrivileged(role)) return notifications;
    return this.filterByAccess(notifications, { id: userId, role });
  }

  /**
   * Фильтрует пачку уведомлений по доступу к упомянутому в payload
   * студенту/заявке. Без N+1: все studentId/applicationId из пачки (максимум
   * 100 записей — see listForUser) собираются один раз, дальше — ОДИН
   * findMany на каждую сущность, а не запрос на каждое уведомление.
   */
  private async filterByAccess(
    notifications: Notification[],
    user: { id: string; role: Role },
  ): Promise<Notification[]> {
    const studentIds = new Set<string>();
    const applicationIds = new Set<string>();
    for (const n of notifications) {
      const payload = n.payload as { studentId?: string; applicationId?: string } | null;
      if (payload?.studentId) studentIds.add(payload.studentId);
      if (payload?.applicationId) applicationIds.add(payload.applicationId);
    }

    const [students, applications] = await Promise.all([
      studentIds.size
        ? this.prisma.student.findMany({
            where: { id: { in: Array.from(studentIds) } },
            select: { id: true, managerId: true, chinaManagerId: true },
          })
        : Promise.resolve([] as { id: string; managerId: string | null; chinaManagerId: string | null }[]),
      applicationIds.size
        ? this.prisma.application.findMany({
            where: { id: { in: Array.from(applicationIds) } },
            select: { id: true, managerId: true, chinaManagerId: true },
          })
        : Promise.resolve([] as { id: string; managerId: string | null; chinaManagerId: string | null }[]),
    ]);

    const studentById = new Map(students.map((s) => [s.id, s]));
    const applicationById = new Map(applications.map((a) => [a.id, a]));

    // Для уведомлений правило доступа СТРОЖЕ, чем canAccessStudentRecord():
    // там «запись без менеджеров доступна всем», потому что нераспределённого
    // студента любой сотрудник может взять в работу. Здесь это правило нельзя
    // переиспользовать: в БД лежат легаси-строки от удалённого notifyAllStaff(),
    // разосланные КАЖДОМУ сотруднику и содержащие ФИО, телефоны и email
    // студента. Студенты, заведённые до волны 0.2, менеджера не имеют
    // (бэкфилла не делали — данные не трогаем), поэтому мягкое правило
    // продолжило бы показывать их ПД всем. Требуем явного совпадения.
    const isAssignedToMe = (
      rec: { managerId: string | null; chinaManagerId: string | null },
    ) => rec.managerId === user.id || rec.chinaManagerId === user.id;

    return notifications.filter((n) => {
      const payload = n.payload as { studentId?: string; applicationId?: string } | null;
      // applicationId проверяем ПЕРВЫМ: notifyForApplication() при смене
      // менеджера кладёт в payload оба поля, и решать надо по заявке —
      // именно она адресат уведомления.
      if (payload?.applicationId) {
        const application = applicationById.get(payload.applicationId);
        if (!application) return false;
        return isAssignedToMe(application);
      }
      if (payload?.studentId) {
        // Если id не резолвится — безопаснее скрыть запись, чем показать вслепую.
        const student = studentById.get(payload.studentId);
        if (!student) return false;
        return isAssignedToMe(student);
      }
      // Без studentId/applicationId — системное уведомление (задачи, общие
      // объявления по компании) — отдаём как раньше.
      return true;
    });
  }

  async markRead(userId: string, id: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  async unreadCount(userId: string, role?: Role) {
    // Счётчик обязан считать РОВНО то, что пользователь увидит в списке.
    // Простой count() показывал бы менеджеру число, включающее скрытые
    // легаси-уведомления про чужих студентов: бейдж «12», а список пуст.
    // Хуже того, само число становится каналом утечки — по нему видно,
    // сколько изменений произошло у недоступных сотруднику студентов.
    if (isPrivileged(role)) {
      const count = await this.prisma.notification.count({
        where: { userId, read: false },
      });
      return { count };
    }

    // Непривилегированным считаем по отфильтрованному набору. Ограничиваем
    // выборку: бейджу не нужна точность выше «99+», а тянуть тысячи строк
    // ради счётчика — лишняя нагрузка.
    const BADGE_CAP = 200;
    const rows = await this.prisma.notification.findMany({
      where: { userId, read: false },
      orderBy: { createdAt: 'desc' },
      take: BADGE_CAP,
    });
    const visible = await this.filterByAccess(rows, { id: userId, role: role as Role });
    return { count: visible.length };
  }
}
