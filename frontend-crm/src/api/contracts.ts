import { api } from './client';
import type { Contract, ContractStatus } from './types';

// ============================================================================
// Раздел 5 ТЗ (волна 6) — договоры. РЕШЕНИЕ ЗАКАЗЧИКА: договор — ОТДЕЛЬНАЯ
// СУЩНОСТЬ, не статус заявки. Контракт зеркалит backend/src/contracts/
// (contracts.controller.ts, contracts.service.ts).
// ============================================================================

export interface ContractFilters {
  status?: ContractStatus;
  managerId?: string;
  studentId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ContractsPage {
  items: Contract[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listContracts(filters: ContractFilters = {}) {
  const { data } = await api.get<ContractsPage>('/contracts', { params: filters });
  return data;
}

export interface ContractStats {
  total: number;
  draft: number;
  signed: number;
  terminated: number;
  completed: number;
}

export async function contractStats() {
  const { data } = await api.get<ContractStats>('/contracts/stats');
  return data;
}

export async function getContract(id: string) {
  const { data } = await api.get<Contract>(`/contracts/${id}`);
  return data;
}

export interface CreateContractPayload {
  studentId: string;
  applicationId?: string;
  /** 0 разрешён явно — договор может готовиться до согласования суммы. */
  amount?: string;
  /** Только FOUNDER/ADMIN может назначить ответственного, отличного от менеджера студента (проверяет бэкенд). */
  managerId?: string;
  note?: string;
}

export async function createContract(payload: CreateContractPayload) {
  const { data } = await api.post<Contract>('/contracts', payload);
  return data;
}

export interface UpdateContractPayload {
  amount?: string;
  applicationId?: string | null;
  managerId?: string | null;
  note?: string | null;
}

/** Поля amount/applicationId/managerId заморожены после подписания для всех, кроме FOUNDER (проверяет бэкенд). */
export async function updateContract(id: string, payload: UpdateContractPayload) {
  const { data } = await api.patch<Contract>(`/contracts/${id}`, payload);
  return data;
}

/** 'YYYY-MM-DD'. Если не передано — сегодня. Не может быть в будущем. */
export async function signContract(id: string, signedAt?: string) {
  const { data } = await api.post<Contract>(`/contracts/${id}/sign`, signedAt ? { signedAt } : {});
  return data;
}

/** Только FOUNDER/ADMIN, причина обязательна. */
export async function terminateContract(id: string, reason: string) {
  const { data } = await api.post<Contract>(`/contracts/${id}/terminate`, { reason });
  return data;
}

export async function completeContract(id: string) {
  const { data } = await api.post<Contract>(`/contracts/${id}/complete`);
  return data;
}

/** Soft-delete, только DRAFT. Только FOUNDER. */
export async function deleteContract(id: string) {
  const { data } = await api.delete<{ ok: true }>(`/contracts/${id}`);
  return data;
}

/** Разовая ручная привязка легаси-платежей студента (contractId=null) к подписанному договору. Только FOUNDER. */
export async function linkContractPayments(id: string) {
  const { data } = await api.post<{ paymentsLinked: number; scheduleLinked: number }>(`/contracts/${id}/link-payments`);
  return data;
}
