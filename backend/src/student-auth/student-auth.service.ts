import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const STUDENT_INCLUDE = {
  documents: true,
  manager: { select: { id: true, fullName: true, email: true } },
  chinaManager: { select: { id: true, fullName: true, email: true } },
  applications: { select: { id: true, status: true, createdAt: true } },
} as const;

@Injectable()
export class StudentAuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(email: string, password: string) {
    if (!email || !password) {
      throw new BadRequestException('Укажите email и пароль');
    }
    const normalized = email.trim().toLowerCase();
    const student = await this.prisma.student.findFirst({ where: { email: normalized } });
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
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: STUDENT_INCLUDE,
    });
    if (!student) throw new UnauthorizedException('Студент не найден');
    const { password, ...safe } = student as any;
    return safe;
  }
}
