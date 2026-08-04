import { api } from './client';

// ============================================================================
// ТЗ 6.1 — база знаний и AI-помощник. Контракт зеркалит backend/src/knowledge/
// и backend/src/ai/.
// ============================================================================

export interface KnowledgeCategory {
  value: string;
  label: string;
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  category: string;
  body: string;
  tags: string[];
  published: boolean;
  sortOrder: number;
  createdById: string | null;
  createdBy: { id: string; fullName: string } | null;
  updatedById: string | null;
  updatedBy: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export async function listKnowledgeCategories() {
  const { data } = await api.get<{ items: KnowledgeCategory[] }>('/knowledge/categories');
  return data.items;
}

export async function listKnowledge(filters: { category?: string; search?: string; drafts?: boolean } = {}) {
  const { data } = await api.get<KnowledgeArticle[]>('/knowledge', {
    params: { ...filters, drafts: filters.drafts ? 'true' : undefined },
  });
  return data;
}

export async function getKnowledgeArticle(id: string) {
  const { data } = await api.get<KnowledgeArticle>(`/knowledge/${id}`);
  return data;
}

export interface KnowledgeArticlePayload {
  title: string;
  category?: string;
  body: string;
  tags?: string[];
  published?: boolean;
  sortOrder?: number;
}

export async function createKnowledgeArticle(payload: KnowledgeArticlePayload) {
  const { data } = await api.post<KnowledgeArticle>('/knowledge', payload);
  return data;
}

export async function updateKnowledgeArticle(id: string, payload: Partial<KnowledgeArticlePayload>) {
  const { data } = await api.patch<KnowledgeArticle>(`/knowledge/${id}`, payload);
  return data;
}

export async function deleteKnowledgeArticle(id: string) {
  const { data } = await api.delete<{ ok: true }>(`/knowledge/${id}`);
  return data;
}

// ---------------------------------------------------------------------------
// AI-помощник
// ---------------------------------------------------------------------------

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface AiHistory {
  items: AiChatMessage[];
  /** false — администратор не настроил ключ, виджет прячем. */
  enabled: boolean;
}

export async function aiHistory() {
  const { data } = await api.get<AiHistory>('/ai/history');
  return data;
}

export interface AiAnswer {
  answer: string;
  /** Сколько статей базы реально попало в контекст — прозрачность для сотрудника. */
  articles: number;
  /**
   * Сколько студентов помощник видел, отвечая. Важно показывать: когда он
   * считает («у скольких нет визы»), сотрудник должен понимать, по какому
   * множеству посчитано, иначе неполный подсчёт выглядит точным.
   */
  students: number;
  /** true — данные не влезли в контекст целиком, ответ мог быть неполным. */
  truncated: boolean;
  model: string;
}

export async function aiAsk(question: string) {
  const { data } = await api.post<AiAnswer>('/ai/ask', { question });
  return data;
}

export async function aiClearHistory() {
  const { data } = await api.delete<{ ok: true }>('/ai/history');
  return data;
}
