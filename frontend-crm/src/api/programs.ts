import { api } from './client';
import type { Direction } from './types';

export interface Program {
  id: string;
  name: string;
  university: string;
  city: string;
  major: string;
  direction: Direction;
  cost: number;
  currency: string;
  duration: string | null;
  language: string | null;
  description: string | null;
  imageUrl: string | null;
  published: boolean;
  createdAt: string;
}

export async function listPrograms(filters?: { city?: string; major?: string; direction?: Direction; search?: string }) {
  const { data } = await api.get<Program[]>('/programs', { params: filters });
  return data;
}

export async function getProgram(id: string) {
  const { data } = await api.get<Program>(`/programs/${id}`);
  return data;
}

export async function createProgram(payload: Partial<Program>) {
  const { data } = await api.post<Program>('/programs', payload);
  return data;
}

export async function updateProgram(id: string, payload: Partial<Program>) {
  const { data } = await api.patch<Program>(`/programs/${id}`, payload);
  return data;
}

export async function deleteProgram(id: string) {
  const { data } = await api.delete(`/programs/${id}`);
  return data;
}
