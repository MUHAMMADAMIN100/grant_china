import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './store/auth';
import Login from './pages/Login';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Dashboard from './pages/Dashboard';
import Applications from './pages/Applications';
import ApplicationDetail from './pages/ApplicationDetail';
import Students from './pages/Students';
import StudentDetail from './pages/StudentDetail';
import StudentNew from './pages/StudentNew';
import Users from './pages/Users';
import Tasks from './pages/Tasks';
import Programs from './pages/Programs';
import Activity from './pages/Activity';
import Payments from './pages/Payments';
import Analytics from './pages/Analytics';

export default function App() {
  const init = useAuth((s) => s.init);
  const initialized = useAuth((s) => s.initialized);

  useEffect(() => { init(); }, [init]);

  if (!initialized) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        Загрузка...
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/applications/:id" element={<ApplicationDetail />} />
        <Route path="/students" element={<Students />} />
        <Route path="/students/new" element={<StudentNew />} />
        <Route path="/students/:id" element={<StudentDetail />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/programs" element={<Programs />} />
        {/* Доступна всем ролям — содержимое (очередь на одобрение, кнопки
            одобрения) режется внутри самой страницы по роли, как /dashboard
            и /students. Отдельный ProtectedRoute roles не нужен. */}
        <Route path="/finance" element={<Payments />} />
        {/* /users, /activity и /analytics — только FOUNDER и ADMIN (БАГ 3
            аудита: раньше роутинг это не проверял, доступ ограничивался лишь
            скрытием пункта меню, что не мешало прямому переходу по URL).
            /analytics — ТЗ 2.6, финансовая аналитика видна только руководству. */}
        <Route
          path="/users"
          element={
            <ProtectedRoute roles={['FOUNDER', 'ADMIN']}>
              <Users />
            </ProtectedRoute>
          }
        />
        <Route
          path="/activity"
          element={
            <ProtectedRoute roles={['FOUNDER', 'ADMIN']}>
              <Activity />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analytics"
          element={
            <ProtectedRoute roles={['FOUNDER', 'ADMIN']}>
              <Analytics />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
