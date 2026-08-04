import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { Region, Role } from '@prisma/client';

export class CreateUserDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(120)
  email: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  // trim перед хешированием — иначе пробелы зашьются в хэш и login по
  // тримленному паролю будет фейлиться.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsEnum(Role)
  role: Role;

  // ТЗ v3 раздел 4. @IsOptional: старые клиенты (и внутренние скрипты вроде
  // prisma/create-founder.ts) поле не шлют, а падать на этом нельзя — БД
  // подставит @default(BOTH). Значим только для EMPLOYEE: FOUNDER и ADMIN по
  // ТЗ видят всех студентов независимо от региона.
  @IsOptional()
  @IsEnum(Region)
  region?: Region;
}
