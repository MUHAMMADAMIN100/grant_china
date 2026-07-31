import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './store/auth';
import Login from './pages/Login';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Dashboard from './pages/Dashboard';
import Applications from './pages/Applications';
import ApplicationDetail from './pages/ApplicationDetail';
import Consultations from './pages/Consultations';
import Students from './pages/Students';
import StudentDetail from './pages/StudentDetail';
import StudentNew from './pages/StudentNew';
import Users from './pages/Users';
import Tasks from './pages/Tasks';
import Programs from './pages/Programs';
import Activity from './pages/Activity';
import Payments from './pages/Payments';
import Analytics from './pages/Analytics';
import Contracts from './pages/Contracts';
import ContractDetail from './pages/ContractDetail';
import MyPayroll from './pages/MyPayroll';
import Payroll from './pages/Payroll';
import PayrollRules from './pages/PayrollRules';
import Grants from './pages/Grants';
import Tickets from './pages/Tickets';
import Knowledge from './pages/Knowledge';
import Conversations from './pages/Conversations';

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
        {/* ТЗ 3.2 — доступна всем ролям, видимость (свои/все консультации)
            режется внутри ConsultationsService, как /finance и /dashboard. */}
        <Route path="/consultations" element={<Consultations />} />
        <Route path="/students" element={<Students />} />
        <Route path="/students/new" element={<StudentNew />} />
        <Route path="/students/:id" element={<StudentDetail />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/programs" element={<Programs />} />
        {/* Доступна всем ролям — содержимое (очередь на одобрение, кнопки
            одобрения) режется внутри самой страницы по роли, как /dashboard
            и /students. Отдельный ProtectedRoute roles не нужен. */}
        <Route path="/finance" element={<Payments />} />
        {/* Раздел 5 ТЗ (волна 6) — договоры. РЕШЕНИЕ ЗАКАЗЧИКА: отдельная
            сущность. Видимость (свои/все) режется внутри ContractsService,
            как /finance и /consultations — отдельный ProtectedRoute не нужен. */}
        <Route path="/contracts" element={<Contracts />} />
        <Route path="/contracts/:id" element={<ContractDetail />} />
        {/* ТЗ 4 — реестр грантов, ТЗ «Билеты» — учёт перелётов. Обе доступны
            всем ролям: видимость режется по владению студентом внутри
            GrantsService и TicketsService, как /finance и /contracts. */}
        <Route path="/grants" element={<Grants />} />
        <Route path="/tickets" element={<Tickets />} />
        {/* ТЗ 6.1 — база знаний: читают все, правят только FOUNDER/ADMIN
            (проверяет @Roles на бэкенде, кнопки скрыты внутри страницы).
            ТЗ 6.4 — единое окно диалогов, доступно всем сотрудникам. */}
        <Route path="/knowledge" element={<Knowledge />} />
        <Route path="/conversations" element={<Conversations />} />
        {/* ТЗ 5.2 «интерфейс сотрудника» — доступна всем ролям, каждый видит
            СТРОГО свои KPI и свой расчётный лист (userId только из JWT). */}
        <Route path="/my-payroll" element={<MyPayroll />} />
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
        {/* ТЗ 5.2 «интерфейс руководства» — сводная ведомость, утверждение
            начислений, фиксация выплат, формулы бонусов. Кнопки действий
            дополнительно сужены до FOUNDER внутри страниц (см. Payroll.tsx). */}
        <Route
          path="/payroll"
          element={
            <ProtectedRoute roles={['FOUNDER', 'ADMIN']}>
              <Payroll />
            </ProtectedRoute>
          }
        />
        <Route
          path="/payroll/rules"
          element={
            <ProtectedRoute roles={['FOUNDER', 'ADMIN']}>
              <PayrollRules />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
