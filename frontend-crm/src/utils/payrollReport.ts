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

/**
 * Оклад, от которого реально посчитан итог листа (payslips.service.ts:
 * baseOverride ?? baseAmount). Показывать в строке штатный baseAmount при
 * заданной замене нельзя — строка перестаёт сходиться со своим же «Итого».
 */
export function payslipBase(p: Payslip): string {
  return p.baseOverride ?? p.baseAmount;
}

export function exportPayrollCsv(items: Payslip[], period: string) {
  const header = [
    'ФИО', 'Роль', 'Оклад (реестр)', 'Оклад (замена)', 'Оклад к расчёту',
    'Бонус', 'Премия KPI', 'Корректировка', 'Итого', 'Статус',
  ];
  const rows = items.map((p) => [
    p.user.fullName,
    ROLE_LABEL[p.user.role] ?? p.user.role,
    // Три отдельные колонки, а не одна: иначе выгрузка теряет, С ЧЕГО
    // заменили оклад, и по ней нельзя проверить сам факт ручной замены.
    // «Оклад к расчёту» — единственная, которая сходится с «Итого».
    p.baseAmount,
    p.baseOverride ?? '',
    payslipBase(p),
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
