import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ApplicationStatus, Direction, Prisma } from '@prisma/client';
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

    // Уведомления (in-app для всех сотрудников и админов)
    await this.notifications.notifyAllStaff({
      type: 'APPLICATION_NEW',
      title: 'Новая заявка',
      message: `${app.fullName} — ${DIRECTION_LABEL[app.direction]}, ${app.phone}`,
      payload: { applicationId: app.id },
    });

    // Telegram
    const tgText =
      `🆕 *Новая заявка GrantChina*\n` +
      `*ФИО:* ${app.fullName}\n` +
      `*Телефон:* ${app.phone}\n` +
      (app.email ? `*Email:* ${app.email}\n` : '') +
      `*Направление:* ${DIRECTION_LABEL[app.direction]}\n` +
      (app.comment ? `*Комментарий:* ${app.comment}` : '');
    this.telegram.send(tgText).catch(() => undefined);

    // Email админу
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

  async findAll(filters: { status?: ApplicationStatus; direction?: Direction; search?: string }) {
    const where: Prisma.ApplicationWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.direction) where.direction = filters.direction;
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
      include: { student: true },
    });
  }

  async findOne(id: string) {
    const app = await this.prisma.application.findUnique({
      where: { id },
      include: { student: true },
    });
    if (!app) throw new NotFoundException('Заявка не найдена');
    return app;
  }

  async update(id: string, dto: UpdateApplicationDto) {
    const existing = await this.findOne(id);

    // Авто-создание студента при переводе заявки в работу
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
        },
      });
      return this.prisma.application.update({
        where: { id },
        data: { ...dto, studentId: student.id },
        include: { student: true },
      });
    }

    return this.prisma.application.update({
      where: { id },
      data: dto,
      include: { student: true },
    });
  }

  async remove(id: string) {
    const app = await this.findOne(id);
    // Сначала удаляем связанного студента (каскадом удалятся его документы)
    if (app.studentId) {
      await this.prisma.student.delete({ where: { id: app.studentId } }).catch(() => undefined);
    }
    await this.prisma.application.delete({ where: { id } }).catch(() => undefined);
    return { ok: true };
  }

  /**
   * Конвертирует заявку в студента: создаёт карточку студента,
   * автоматически распределяет по кабинету, помечает заявку завершённой.
   */
  async convertToStudent(id: string) {
    const app = await this.findOne(id);
    if (app.studentId) {
      throw new BadRequestException('Заявка уже сконвертирована в студента');
    }

    const student = await this.prisma.student.create({
      data: {
        fullName: app.fullName,
        phones: [app.phone],
        email: app.email,
        direction: app.direction,
        cabinet: CABINET_BY_DIRECTION[app.direction],
        comment: app.comment,
      },
    });

    await this.prisma.application.update({
      where: { id },
      data: { status: ApplicationStatus.COMPLETED, studentId: student.id },
    });

    return student;
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
