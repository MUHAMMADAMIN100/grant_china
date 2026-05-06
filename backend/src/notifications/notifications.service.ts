import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

interface NotifyPayload {
  type: string;
  title: string;
  message: string;
  payload?: any;
}

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService, private realtime: RealtimeGateway) {}

  async notifyAllStaff(data: NotifyPayload) {
    const users = await this.prisma.user.findMany({ select: { id: true } });
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
    // Realtime — всем сотрудникам
    this.realtime.emitStaff('notification:new', {
      type: data.type,
      title: data.title,
      message: data.message,
      payload: data.payload,
    });
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

    const adminFounders = await this.prisma.user.findMany({
      where: { role: { in: ['FOUNDER', 'ADMIN'] } },
      select: { id: true },
    });

    // dedup через Set: managerId/chinaManagerId могут совпадать с FOUNDER/ADMIN
    const recipientIds = new Set<string>(adminFounders.map((u) => u.id));
    if (app.managerId) recipientIds.add(app.managerId);
    if (app.chinaManagerId) recipientIds.add(app.chinaManagerId);

    if (recipientIds.size === 0) return;

    await this.prisma.notification.createMany({
      data: Array.from(recipientIds).map((userId) => ({
        userId,
        type: data.type,
        title: data.title,
        message: data.message,
        payload: data.payload ?? undefined,
      })),
    });

    // Точечная realtime-доставка каждому получателю по его user-room
    for (const userId of recipientIds) {
      this.realtime.emitUser(userId, 'notification:new', {
        type: data.type,
        title: data.title,
        message: data.message,
        payload: data.payload,
      });
    }
  }

  /**
   * Уведомление о НОВОЙ публичной заявке (с лендинга, без менеджера).
   * Получатели — только FOUNDER и ADMIN, чтобы они её назначили.
   */
  async notifyAdminsAndFounders(data: NotifyPayload) {
    const users = await this.prisma.user.findMany({
      where: { role: { in: ['FOUNDER', 'ADMIN'] } },
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
      this.realtime.emitUser(u.id, 'notification:new', {
        type: data.type,
        title: data.title,
        message: data.message,
        payload: data.payload,
      });
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
    this.realtime.emitUser(userId, 'notification:new', {
      id: notif.id,
      type: data.type,
      title: data.title,
      message: data.message,
      payload: data.payload,
    });
    return notif;
  }

  async listForUser(userId: string, onlyUnread = false) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(onlyUnread ? { read: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
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

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, read: false },
    });
    return { count };
  }
}
