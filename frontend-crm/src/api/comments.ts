import { api } from './client';

// ============================================================================
// Раздел 6.3 ТЗ (волна 4) — лента текстовых комментариев в карточке студента/
// заявки. Контракт зеркалит backend/src/comments/ (comments.controller.ts,
// comments.service.ts). В личном кабинете студента этих эндпоинтов нет —
// комментарий по умолчанию внутренний (CommentVisibility.INTERNAL).
// ============================================================================

export interface CommentAuthor {
  id: string;
  fullName: string;
}

export interface Comment {
  id: string;
  body: string;
  studentId: string | null;
  applicationId: string | null;
  authorId: string | null;
  author?: CommentAuthor | null;
  /** Заполнено, если текст правили после публикации — лента обязана честно это показывать. */
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommentsPage {
  items: Comment[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CommentListFilters {
  studentId?: string;
  applicationId?: string;
  page?: number;
  pageSize?: number;
}

export async function listComments(filters: CommentListFilters) {
  const { data } = await api.get<CommentsPage>('/comments', { params: filters });
  return data;
}

export interface CreateCommentPayload {
  studentId?: string;
  applicationId?: string;
  body: string;
}

export async function createComment(payload: CreateCommentPayload) {
  const { data } = await api.post<Comment>('/comments', payload);
  return data;
}

export async function updateComment(id: string, body: string) {
  const { data } = await api.patch<Comment>(`/comments/${id}`, { body });
  return data;
}

/** Soft-delete. Только автор либо FOUNDER/ADMIN — проверяет бэкенд. */
export async function deleteComment(id: string) {
  const { data } = await api.delete<{ ok: true }>(`/comments/${id}`);
  return data;
}
