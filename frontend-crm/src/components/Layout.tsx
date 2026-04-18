import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';

const TITLES: Record<string, string> = {
  '/dashboard': 'Дашборд',
  '/applications': 'Заявки',
  '/students': 'Студенты',
  '/users': 'Пользователи',
};

export default function Layout() {
  const loc = useLocation();
  const title = Object.entries(TITLES).find(([k]) => loc.pathname.startsWith(k))?.[1] || 'GrantChina CRM';

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main">
        <div className="topbar">
          <div className="topbar-title">{title}</div>
          <div className="topbar-actions">
            <NotificationBell />
          </div>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
