import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any) {
    if (err || !user) throw err || new ForbiddenException('Требуется авторизация');
    if (user.role === 'STUDENT') {
      throw new ForbiddenException('Эта зона только для сотрудников');
    }
    return user;
  }
}
