import { IsBoolean } from 'class-validator';

/**
 * Отметка о визе от студента (26.08.2026): «получил» (true) или «ещё нет»
 * (false). Сам флаг Student.visaReceived от этого не меняется — отметка
 * уходит менеджеру на подтверждение (см. StudentAuthService.claimVisa).
 */
export class StudentVisaClaimDto {
  @IsBoolean()
  received: boolean;
}
