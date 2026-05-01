import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class StudentLoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
  @IsEmail()
  @MaxLength(120)
  email: string;

  @Transform(({ value }) => (typeof value === 'string' ? value : ''))
  @IsString()
  @MinLength(1, { message: 'Введите пароль' })
  @MaxLength(128)
  password: string;
}

export class StudentForgotPasswordDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
  @IsEmail()
  @MaxLength(120)
  email: string;
}
