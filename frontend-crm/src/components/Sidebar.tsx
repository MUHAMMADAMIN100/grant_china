import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../store/auth';
import { isPrivileged, ROLE_LABEL } from '../api/types';
import { pendingPaymentsCount } from '../api/payments';
import { conversationsUnreadCount } from '../api/messaging';
import { useRealtime } from '../realtime';
import Icon from '../Icon';
import UserActions from './UserActions';

/** 21.11.2026 — положение меню (свёрнуто/развёрнуто) помнит браузер сотрудника. */
const COLLAPSED_KEY = 'gc.sidebar.collapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};
/** Планшет (721–900px): меню и так узкое — только значки, без кнопки. */
const TABLET = '(min-width: 721px) and (max-width: 900px)';

export default function Sidebar() {
  const user = useAuth((s) => s.user);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [tablet, setTablet] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(TABLET).matches);
  // Подсказка с названием раздела у значка, когда подписи скрыты. Своя, а не
  // title: системная появляется через секунду и выглядит чужеродно.
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const iconsOnly = collapsed || tablet;

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* приватный режим — просто не запоминаем */
    }
    setTip(null);
  }, [collapsed]);

  useEffect(() => {
    const mq = window.matchMedia?.(TABLET);
    if (!mq) return;
    const on = () => setTablet(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  const showTip = (e: React.MouseEvent<HTMLElement>, label: string) => {
    if (!iconsOnly) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 10 });
  };
  const [pendingCount, setPendingCount] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);
  const initials = user?.fullName?.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';
  const isPriv = isPrivileged(user?.role);

  // Бейдж очереди на одобрение (ТЗ 1.1) — только FOUNDER/ADMIN видят чужие
  // неодобренные платежи (GET /payments/pending/count требует @Roles(FOUNDER, ADMIN)).
  const refreshPendingCount = () => {
    if (!isPriv) return;
    pendingPaymentsCount().then((r) => setPendingCount(r.count)).catch(() => {});
  };
  useEffect(refreshPendingCount, [isPriv]);

  // Бейдж непрочитанных сообщений (ТЗ 6.4). Счётчик считает бэкенд с учётом
  // видимости диалогов, поэтому доступен всем ролям — каждый видит свой срез.
  const refreshUnreadChats = () => {
    conversationsUnreadCount().then((r) => setUnreadChats(r.count)).catch(() => {});
  };
  useEffect(refreshUnreadChats, []);
  // 29.10.2026 — в заголовке вкладки браузера число чатов, которые ждут ответа:
  // видно, даже когда CRM открыта в фоновой вкладке.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\)\s*/, '');
    document.title = unreadChats > 0 ? `(${unreadChats > 99 ? '99+' : unreadChats}) ${base}` : base;
  }, [unreadChats]);

  useRealtime({
    'payment:submitted': refreshPendingCount,
    'payment:approved': refreshPendingCount,
    'payment:rejected': refreshPendingCount,
    'payment:recalled': refreshPendingCount,
    'payment:voided': refreshPendingCount,
    'payment:deleted': refreshPendingCount,
    'conversation:updated': refreshUnreadChats,
  });

  const links = [
    { to: '/dashboard', icon: 'dashboard', label: 'Дашборд' },
    { to: '/applications', icon: 'assignment', label: 'Заявки' },
    { to: '/funnel', icon: 'view_kanban', label: 'Воронка' },
    { to: '/consultations', icon: 'record_voice_over', label: 'Консультации' },
    { to: '/students', icon: 'school', label: 'Студенты' },
    // 29.09.2026 — архив студентов: все роли, менеджер видит там только своих.
    { to: '/archive', icon: 'inventory_2', label: 'Архив' },
    // ТЗ 6.4 — единое окно переписки из мессенджеров, доступно всем ролям
    // (непривязанные диалоги видны всем, как свободные заявки).
    { to: '/conversations', icon: 'forum', label: 'Диалоги', badge: unreadChats },
    { to: '/finance', icon: 'payments', label: 'Финансы', badge: isPriv ? pendingCount : 0 },
    // Раздел 5 ТЗ (волна 6) — договоры, доступны всем ролям (видимость
    // своих/чужих режется внутри ContractsService, как /finance).
    { to: '/contracts', icon: 'description', label: 'Договоры' },
    // ТЗ 4 — реестр грантов (кому продлевать в ближайший месяц) и
    // ТЗ «Билеты» — перелёты. Видимость режется по владению студентом.
    { to: '/grants', icon: 'workspace_premium', label: 'Гранты' },
    { to: '/tickets', icon: 'flight', label: 'Билеты' },
    { to: '/programs', icon: 'menu_book', label: 'Программы' },
    { to: '/tasks', icon: 'task_alt', label: 'Задачи' },
    // 09.11.2026 — «Аналитика» всем: вкладка «Продажи» (менеджеру — свои
    // цифры); «Финансы» внутри страницы — только руководству.
    { to: '/analytics', icon: 'insights', label: 'Аналитика' },
    // ТЗ 6.1 — регламенты компании. Читают все, правят FOUNDER/ADMIN.
    { to: '/knowledge', icon: 'auto_stories', label: 'База знаний' },
    // ТЗ 5.2 «интерфейс сотрудника» — своя зарплата и KPI, доступна ВСЕМ
    // ролям. Пункта «Ведомость» здесь нет намеренно — менеджер не должен
    // видеть чужую зарплату даже в виде пункта меню.
    { to: '/my-payroll', icon: 'account_balance_wallet', label: 'Моя зарплата' },
    // FOUNDER + ADMIN видят активность, зарплатную
    // ведомость и список пользователей. На странице /users редактирование
    // доступно только FOUNDER (бэк проверяет). Финансовая аналитика (ТЗ 2.6)
    // — вкладка внутри «Аналитики», тоже только руководству.
    ...(isPrivileged(user?.role) ? [
      // icon ОБЯЗАН быть существующим именем Material Symbols: компонент Icon
      // просто печатает имя внутрь элемента со шрифтом, и если лигатуры нет,
      // на экране остаётся сырой текст. Здесь стояло 'payroll' — такого имени
      // в наборе не существует, и в меню читалось «PAYROLL» поверх подписи.
      // TypeScript такое не ловит: принимается любая строка.
      { to: '/payroll', icon: 'request_quote', label: 'Зарплаты' },
      { to: '/activity', icon: 'history', label: 'Активность' },
      { to: '/users', icon: 'group', label: 'Пользователи' },
    ] : []),
  ];

  return (
    <motion.aside
      className={`sidebar${collapsed ? ' collapsed' : ''}`}
      initial={{ x: -80, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      data-testid="sidebar"
    >
      <div className="sidebar-logo">
        <span className="brand-text brand-full">
          <span className="brand-grant">GRANT</span>
          <span className="brand-china">CHINA</span>
        </span>
        <span className="brand-text brand-short" aria-hidden="true">
          <span className="brand-grant">G</span>
          <span className="brand-china">C</span>
        </span>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          aria-expanded={!collapsed}
          data-testid="sidebar-toggle"
        >
          <Icon name={collapsed ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left'} size={20} />
        </button>
      </div>
      <motion.nav
        className="sidebar-nav"
        initial="hidden"
        animate="show"
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: 0.07, delayChildren: 0.15 } },
        }}
      >
        {links.map((l) => (
          <motion.div
            key={l.to}
            variants={{
              hidden: { opacity: 0, x: -15 },
              show: { opacity: 1, x: 0, transition: { duration: 0.3 } },
            }}
          >
            <NavLink
              to={l.to}
              aria-label={l.label}
              onMouseEnter={(e) => showTip(e, l.label)}
              onMouseLeave={() => setTip(null)}
              onFocus={(e) => showTip(e as unknown as React.MouseEvent<HTMLElement>, l.label)}
              onBlur={() => setTip(null)}
              onClick={() => setTip(null)}
            >
              <motion.span
                className="sidebar-nav-icon"
                whileHover={{ scale: 1.2, rotate: 8 }}
                transition={{ type: 'spring', stiffness: 400 }}
              >
                <Icon name={l.icon} size={22} />
              </motion.span>
              <span className="sidebar-nav-label">{l.label}</span>
              {!!l.badge && <span className="sidebar-nav-badge">{l.badge > 99 ? '99+' : l.badge}</span>}
            </NavLink>
          </motion.div>
        ))}
      </motion.nav>
      <motion.div
        className="sidebar-user"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.3 }}
      >
        <motion.div
          className="user-avatar"
          whileHover={{ scale: 1.1 }}
          transition={{ type: 'spring', stiffness: 300 }}
        >
          {initials}
        </motion.div>
        <div className="user-info">
          <div className="user-name">{user?.fullName}</div>
          <div className="user-role">{user?.role ? ROLE_LABEL[user.role] : ''}</div>
        </div>
        {/* Telegram, смена пароля, выход — общий компонент: на телефоне этот
            блок скрыт, и те же кнопки стоят в шапке (см. Layout). */}
        <UserActions variant="sidebar" />
      </motion.div>
      {tip &&
        createPortal(
          <div className="sidebar-tip" style={{ top: tip.top, left: tip.left }} role="tooltip">
            {tip.label}
          </div>,
          document.body,
        )}
    </motion.aside>
  );
}
