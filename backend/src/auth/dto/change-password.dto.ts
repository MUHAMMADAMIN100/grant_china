import { IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class ChangePasswordDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value : ''))
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'Новый пароль: минимум 8 символов' })
  @Transform(({ value }) => (typeof value === 'string' ? value : ''))
  newPassword: string;
}
