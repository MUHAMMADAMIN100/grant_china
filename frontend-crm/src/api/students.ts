import { api } from './client';
import type { Direction, Document, Student, StudentStatus } from './types';

export interface StudentFilters {
  direction?: Direction;
  status?: StudentStatus;
  cabinet?: number;
  search?: string;
  mine?: boolean;
}

export async function listStudents(filters: StudentFilters = {}) {
  const { data } = await api.get<Student[]>('/students', { params: filters });
  return data;
}

export async function getStudent(id: string) {
  const { data } = await api.get<Student>(`/students/${id}`);
  return data;
}

export async function createStudent(payload: Partial<Student>) {
  const { data } = await api.post<Student>('/students', payload);
  return data;
}

export async function updateStudent(id: string, payload: Partial<Student>) {
  const { data } = await api.patch<Student>(`/students/${id}`, payload);
  return data;
}

export async function assignStudentManager(id: string, managerId: string | null) {
  const { data } = await api.patch<Student>(`/students/${id}/manager`, { managerId });
  return data;
}

export async function deleteStudent(id: string) {
  const { data } = await api.delete(`/students/${id}`);
  return data;
}

export async function uploadPhoto(id: string, file: File) {
  const fd = new FormData(); fd.append('file', file);
  const { data } = await api.post<Student>(`/students/${id}/photo`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function uploadDocument(id: string, file: File, type: string = 'OTHER') {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('type', type);
  const { data } = await api.post<Document>(`/students/${id}/documents`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function deleteDocument(docId: string) {
  const { data } = await api.delete(`/students/documents/${docId}`);
  return data;
}

export async function studentStats() {
  const { data } = await api.get('/students/stats');
  return data;
}
