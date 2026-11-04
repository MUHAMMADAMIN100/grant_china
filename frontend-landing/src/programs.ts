const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';

export interface Program {
  id: string;
  name: string;
  university: string;
  city: string;
  major: string;
  direction: 'BACHELOR' | 'MASTER' | 'LANGUAGE';
  /** Цена за год / за 1 семестр; null — не указана, хотя бы одна есть (04.11.2026). */
  cost: number | null;
  semesterCost: number | null;
  currency: string;
  duration: string | null;
  language: string | null;
  description: string | null;
  imageUrl: string | null;
  published: boolean;
  createdAt: string;
}

export async function listPublicPrograms(filters: {
  city?: string;
  major?: string;
  direction?: string;
  minCost?: number;
  maxCost?: number;
  /** 'year' (по умолчанию) или 'semester' — по какой цене сравнивать. */
  costPeriod?: 'year' | 'semester';
  search?: string;
} = {}): Promise<Program[]> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  });
  const res = await fetch(`${API_URL}/programs/public?${params}`);
  if (!res.ok) throw new Error('Не удалось загрузить программы');
  return res.json();
}

export async function getPublicProgramFilters(): Promise<{ cities: string[]; majors: string[] }> {
  const res = await fetch(`${API_URL}/programs/public/filters`);
  if (!res.ok) return { cities: [], majors: [] };
  return res.json();
}

export async function getPublicProgram(id: string): Promise<Program> {
  const res = await fetch(`${API_URL}/programs/public/${id}`);
  if (!res.ok) throw new Error('Программа не найдена');
  return res.json();
}
