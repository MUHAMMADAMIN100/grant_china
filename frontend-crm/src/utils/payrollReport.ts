import { saveAs } from 'file-saver';
import type { Payslip } from '../api/types';
import { PAYSLIP_STATUS_LABEL, ROLE_LABEL } from '../api/types';

/**
 * Раздел 5 ТЗ (волна 6) — экспорт ведомости в CSV. Собирается на фронте из
 * уже полученных данных (см. uiPlan проекта архитектора) — отдельного
 * бэкенд-эндпоинта и библиотек для этого нет, только уже используемый
 * в проекте file-saver (см. utils/studentsReport.ts).
 */
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportPayrollCsv(items: Payslip[], period: string) {
  const header = ['ФИО', 'Роль', 'Оклад', 'Бонус', 'Премия KPI', 'Корректировка', 'Итого', 'Статус'];
  const rows = items.map((p) => [
    p.user.fullName,
    ROLE_LABEL[p.user.role] ?? p.user.role,
    p.baseAmount,
    p.bonusAmount,
    p.kpiBonusAmount,
    p.adjustmentAmount,
    p.totalAmount,
    PAYSLIP_STATUS_LABEL[p.status],
  ]);
  // BOM — чтобы Excel на Windows корректно распознал UTF-8, а не показал кракозябры.
  const csv = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, `grantchina-payroll-${period}.csv`);
}
