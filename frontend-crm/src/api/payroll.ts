import { api } from './client';
import type {
  BonusMetricScope,
  BonusRule,
  BonusRuleKind,
  BonusRuleScope,
  BonusRuleSet,
  BonusRuleSetStatus,
  BonusRuleSimulateResult,
  KpiMetric,
  MyCompensation,
  PaymentStage,
  Payslip,
  PayslipStatus,
  PayrollAdminKpi,
  PayrollMyKpi,
  PayrollMyRules,
  PayrollPreview,
  PayrollSummary,
} from './types';

// ============================================================================
// Раздел 5 ТЗ (волна 6) — KPI менеджеров и зарплата (Payroll). Контракт
// зеркалит backend/src/payroll/ (payroll-me.controller.ts,
// payroll-admin.controller.ts, rules.controller.ts, compensation.controller.ts).
// ============================================================================

// ---------------------------------------------------------------------------
// /payroll/me/* — личный кабинет. Идентичность ТОЛЬКО из JWT на бэкенде,
// эти функции НИКОГДА не принимают userId параметром намеренно.
// ---------------------------------------------------------------------------

export async function getMyKpi(period: string) {
  const { data } = await api.get<PayrollMyKpi>('/payroll/me/kpi', { params: { period } });
  return data;
}

/** Предварительный расчёт — НИЧЕГО не пишет в БД, итог может измениться до утверждения. */
export async function getMyPreview(period: string) {
  const { data } = await api.get<PayrollPreview>('/payroll/me/preview', { params: { period } });
  return data;
}

export interface PayslipsPage {
  items: Payslip[];
  total: number;
  page: number;
  pageSize: number;
}

/** Только APPROVED/PAID/VOID — свои DRAFT-листы бэкенд не отдаёт (см. accessModel проекта архитектора). */
export async function listMyPayslips(filters: { page?: number; pageSize?: number } = {}) {
  const { data } = await api.get<PayslipsPage>('/payroll/me/payslips', { params: filters });
  return data;
}

export async function getMyPayslip(id: string) {
  const { data } = await api.get<Payslip>(`/payroll/me/payslips/${id}`);
  return data;
}

/** Только действующая ставка, без истории (история — только FOUNDER, см. /payroll/compensation). */
export async function getMyCompensation() {
  const { data } = await api.get<MyCompensation>('/payroll/me/compensation');
  return data;
}

/** Действующие правила: scope=ALL + свои scope=USER. */
export async function getMyRules() {
  const { data } = await api.get<PayrollMyRules>('/payroll/me/rules');
  return data;
}

// ---------------------------------------------------------------------------
// /payroll/* — руководство (FOUNDER + ADMIN, с точечными ограничениями
// FOUNDER — проверяет бэкенд, кнопки на фронте скрываются по той же логике).
// ---------------------------------------------------------------------------

export async function getPayrollSummary(period: string) {
  const { data } = await api.get<PayrollSummary>('/payroll/summary', { params: { period } });
  return data;
}

export async function getPayrollKpi(period: string, managerId?: string) {
  const { data } = await api.get<PayrollAdminKpi>('/payroll/kpi', { params: { period, managerId } });
  return data;
}

export interface AdminPayslipFilters {
  period?: string;
  userId?: string;
  status?: PayslipStatus;
  page?: number;
  pageSize?: number;
}

export async function listPayslips(filters: AdminPayslipFilters = {}) {
  const { data } = await api.get<PayslipsPage>('/payroll/payslips', { params: filters });
  return data;
}

export async function getPayslip(id: string) {
  const { data } = await api.get<Payslip>(`/payroll/payslips/${id}`);
  return data;
}

/** Идемпотентно создаёт DRAFT-листы за период всем EMPLOYEE/ADMIN (уже существующие — пропускаются). */
export async function generatePayslips(period: string) {
  const { data } = await api.post<{ created: number; skipped: number; period: string }>('/payroll/payslips/generate', { period });
  return data;
}

/** Ручной лист — только FOUNDER, берёт и уволенных сотрудников. */
export async function createManualPayslip(userId: string, period: string) {
  const { data } = await api.post<Payslip>('/payroll/payslips/create', { userId, period });
  return data;
}

/** Только DRAFT. */
export async function recalculatePayslip(id: string) {
  const { data } = await api.post<Payslip>(`/payroll/payslips/${id}/recalculate`);
  return data;
}

export interface UpdatePayslipPayload {
  /** Может быть отрицательной — возврат бонуса делается корректировкой, а не пересчётом прошлого периода. */
  adjustmentAmount?: string;
  adjustmentReason?: string;
  baseOverride?: string;
  baseOverrideReason?: string;
}

/** Только DRAFT, только FOUNDER. */
export async function updatePayslip(id: string, payload: UpdatePayslipPayload) {
  const { data } = await api.patch<Payslip>(`/payroll/payslips/${id}`, payload);
  return data;
}

/**
 * Пересчитывает лист ПЕРЕД заморозкой и сверяет с суммой, которую видел
 * клиент при открытии карточки — expectedTotal передавать ВСЕГДА, иначе
 * можно утвердить устаревшую цифру (аналог updatedAtCheck у Payment.approve).
 */
export async function approvePayslip(id: string, expectedTotal?: string) {
  const { data } = await api.post<Payslip>(`/payroll/payslips/${id}/approve`, expectedTotal !== undefined ? { expectedTotal } : {});
  return data;
}

/** APPROVED -> DRAFT, только пока не PAID. Только FOUNDER, причина обязательна. */
export async function recallPayslip(id: string, reason: string) {
  const { data } = await api.post<Payslip>(`/payroll/payslips/${id}/recall`, { reason });
  return data;
}

/** Фиксация выплаты — только FOUNDER (ТЗ 1.1: движение денег подтверждает только Основатель). */
export async function payPayslip(id: string, paidReference?: string) {
  const { data } = await api.post<Payslip>(`/payroll/payslips/${id}/pay`, paidReference ? { paidReference } : {});
  return data;
}

/** Сторнирование APPROVED/PAID-листа. Только FOUNDER, причина обязательна. */
export async function voidPayslip(id: string, reason: string) {
  const { data } = await api.post<Payslip>(`/payroll/payslips/${id}/void`, { reason });
  return data;
}

/** Новая ревизия за тот же период взамен аннулированного листа. Только FOUNDER. */
export async function reissuePayslip(id: string) {
  const { data } = await api.post<Payslip>(`/payroll/payslips/${id}/reissue`);
  return data;
}

/** Soft-delete, только DRAFT. Только FOUNDER. */
export async function deletePayslip(id: string) {
  const { data } = await api.delete<{ ok: true }>(`/payroll/payslips/${id}`);
  return data;
}

// ---------------------------------------------------------------------------
// /payroll/rules/* — формулы бонусов. Изменение формул = клонирование ACTIVE
// в DRAFT и правка черновика; ACTIVE-набор ни один эндпоинт не редактирует.
// ---------------------------------------------------------------------------

export async function listRuleSets(status?: BonusRuleSetStatus) {
  const { data } = await api.get<BonusRuleSet[]>('/payroll/rules/sets', { params: { status } });
  return data;
}

export async function getRuleSet(id: string) {
  const { data } = await api.get<BonusRuleSet>(`/payroll/rules/sets/${id}`);
  return data;
}

/** Применяет ЛЮБОЙ набор (обычно ещё не активированный DRAFT) к закрытому периоду, ничего не пишет в БД. */
export async function simulateRuleSet(id: string, period: string) {
  const { data } = await api.get<BonusRuleSimulateResult>(`/payroll/rules/sets/${id}/simulate`, { params: { period } });
  return data;
}

export interface CreateRuleSetPayload {
  title: string;
  /** 'YYYY-MM-DD' — первое число месяца, с которого версия применяется. */
  effectiveFrom: string;
  /** Клонировать правила из существующего набора (обычно ACTIVE) — обычный сценарий «изменить формулы». */
  cloneFromId?: string;
}

export async function createRuleSet(payload: CreateRuleSetPayload) {
  const { data } = await api.post<BonusRuleSet>('/payroll/rules/sets', payload);
  return data;
}

export interface UpdateRuleSetPayload {
  title?: string;
  effectiveFrom?: string;
}

/** Только DRAFT. */
export async function updateRuleSet(id: string, payload: UpdateRuleSetPayload) {
  const { data } = await api.patch<BonusRuleSet>(`/payroll/rules/sets/${id}`, payload);
  return data;
}

export interface RulePayload {
  kind: BonusRuleKind;
  label: string;
  scope?: BonusRuleScope;
  userId?: string;
  /** Доля 0..1 строкой ("0.0300" = 3%) — форма конвертирует проценты сама. */
  rate?: string;
  amount?: string;
  threshold?: string;
  cap?: string;
  stage?: PaymentStage;
  metric?: KpiMetric;
  metricScope?: BonusMetricScope;
  tierGroup?: string;
  enabled?: boolean;
  sortOrder?: number;
  note?: string;
}

/** Добавить правило в набор — только DRAFT. */
export async function addRule(setId: string, payload: RulePayload) {
  const { data } = await api.post<BonusRule>(`/payroll/rules/sets/${setId}/rules`, payload);
  return data;
}

export interface UpdateRulePayload extends Omit<Partial<RulePayload>, 'userId' | 'rate' | 'amount' | 'threshold' | 'cap' | 'stage' | 'metric' | 'tierGroup' | 'note'> {
  userId?: string | null;
  rate?: string | null;
  amount?: string | null;
  threshold?: string | null;
  cap?: string | null;
  stage?: PaymentStage | null;
  metric?: KpiMetric | null;
  tierGroup?: string | null;
  note?: string | null;
}

/** Правило редактируемо, только пока его набор в DRAFT. */
export async function updateRule(ruleId: string, payload: UpdateRulePayload) {
  const { data } = await api.patch<BonusRule>(`/payroll/rules/rules/${ruleId}`, payload);
  return data;
}

export async function removeRule(ruleId: string) {
  const { data } = await api.delete<{ ok: true }>(`/payroll/rules/rules/${ruleId}`);
  return data;
}

/** Необратимый шаг — только FOUNDER (проверяет бэкенд). */
export async function activateRuleSet(id: string) {
  const { data } = await api.post<BonusRuleSet>(`/payroll/rules/sets/${id}/activate`);
  return data;
}

export async function archiveRuleSet(id: string) {
  const { data } = await api.post<BonusRuleSet>(`/payroll/rules/sets/${id}/archive`);
  return data;
}

// ---------------------------------------------------------------------------
// /payroll/compensation/* — оклады (ТЗ 2.8 «кадровые ведомости»). Целиком
// только FOUNDER, см. accessModel проекта архитектора.
// ---------------------------------------------------------------------------

export interface CompensationRow {
  id: string;
  userId: string;
  baseSalary: string;
  currency: string;
  effectiveFrom: string;
  note: string | null;
  createdById: string | null;
  createdBy?: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export async function getCompensationHistory(userId: string) {
  const { data } = await api.get<CompensationRow[]>('/payroll/compensation', { params: { userId } });
  return data;
}

export interface CompensationCurrentItem {
  id: string;
  fullName: string;
  email: string;
  role: string;
  baseSalary: string | null;
}

export interface CompensationCurrent {
  items: CompensationCurrentItem[];
  fundTotal: string;
}

export async function getCompensationCurrent() {
  const { data } = await api.get<CompensationCurrent>('/payroll/compensation/current');
  return data;
}

export interface SetCompensationPayload {
  userId: string;
  baseSalary: string;
  /** 'YYYY-MM-DD' — повышение «с середины месяца» оформляйте первым числом следующего. */
  effectiveFrom: string;
  note?: string;
}

export async function setCompensation(payload: SetCompensationPayload) {
  const { data } = await api.post<CompensationRow>('/payroll/compensation', payload);
  return data;
}

/** 409, если на эту ставку уже опирается APPROVED/PAID лист. */
export async function deleteCompensation(id: string) {
  const { data } = await api.delete<{ ok: true }>(`/payroll/compensation/${id}`);
  return data;
}
