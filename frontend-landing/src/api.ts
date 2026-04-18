const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';

export type Direction = 'BACHELOR' | 'MASTER' | 'LANGUAGE';

export interface ApplicationPayload {
  fullName: string;
  phone: string;
  email?: string;
  direction: Direction;
  comment?: string;
}

export async function submitApplication(payload: ApplicationPayload) {
  const res = await fetch(`${API_URL}/applications/public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Не удалось отправить заявку');
  }
  return res.json();
}
