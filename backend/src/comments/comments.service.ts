import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { RealtimeGateway, ManagerScope } from '../realtime/realtime.gateway';
import { isPrivileged } from '../common/roles';
import { canAccessStudentRecord } from '../common/access';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

export type CurrentUser = { id: string; role: Role };

type AssignableRef = { id: string; fullName: string; managerId: string | null; chinaManagerId: string | null };

const COMMENT_INCLUDE = {
  author: { select: { id: true, fullName: true } },
} as const;

const PREVIEW_LEN = 200;

/** ТЗ 6.3 — превью для ActivityLog.details: полный текст остаётся только в Comment.body. */
function preview(body: string): string {
  return body.length > PREVIEW_LEN ? `${body.slice(0, PREVIEW_LEN)}…` : body;
}

@Injectable()
export class CommentsService {
  constructor(private prisma: PrismaService, private activity: ActivityService, private realtime: RealtimeGateway) {}

  private async ensureStudentAccess(studentId: string, user: CurrentUser): Promise<AssignableRef> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true, fullName: true, managerId: true, chinaManagerId: true },
    });
    if (!student || !canAccessStudentRecord(student, user)) {
      throw new NotFoundException('Студент не найден');
    }
    return student;
  }

  private async ensureApplicationAccess(
    applicationId: string,
    user: CurrentUser,
  ): Promise<AssignableRef & { studentId: string | null }> {
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, deletedAt: null },
      select: { id: true, fullName: true, managerId: true, chinaManagerId: true, studentId: true },
    });
    if (!app || !canAccessStudentRecord(app, user)) {
      throw new NotFoundException('Заявка не найдена');
    }
    return app;
  }

  /**
   * Доступ к самому комментарию (чтение и запись): пользователь должен иметь
   * доступ ХОТЯ БЫ к одной из привязок (студент или заявка) — комментарии
   * без studentId (привязанные только к заявке без студента) видны через
   * доступ к заявке. 404, а не 403 — не быть оракулом существования id.
   */
  private async loadForMutation(id: string, user: CurrentUser) {
    const comment = await this.prisma.comment.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...COMMENT_INCLUDE,
        student: { select: { id: true, fullName: true, managerId: true, chinaManagerId: true } },
        application: {
          select: { id: true, fullName: true, managerId: true, chinaManagerId: true, studentId: true },
        },
      },
    });
    if (!comment) throw new NotFoundException('Комментарий не найден');
    const hasAccess =
      (comment.student && canAccessStudentRecord(comment.student, user)) ||
      (comment.application && canAccessStudentRecord(comment.application, user));
    if (!hasAccess) throw new NotFoundException('Комментарий не найден');
    return comment;
  }

  async list(
    filters: { studentId?: string; applicationId?: string; page?: number; pageSize?: number },
    user: CurrentUser,
  ) {
    if (!filters.studentId && !filters.applicationId) {
      throw new BadRequestException('Укажите studentId или applicationId');
    }
    if (filters.studentId && filters.applicationId) {
      throw new BadRequestException('Укажите только один параметр: studentId или applicationId');
    }

    const where: Prisma.CommentWhereInput = { deletedAt: null };
    if (filters.studentId) {
      await this.ensureStudentAccess(filters.studentId, user);
      where.studentId = filters.studentId;
    } else {
      await this.ensureApplicationAccess(filters.applicationId as string, user);
      where.applicationId = filters.applicationId;
    }

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50));
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.comment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: COMMENT_INCLUDE,
      }),
      this.prisma.comment.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async create(dto: CreateCommentDto, user: CurrentUser) {
    if (!dto.studentId && !dto.applicationId) {
      throw new BadRequestException('Комментарий должен быть привязан к студенту или заявке');
    }

    const student = dto.studentId ? await this.ensureStudentAccess(dto.studentId, user) : null;
    const application = dto.applicationId ? await this.ensureApplicationAccess(dto.applicationId, user) : null;

    const comment = await this.prisma.comment.create({
      data: {
        body: dto.body.trim(),
        studentId: dto.studentId || null,
        applicationId: dto.applicationId || null,
        authorId: user.id,
      },
      include: COMMENT_INCLUDE,
    });

    // studentId заявки БЕЗ явного dto.studentId — комментарий к заявке уже
    // привязанной к студенту должен попасть в его ленту через ActivityLog.studentId
    // (та же логика, что и у STATUS_CHANGE в applications.service.ts).
    const effectiveStudentId = dto.studentId || application?.studentId || null;
    const scope: ManagerScope = student ?? application ?? { managerId: null, chinaManagerId: null };

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'COMMENT_CREATE',
        studentId: effectiveStudentId,
        studentName: student?.fullName ?? application?.fullName ?? null,
        details: preview(comment.body),
        payload: { commentId: comment.id, studentId: effectiveStudentId, applicationId: dto.applicationId || null },
      })
      .catch(() => undefined);

    this.realtime.emitForStudent(
      scope,
      'comment:new',
      { id: comment.id, studentId: dto.studentId || null, applicationId: dto.applicationId || null },
      effectiveStudentId ? { studentId: effectiveStudentId } : undefined,
    );

    return comment;
  }

  async update(id: string, dto: UpdateCommentDto, user: CurrentUser) {
    const existing = await this.loadForMutation(id, user);
    if (existing.authorId !== user.id && !isPrivileged(user.role)) {
      throw new ForbiddenException('Редактировать комментарий может только автор');
    }

    const updated = await this.prisma.comment.update({
      where: { id },
      data: { body: dto.body.trim(), editedAt: new Date() },
      include: COMMENT_INCLUDE,
    });

    const effectiveStudentId = existing.studentId || existing.application?.studentId || null;
    const scope: ManagerScope = existing.student ?? existing.application ?? { managerId: null, chinaManagerId: null };

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'COMMENT_UPDATE',
        studentId: effectiveStudentId,
        studentName: existing.student?.fullName ?? existing.application?.fullName ?? null,
        details: preview(updated.body),
        payload: { commentId: id, studentId: effectiveStudentId, applicationId: existing.applicationId },
      })
      .catch(() => undefined);

    this.realtime.emitForStudent(
      scope,
      'comment:updated',
      { id, studentId: existing.studentId, applicationId: existing.applicationId },
      effectiveStudentId ? { studentId: effectiveStudentId } : undefined,
    );

    return updated;
  }

  /** Soft-delete (правило проекта №1). Только автор либо FOUNDER/ADMIN. */
  async remove(id: string, user: CurrentUser) {
    const existing = await this.loadForMutation(id, user);
    if (existing.authorId !== user.id && !isPrivileged(user.role)) {
      throw new ForbiddenException('Удалить комментарий может только автор');
    }

    await this.prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } });

    const effectiveStudentId = existing.studentId || existing.application?.studentId || null;
    const scope: ManagerScope = existing.student ?? existing.application ?? { managerId: null, chinaManagerId: null };

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'COMMENT_DELETE',
        studentId: effectiveStudentId,
        studentName: existing.student?.fullName ?? existing.application?.fullName ?? null,
        details: 'Комментарий удалён',
        payload: { commentId: id, studentId: effectiveStudentId, applicationId: existing.applicationId },
      })
      .catch(() => undefined);

    this.realtime.emitForStudent(
      scope,
      'comment:deleted',
      { id, studentId: existing.studentId, applicationId: existing.applicationId },
      effectiveStudentId ? { studentId: effectiveStudentId } : undefined,
    );

    return { ok: true };
  }
}
