export type Role = 'ADMIN' | 'EMPLOYEE';
export type Direction = 'BACHELOR' | 'MASTER' | 'LANGUAGE';
export type ApplicationStatus = 'NEW' | 'IN_PROGRESS' | 'COMPLETED';
export type StudentStatus = 'ACTIVE' | 'PAUSED' | 'GRADUATED' | 'ARCHIVED';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  createdAt?: string;
}

export interface Application {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  direction: Direction;
  comment: string | null;
  status: ApplicationStatus;
  studentId: string | null;
  student?: Student | null;
  createdAt: string;
}

export interface Document {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  type: string;
  createdAt: string;
}

export interface Student {
  id: string;
  fullName: string;
  phones: string[];
  email: string | null;
  photoUrl: string | null;
  direction: Direction;
  cabinet: number;
  status: StudentStatus;
  comment: string | null;
  documents?: Document[];
  applications?: Application[];
  createdAt: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  payload: any;
  read: boolean;
  createdAt: string;
}

export const DIRECTION_LABEL: Record<Direction, string> = {
  BACHELOR: 'Бакалавриат',
  MASTER: 'Магистратура',
  LANGUAGE: 'Языковые курсы',
};

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  NEW: 'Новая',
  IN_PROGRESS: 'В работе',
  COMPLETED: 'Завершена',
};

export const STUDENT_STATUS_LABEL: Record<StudentStatus, string> = {
  ACTIVE: 'Активный',
  PAUSED: 'Приостановлен',
  GRADUATED: 'Выпустился',
  ARCHIVED: 'В архиве',
};

export const STATUS_BADGE: Record<ApplicationStatus, string> = {
  NEW: 'badge-info',
  IN_PROGRESS: 'badge-warning',
  COMPLETED: 'badge-success',
};

export const STUDENT_STATUS_BADGE: Record<StudentStatus, string> = {
  ACTIVE: 'badge-success',
  PAUSED: 'badge-warning',
  GRADUATED: 'badge-info',
  ARCHIVED: 'badge-gray',
};
