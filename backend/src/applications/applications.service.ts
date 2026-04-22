import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApplicationStatus, Direction, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramService } from '../telegram/telegram.service';
import { MailService } from '../mail/mail.service';

const CABINET_BY_DIRECTION: Record<Direction, number> = {
  BACHELOR: 1,
  MASTER: 2,
  LANGUAGE: 3,
};

const DIRECTION_LABEL: Record<Direction, string> = {
  BACHELOR: 'Бакалавриат',
  MASTER: 'Магистратура',
  LANGUAGE: 'Языковые курсы',
};

const REQUIRED_DOCUMENT_TYPES: { type: string; label: string }[] = [
  { type: 'PHOTO', label: 'Фото 3/4' },
  { type: 'PASSPORT', label: 'Загран паспорт' },
  { type: 'BANK', label: 'Справка с банка' },
  { type: 'MEDICAL', label: 'Мед.справка' },
  { type: 'NO_CRIMINAL', label: 'Справка о несудимости' },
  { type: 'STUDY_PLAN', label: 'Study Plan' },
  { type: 'CERTIFICATE', label: 'Certificate' },
  { type: 'PARENTS_PASSPORT', label: 'Parents passport' },
  { type: 'DIPLOMA', label: 'Аттестат' },
  { type: 'RECOMMENDATION', label: 'Рекомендательное письмо' },
];

const MANAGER_INCLUDE = {
  student: { include: { manager: { select: { id: true, fullName: true, email: true } } } },
  manager: { select: { id: true, fullName: true, email: true } },
};

type CurrentUser = { id: string; role: Role };

@Injectable()
export class ApplicationsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private telegram: TelegramService,
    private mail: MailService,
  ) {}

  async create(dto: CreateApplicationDto) {
    const app = await this.prisma.application.create({
      data: {
        fullName: dto.fullName.trim(),
        phone: dto.phone.trim(),
        email: dto.email?.trim() || null,
        direction: dto.direction,
        comment: dto.comment?.trim() || null,
      },
    });

    await this.notifications.notifyAllStaff({
      type: 'APPLICATION_NEW',
      title: 'Новая заявка',
      message: `${app.fullName} — ${DIRECTION_LABEL[app.direction]}, ${app.phone}`,
      payload: { applicationId: app.id },
    });

    const tgText =
      `🆕 *Новая заявка GrantChina*\n` +
      `*ФИО:* ${app.fullName}\n` +
      `*Телефон:* ${app.phone}\n` +
      (app.email ? `*Email:* ${app.email}\n` : '') +
      `*Направление:* ${DIRECTION_LABEL[app.direction]}\n` +
      (app.comment ? `*Комментарий:* ${app.comment}` : '');
    this.telegram.send(tgText).catch(() => undefined);

    this.mail
      .sendToAdmin(
        `Новая заявка: ${app.fullName}`,
        `<h2>Новая заявка с лендинга</h2>
         <p><b>ФИО:</b> ${app.fullName}</p>
         <p><b>Телефон:</b> ${app.phone}</p>
         ${app.email ? `<p><b>Email:</b> ${app.email}</p>` : ''}
         <p><b>Направление:</b> ${DIRECTION_LABEL[app.direction]}</p>
         ${app.comment ? `<p><b>Комментарий:</b> ${app.comment}</p>` : ''}`,
      )
      .catch(() => undefined);

    return app;
  }

  async findAll(filters: {
    status?: ApplicationStatus;
    direction?: Direction;
    search?: string;
    mine?: boolean;
    currentUserId?: string;
  }) {
    const where: Prisma.ApplicationWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.direction) where.direction = filters.direction;
    if (filters.mine && filters.currentUserId) where.managerId = filters.currentUserId;
    if (filters.search) {
      where.OR = [
        { fullName: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.application.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: MANAGER_INCLUDE,
    });
  }

  async findOne(id: string) {
    const app = await this.prisma.application.findUnique({
      where: { id },
      include: MANAGER_INCLUDE,
    });
    if (!app) throw new NotFoundException('Заявка не найдена');
    return app;
  }

  private ensureCanEdit(app: { managerId: string | null }, user: CurrentUser) {
    if (user.role === 'ADMIN') return;
    if (!app.managerId) return; // ещё не назначен — все могут (кроме случая когда NEW)
    if (app.managerId !== user.id) {
      throw new ForbiddenException('Только назначенный менеджер или администратор может редактировать эту заявку');
    }
  }

  async update(id: string, dto: UpdateApplicationDto, user: CurrentUser) {
    const existing = await this.findOne(id);
    this.ensureCanEdit(existing, user);

    // Авто-создание студента и назначение менеджера при переводе в работу
    if (
      dto.status === ApplicationStatus.IN_PROGRESS &&
      existing.status === ApplicationStatus.NEW &&
      !existing.studentId
    ) {
      const student = await this.prisma.student.create({
        data: {
          fullName: existing.fullName,
          phones: [existing.phone],
          email: existing.email,
          direction: existing.direction,
          cabinet: CABINET_BY_DIRECTION[existing.direction],
          comment: existing.comment,
          managerId: user.id,
        },
      });
      return this.prisma.application.update({
        where: { id },
        data: { ...dto, studentId: student.id, managerId: user.id },
        include: MANAGER_INCLUDE,
      });
    }

    if (
      dto.status === ApplicationStatus.COMPLETED &&
      existing.status !== ApplicationStatus.COMPLETED &&
      existing.studentId
    ) {
      const missing = await this.missingRequiredDocs(existing.studentId);
      if (missing.length > 0) {
        throw new BadRequestException(
          `Невозможно завершить: не загружены документы (${missing.length}): ${missing.join(', ')}`,
        );
      }
    }

    return this.prisma.application.update({
      where: { id },
      data: dto,
      include: MANAGER_INCLUDE,
    });
  }

  async assignManager(id: string, managerId: string | null, user: CurrentUser) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Только администратор может переназначать менеджера');
    }
    const existing = await this.findOne(id);

    if (managerId) {
      const exists = await this.prisma.user.findUnique({ where: { id: managerId } });
      if (!exists) throw new NotFoundException('Пользователь не найден');
    }

    // Синхронизируем менеджера на связанном студенте
    if (existing.studentId) {
      await this.prisma.student.update({
        where: { id: existing.studentId },
        data: { managerId },
      });
    }

    return this.prisma.application.update({
      where: { id },
      data: { managerId },
      include: MANAGER_INCLUDE,
    });
  }

  private async missingRequiredDocs(studentId: string): Promise<string[]> {
    const docs = await this.prisma.document.findMany({
      where: { studentId },
      select: { type: true },
    });
    const uploaded = new Set(docs.map((d) => d.type));
    return REQUIRED_DOCUMENT_TYPES.filter((t) => !uploaded.has(t.type)).map((t) => t.label);
  }

  async remove(id: string, user: CurrentUser) {
    const app = await this.findOne(id);
    this.ensureCanEdit(app, user);
    if (app.studentId) {
      await this.prisma.student.delete({ where: { id: app.studentId } }).catch(() => undefined);
    }
    await this.prisma.application.delete({ where: { id } }).catch(() => undefined);
    return { ok: true };
  }

  async stats() {
    const [total, byStatus, byDirection] = await Promise.all([
      this.prisma.application.count(),
      this.prisma.application.groupBy({ by: ['status'], _count: true }),
      this.prisma.application.groupBy({ by: ['direction'], _count: true }),
    ]);
    return { total, byStatus, byDirection };
  }
}
