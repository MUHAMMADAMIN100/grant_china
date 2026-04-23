import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Direction, Prisma, Role, StudentStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

function generatePassword(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const CABINET_BY_DIRECTION: Record<Direction, number> = {
  BACHELOR: 1,
  MASTER: 2,
  LANGUAGE: 3,
};

const STUDENT_INCLUDE = {
  documents: true,
  manager: { select: { id: true, fullName: true, email: true } },
  chinaManager: { select: { id: true, fullName: true, email: true } },
} as const;

type CurrentUser = { id: string; role: Role };

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  private ensureCanEdit(
    student: { managerId: string | null; chinaManagerId?: string | null },
    user: CurrentUser,
  ) {
    if (user.role === 'ADMIN') return;
    const assigned = student.managerId || student.chinaManagerId;
    if (!assigned) return;
    if (student.managerId === user.id || student.chinaManagerId === user.id) return;
    throw new ForbiddenException(
      'Только назначенные менеджеры или администратор могут редактировать этого студента',
    );
  }

  async create(dto: CreateStudentDto, _user?: CurrentUser) {
    const cabinet = dto.cabinet ?? CABINET_BY_DIRECTION[dto.direction];
    const emailNormalized = dto.email.trim().toLowerCase();

    // Проверяем уникальность email среди студентов и пользователей
    const dupStudent = await this.prisma.student.findFirst({ where: { email: emailNormalized } });
    if (dupStudent) {
      throw new BadRequestException('Студент с таким email уже существует');
    }
    const dupUser = await this.prisma.user.findUnique({ where: { email: emailNormalized } });
    if (dupUser) {
      throw new BadRequestException('Этот email уже занят сотрудником');
    }

    // Генерим пароль, сохраняем хеш, возвращаем plain-текст один раз
    const plainPassword = generatePassword(8);
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    const student = await this.prisma.student.create({
      data: {
        fullName: dto.fullName.trim(),
        phones: dto.phones?.length ? dto.phones : [],
        email: emailNormalized,
        password: passwordHash,
        photoUrl: dto.photoUrl || null,
        direction: dto.direction,
        cabinet,
        status: dto.status ?? StudentStatus.ACTIVE,
        comment: dto.comment || null,
      },
      include: STUDENT_INCLUDE,
    });

    // Возвращаем студента + плейн-пароль отдельным полем (только в этом ответе!)
    return { ...student, plainPassword };
  }

  async regeneratePassword(id: string, user: CurrentUser) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Только администратор может сбрасывать пароль студента');
    }
    const existing = await this.findOne(id);
    if (!existing.email) {
      throw new BadRequestException('У студента нет email — невозможно создать доступ');
    }
    const plainPassword = generatePassword(8);
    const passwordHash = await bcrypt.hash(plainPassword, 10);
    await this.prisma.student.update({ where: { id }, data: { password: passwordHash } });
    return { email: existing.email, password: plainPassword };
  }

  async findAll(filters: {
    direction?: Direction;
    status?: StudentStatus;
    cabinet?: number;
    search?: string;
    mine?: boolean;
    currentUserId?: string;
  }) {
    const where: Prisma.StudentWhereInput = {};
    if (filters.direction) where.direction = filters.direction;
    if (filters.status) where.status = filters.status;
    if (filters.cabinet) where.cabinet = filters.cabinet;
    const and: Prisma.StudentWhereInput[] = [];
    if (filters.mine && filters.currentUserId) {
      and.push({
        OR: [
          { managerId: filters.currentUserId },
          { chinaManagerId: filters.currentUserId },
        ],
      });
    }
    if (filters.search) {
      and.push({
        OR: [
          { fullName: { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
          { phones: { has: filters.search } },
        ],
      });
    }
    if (and.length) where.AND = and;
    return this.prisma.student.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: STUDENT_INCLUDE,
    });
  }

  async findOne(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { ...STUDENT_INCLUDE, applications: true },
    });
    if (!student) throw new NotFoundException('Студент не найден');
    return student;
  }

  async update(id: string, dto: UpdateStudentDto, user: CurrentUser) {
    const existing = await this.findOne(id);
    this.ensureCanEdit(existing, user);

    const data: Prisma.StudentUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.phones !== undefined) data.phones = dto.phones;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.photoUrl !== undefined) data.photoUrl = dto.photoUrl;
    if (dto.comment !== undefined) data.comment = dto.comment;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.direction !== undefined) {
      data.direction = dto.direction;
      if (dto.cabinet === undefined) {
        data.cabinet = CABINET_BY_DIRECTION[dto.direction];
      }
    }
    if (dto.cabinet !== undefined) data.cabinet = dto.cabinet;

    return this.prisma.student.update({
      where: { id },
      data,
      include: STUDENT_INCLUDE,
    });
  }

  async assignManager(
    id: string,
    patch: { managerId?: string | null; chinaManagerId?: string | null },
    user: CurrentUser,
  ) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Только администратор может переназначать менеджеров');
    }
    await this.findOne(id);

    const data: any = {};
    if (patch.managerId !== undefined) {
      if (patch.managerId) {
        const exists = await this.prisma.user.findUnique({ where: { id: patch.managerId } });
        if (!exists) throw new NotFoundException('Локальный менеджер не найден');
      }
      data.managerId = patch.managerId;
    }
    if (patch.chinaManagerId !== undefined) {
      if (patch.chinaManagerId) {
        const exists = await this.prisma.user.findUnique({ where: { id: patch.chinaManagerId } });
        if (!exists) throw new NotFoundException('Китайский менеджер не найден');
      }
      data.chinaManagerId = patch.chinaManagerId;
    }

    // Синхронизируем на связанных заявках
    if (Object.keys(data).length > 0) {
      await this.prisma.application.updateMany({ where: { studentId: id }, data });
    }
    return this.prisma.student.update({
      where: { id },
      data,
      include: STUDENT_INCLUDE,
    });
  }

  async remove(id: string, user: CurrentUser) {
    const existing = await this.findOne(id);
    this.ensureCanEdit(existing, user);
    await this.prisma.student.delete({ where: { id } });
    return { ok: true };
  }

  async addDocument(
    studentId: string,
    file: { filename: string; originalname: string; mimetype: string; size: number; url: string },
    type: string = 'OTHER',
    user?: CurrentUser,
  ) {
    const existing = await this.findOne(studentId);
    if (user) this.ensureCanEdit(existing, user);
    if (type !== 'OTHER') {
      await this.prisma.document.deleteMany({ where: { studentId, type } });
    }
    return this.prisma.document.create({
      data: {
        studentId,
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        url: file.url,
        type,
      },
    });
  }

  async removeDocument(documentId: string, user: CurrentUser) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { student: { select: { managerId: true } } },
    });
    if (!doc) throw new NotFoundException('Документ не найден');
    if (doc.student) this.ensureCanEdit(doc.student, user);
    await this.prisma.document.delete({ where: { id: documentId } });
    return { ok: true };
  }

  async stats() {
    const [total, byCabinet, byDirection] = await Promise.all([
      this.prisma.student.count(),
      this.prisma.student.groupBy({ by: ['cabinet'], _count: true, orderBy: { cabinet: 'asc' } }),
      this.prisma.student.groupBy({ by: ['direction'], _count: true }),
    ]);
    return { total, byCabinet, byDirection };
  }
}
