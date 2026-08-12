import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';
import AiAssistant from './AiAssistant';
import IncomingCallPopup from './IncomingCallPopup';

const TITLES: Record<string, string> = {
  '/dashboard': 'Дашборд',
  '/applications': 'Заявки',
  '/consultations': 'Консультации',
  '/students': 'Студенты',
  '/conversations': 'Диалоги',
  '/finance': 'Финансы',
  '/contracts': 'Договоры',
  '/grants': 'Гранты',
  '/tickets': 'Билеты',
  '/programs': 'Программы',
  '/tasks': 'Задачи',
  '/knowledge': 'База знаний',
  '/my-payroll': 'Моя зарплата',
  '/payroll': 'Зарплаты',
  '/analytics': 'Аналитика',
  '/activity': 'Активность',
  '/users': 'Пользователи',
};

/**
 * Заголовок раздела по адресу страницы.
 *
 * Раньше это был `.find(([k]) => pathname.startsWith(k))` — ПЕРВОЕ совпадение
 * по порядку объявления объекта. Такая логика зависит от того, в каком порядке
 * написаны ключи, и от того, не является ли один путь префиксом другого: стоит
 * добавить раздел с адресом, начинающимся так же, как существующий, — и в
 * шапке окажется чужое название, а найти причину по виду кода почти невозможно.
 *
 * Теперь сначала ищется ТОЧНОЕ совпадение, и только потом — самый ДЛИННЫЙ
 * подходящий префикс (чтобы вложенные страницы вроде /contracts/:id и
 * /payroll/rules наследовали заголовок своего раздела).
 */
function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  const match = Object.keys(TITLES)
    .filter((k) => pathname === k || pathname.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? TITLES[match] : 'GrantChina CRM';
}

export default function Layout() {
  const loc = useLocation();
  const title = titleFor(loc.pathname);

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main">
        <motion.div
          className="topbar"
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {/* БЕЗ AnimatePresence mode="wait" — НАМЕРЕННО (баг 12.08.2026).
              Прежняя схема показывала новый заголовок только после того, как
              старый доиграет анимацию ухода. Если анимация прерывалась —
              быстрые клики по меню, свёрнутая вкладка, планшет в фоне (rAF
              приостановлен и exit не завершается никогда) — очередь ждала
              вечно, и в шапке на ВСЕХ разделах застревало чужое название
              («Договоры» на Билетах и Студентах). Заголовок обязан быть
              синхронен с адресом строки браузера в ту же отрисовку; анимация
              допустима только входная — она не является условием показа. */}
          <motion.div
            key={title}
            className="topbar-title"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
          >
            {title}
          </motion.div>
          <div className="topbar-actions">
            <NotificationBell />
          </div>
        </motion.div>
        <div className="content">
          {/* Тот же отказ от AnimatePresence mode="wait", что у заголовка
              выше, и по той же причине: здесь зависший exit оставил бы на
              экране ЦЕЛУЮ прежнюю страницу. Смена раздела обязана показывать
              новый раздел немедленно; входная анимация — украшение, а не
              условие показа. */}
          <motion.div
            key={loc.pathname}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </div>
      </div>
      {/* ТЗ 6.1 и 6.2 — живут в Layout, а не на конкретной странице: помощник
          нужен там, где сотрудник застрял, а входящий звонок застаёт его на
          любом экране. Оба компонента сами прячутся, когда интеграция не
          настроена. */}
      <AiAssistant />
      <IncomingCallPopup />
    </div>
  );
}
