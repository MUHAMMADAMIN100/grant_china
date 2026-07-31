import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AMOUNT_RE } from '../../payments/dto/create-payment.dto';

export class CreateContractDto {
  @IsString()
  studentId: string;

  @IsOptional()
  @IsString()
  applicationId?: string;

  // 0 разрешён явно — договор может готовиться ДО согласования суммы
  // (см. Contract.amount @default(0) в schema.prisma), проверяется в сервисе.
  @IsOptional()
  @Matches(AMOUNT_RE, { message: 'Сумма должна быть числом (до двух знаков после точки)' })
  amount?: string;

  /** Только FOUNDER/ADMIN может назначить ответственного, отличного от менеджера студента (проверяется в сервисе). */
  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
