import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './store/auth';
import Login from './pages/Login';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';

/**
 * СТРАНИЦЫ ГРУЗЯТСЯ ПО ТРЕБОВАНИЮ.
 *
 * Раньше все 23 страницы импортировались статически и попадали в один файл:
 * 774 КБ (230 КБ сжатыми). Открывая карточку студента, браузер выкачивал заодно
 * код аналитики, зарплатной ведомости, базы знаний, чатов, договоров и всего
 * остального — и только потом начинал рисовать. На быстром канале это ~0.5 с,
 * на медленном мобильном — секунды сплошного белого экрана. Vite ровно на это
 * и ругался предупреждением про чанки больше 500 КБ.
 *
 * Теперь каждая страница — отдельный кусок, который скачивается при первом
 * заходе на неё. Login и Layout оставлены статическими намеренно: Login нужен
 * до всякой навигации, Layout рисуется на каждой странице, и вынос их в
 * отдельные запросы только добавил бы задержку.
 */
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Applications = lazy(() => import('./pages/Applications'));
const ApplicationDetail = lazy(() => import('./pages/ApplicationDetail'));
const Consultations = lazy(() => import('./pages/Consultations'));
const Students = lazy(() => import('./pages/Students'));
const StudentDetail = lazy(() => import('./pages/StudentDetail'));
const StudentNew = lazy(() => import('./pages/StudentNew'));
const Users = lazy(() => import('./pages/Users'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Programs = lazy(() => import('./pages/Programs'));
const Activity = lazy(() => import('./pages/Activity'));
const Payments = lazy(() => import('./pages/Payments'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Contracts = lazy(() => import('./pages/Contracts'));
const ContractDetail = lazy(() => import('./pages/ContractDetail'));
const MyPayroll = lazy(() => import('./pages/MyPayroll'));
const Payroll = lazy(() => import('./pages/Payroll'));
const PayrollRules = lazy(() => import('./pages/PayrollRules'));
const Grants = lazy(() => import('./pages/Grants'));
const Tickets = lazy(() => import('./pages/Tickets'));
const Knowledge = lazy(() => import('./pages/Knowledge'));
const Conversations = lazy(() => import('./pages/Conversations'));

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
    // Suspense обязателен при lazy-страницах: пока кусок скачивается, React
    // должен что-то показать. Каркас, а не «Загрузка...» — пустое место
    // читается как сломанная страница, контур как загружающаяся.
    <Suspense
      fallback={
        <div className="card">
          <div className="card-body">
            <div className="skeleton-line" style={{ width: '45%' }} />
            <div className="skeleton-line" style={{ width: '65%' }} />
            <div className="skeleton-line" style={{ width: '35%' }} />
          </div>
        </div>
      }
    >
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
    </Suspense>
  );
}
