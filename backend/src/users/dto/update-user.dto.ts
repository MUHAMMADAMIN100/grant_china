import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { Role } from '@prisma/client';

export class UpdateUserDto {
  // trim + lowercase ДО валидации — иначе хеш сохранится для одного варианта,
  // а login найдёт пользователя по другому, и сравнение хешей провалится.
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  // trim ДО MinLength — чтобы случайные пробелы / переводы строк (часто
  // прилипают при копи-пасте паролей) не попали в bcrypt.hash. Иначе хеш
  // сохранится с пробелами, а login нормализует пароль и сравнение даст false.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
