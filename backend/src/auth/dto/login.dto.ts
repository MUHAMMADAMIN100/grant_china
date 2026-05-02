import { IsEmail, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  // Симметрично с create/update user: trim+lowercase, чтобы найти юзера
  // по тому же ключу, под которым он был сохранён.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  // Trim — на login и save должна быть одинаковая нормализация, иначе
  // bcrypt.compare(trimmed, hashWithSpaces) вернёт false.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(4)
  password: string;
}
