import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { clearAuthCookie, setAuthCookie } from './cookie-helpers';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  /**
   * Вход сотрудника. После успешного логина token уходит ТОЛЬКО в httpOnly
   * cookie `gc_token` — JavaScript на фронте его не видит, XSS не угоняет.
   * Поле `token` в ответе оставлено для legacy-клиентов (Socket.io старых
   * сборок CRM). Новые сборки игнорируют это поле и опираются на cookie.
   *
   * Rate-limit: 5 попыток в минуту с одного IP — защита от brute-force.
   * Раньше staff-login был без throttling, в отличие от студенческого.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto.email, dto.password);
    setAuthCookie(res, result.token, req);
    return { user: result.user };
  }

  /**
   * Логаут. Очищает httpOnly cookie на стороне браузера. Сам JWT остаётся
   * валидным до своего expiry (stateless), но клиент его больше не пошлёт.
   */
  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    clearAuthCookie(res, req);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: { sub: string }) {
    return this.auth.me(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(
    @CurrentUser() user: { sub: string },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.sub, dto.currentPassword, dto.newPassword);
  }
}
