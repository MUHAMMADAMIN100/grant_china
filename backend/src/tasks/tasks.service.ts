import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { isPrivileged } from '../common/roles';

type CurrentUser = { id: string; role: Role };

const TASK_INCLUDE = {
  assignedTo: { select: { id: true, fullName: true, email: true } },
  createdBy: { select: { id: true, fullName: true, email: true } },
} as const;

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private mail: MailService,
    private realtime: RealtimeGateway,
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
    return task;
  }

  async findAll(filters: {
    mine?: boolean;
    currentUserId: string;
    role: Role;
    search?: string;
  }) {
    const baseWhere: any =
      isPrivileged(filters.role) && !filters.mine
        ? {}
        : { assignedToId: filters.currentUserId };
    const search = (filters.search || '').trim();
    const where = search
      ? {
          ...baseWhere,
          OR: [
            { title: { contains: search, mode: 'insensitive' as const } },
            { description: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : baseWhere;
    return this.prisma.task.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: TASK_INCLUDE,
    });
  }

  /**
   * `user` передаётся только из контроллера. Без него findOne используют
   * внутренние вызовы (update/remove), которые сами проверяют права ПОСЛЕ
   * чтения — сохраняем их прежние коды/тексты ошибок (403).
   */
  async findOne(id: string, user?: CurrentUser) {
    const task = await this.prisma.task.findUnique({ where: { id }, include: TASK_INCLUDE });
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
    await this.prisma.task.delete({ where: { id } });
    this.realtime.emitAllStaff('task:deleted', { id });
    return { ok: true };
  }

  async stats(user: CurrentUser) {
    const where = isPrivileged(user.role) ? {} : { assignedToId: user.id };
    const [total, todo, inProgress, done] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.count({ where: { ...where, status: TaskStatus.TODO } }),
      this.prisma.task.count({ where: { ...where, status: TaskStatus.IN_PROGRESS } }),
      this.prisma.task.count({ where: { ...where, status: TaskStatus.DONE } }),
    ]);
    return { total, todo, inProgress, done };
  }
}
