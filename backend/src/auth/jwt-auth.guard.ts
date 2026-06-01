import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any) {
    // 401 если токена нет / он невалиден → frontend interceptor редиректит
    // на /login. 403 (Forbidden) оставляем только для "залогинен, но не та роль".
    if (err || !user) {
      throw err || new UnauthorizedException('Требуется авторизация');
    }
    if (user.role === 'STUDENT') {
      throw new ForbiddenException('Эта зона только для сотрудников');
    }
    return user;
  }
}
