import { Navigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import type { Role } from '../api/types';

type Props = {
  children: React.ReactNode;
  /**
   * Необязательный список ролей, которым разрешена страница. Без него —
   * доступ любому авторизованному пользователю (как и раньше).
   *
   * БАГ 3 аудита: /activity и /users раньше были «защищены» только тем,
   * что пункт меню скрывался для EMPLOYEE (Sidebar.tsx) — сам роутинг
   * ничего не проверял, и прямой переход по URL открывал страницу.
   */
  roles?: Role[];
};

export default function ProtectedRoute({ children, roles }: Props) {
  const user = useAuth((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
