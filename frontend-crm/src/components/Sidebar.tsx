import { NavLink } from 'react-router-dom';
import { useAuth } from '../store/auth';

export default function Sidebar() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const initials = user?.fullName?.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-mark">G</span>
        <span>GrantChina</span>
      </div>
      <nav className="sidebar-nav">
        <NavLink to="/dashboard"><span className="sidebar-nav-icon">📊</span><span>Дашборд</span></NavLink>
        <NavLink to="/applications"><span className="sidebar-nav-icon">📝</span><span>Заявки</span></NavLink>
        <NavLink to="/students"><span className="sidebar-nav-icon">🎓</span><span>Студенты</span></NavLink>
        {user?.role === 'ADMIN' && (
          <NavLink to="/users"><span className="sidebar-nav-icon">👥</span><span>Пользователи</span></NavLink>
        )}
      </nav>
      <div className="sidebar-user">
        <div className="user-avatar">{initials}</div>
        <div className="user-info">
          <div className="user-name">{user?.fullName}</div>
          <div className="user-role">{user?.role === 'ADMIN' ? 'Администратор' : 'Сотрудник'}</div>
        </div>
        <button className="logout-btn" onClick={logout} title="Выйти">⏻</button>
      </div>
    </aside>
  );
}
