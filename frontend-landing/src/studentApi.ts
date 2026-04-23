import axios from 'axios';

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';
export const API_BASE = API_URL.replace(/\/api$/, '');

const TOKEN_KEY = 'grantchina_student_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

const client = axios.create({ baseURL: API_URL });
client.interceptors.request.use((cfg) => {
  const token = getToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

export type StudentDoc = {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  type: string;
  createdAt: string;
};

export type StudentMe = {
  id: string;
  fullName: string;
  email: string | null;
  phones: string[];
  direction: 'BACHELOR' | 'MASTER' | 'LANGUAGE';
  cabinet: number;
  status: 'ACTIVE' | 'PAUSED' | 'GRADUATED' | 'ARCHIVED';
  comment: string | null;
  photoUrl: string | null;
  documents: StudentDoc[];
  manager: { id: string; fullName: string; email: string } | null;
  chinaManager: { id: string; fullName: string; email: string } | null;
  createdAt: string;
};

export async function studentLogin(email: string, password: string) {
  const { data } = await client.post<{ token: string; student: { id: string; email: string; fullName: string } }>(
    '/student-auth/login',
    { email, password },
  );
  setToken(data.token);
  return data;
}

export async function studentMe() {
  const { data } = await client.get<StudentMe>('/student-auth/me');
  return data;
}

export async function studentUploadDocument(file: File, type: string) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('type', type);
  const { data } = await client.post<StudentDoc>('/student-auth/documents', fd);
  return data;
}

export async function studentDeleteDocument(id: string) {
  const { data } = await client.delete(`/student-auth/documents/${id}`);
  return data;
}
