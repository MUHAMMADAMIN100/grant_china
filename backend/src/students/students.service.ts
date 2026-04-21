import { Injectable, NotFoundException } from '@nestjs/common';
import { Direction, Prisma, StudentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

const CABINET_BY_DIRECTION: Record<Direction, number> = {
  BACHELOR: 1,
  MASTER: 2,
  LANGUAGE: 3,
};

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateStudentDto) {
    const cabinet = dto.cabinet ?? CABINET_BY_DIRECTION[dto.direction];
    return this.prisma.student.create({
      data: {
        fullName: dto.fullName.trim(),
        phones: dto.phones?.length ? dto.phones : [],
        email: dto.email || null,
        photoUrl: dto.photoUrl || null,
        direction: dto.direction,
        cabinet,
        status: dto.status ?? StudentStatus.ACTIVE,
        comment: dto.comment || null,
      },
      include: { documents: true },
    });
  }

  async findAll(filters: {
    direction?: Direction;
    status?: StudentStatus;
    cabinet?: number;
    search?: string;
  }) {
    const where: Prisma.StudentWhereInput = {};
    if (filters.direction) where.direction = filters.direction;
    if (filters.status) where.status = filters.status;
    if (filters.cabinet) where.cabinet = filters.cabinet;
    if (filters.search) {
      where.OR = [
        { fullName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { phones: { has: filters.search } },
      ];
    }
    return this.prisma.student.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { documents: true },
    });
  }

  async findOne(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { documents: true, applications: true },
    });
    if (!student) throw new NotFoundException('Студент не найден');
    return student;
  }

  async update(id: string, dto: UpdateStudentDto) {
    await this.findOne(id);

    const data: Prisma.StudentUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.phones !== undefined) data.phones = dto.phones;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.photoUrl !== undefined) data.photoUrl = dto.photoUrl;
    if (dto.comment !== undefined) data.comment = dto.comment;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.direction !== undefined) {
      data.direction = dto.direction;
      // Если направление меняется, а кабинет вручную не указан — переназначаем автоматически
      if (dto.cabinet === undefined) {
        data.cabinet = CABINET_BY_DIRECTION[dto.direction];
      }
    }
    if (dto.cabinet !== undefined) data.cabinet = dto.cabinet;

    return this.prisma.student.update({
      where: { id },
      data,
      include: { documents: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.student.delete({ where: { id } });
    return { ok: true };
  }

  async addDocument(
    studentId: string,
    file: { filename: string; originalname: string; mimetype: string; size: number; url: string },
    type: string = 'OTHER',
  ) {
    await this.findOne(studentId);
    // Для типизированных документов (не OTHER) — удаляем старый того же типа
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

  async removeDocument(documentId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Документ не найден');
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
