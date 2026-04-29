import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: { search?: string } = {}) {
    const search = (filters.search || '').trim();
    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { fullName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, fullName: true, role: true, createdAt: true },
    });
    return users;
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, fullName: true, role: true, createdAt: true },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return user;
  }

  async create(dto: CreateUserDto) {
    const email = (dto.email || '').trim().toLowerCase();
    const rawPassword = (dto.password || '').trim();

    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('Email уже занят');

    const password = await bcrypt.hash(rawPassword, 10);
    const user = await this.prisma.user.create({
      data: { email, password, fullName: dto.fullName, role: dto.role },
      select: { id: true, email: true, fullName: true, role: true, createdAt: true },
    });
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    const data: any = {};
    if (dto.email) data.email = dto.email.trim().toLowerCase();
    if (dto.fullName) data.fullName = dto.fullName;
    if (dto.role) data.role = dto.role;
    if (dto.password) {
      // Нормализуем так же, как в auth.service: иначе при login сравнение
      // bcrypt.compare(plain, hashOfPlainWithSpaces) всегда вернёт false.
      const trimmed = dto.password.trim();
      data.password = await bcrypt.hash(trimmed, 10);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, fullName: true, role: true, createdAt: true },
    });
    return user;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}
