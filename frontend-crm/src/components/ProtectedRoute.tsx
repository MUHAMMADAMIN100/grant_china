import { Navigate } from 'react-router-dom';
import { useAuth } from '../store/auth';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
