import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  @MaxLength(120)
  email: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsEnum(Role)
  role: Role;
}
