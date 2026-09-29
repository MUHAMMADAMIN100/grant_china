import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../store/auth';
import Icon from '../Icon';
import ChangePasswordModal from './ChangePasswordModal';
import TelegramLinkModal from './TelegramLinkModal';

/**
 * Личные действия сотрудника: уведомления в Telegram, смена пароля, выход.
 *
 * 29.09.2026 — вынесено из Sidebar в общий компонент. На телефоне (≤720px)
 * весь блок пользователя внизу меню скрыт (`.sidebar-user { display: none }`),
 * и вместе с ним пропадали все три кнопки: с телефона нельзя было подключить
 * Telegram, сменить пароль и даже выйти. Теперь те же кнопки стоят и в шапке
 * мобильной версии — одним компонентом, чтобы на обоих экранах вели себя
 * одинаково.
 *
 * Окна рендерятся порталом в body. В мобильной шапке это обязательно: шапка —
 * липкий слой с z-index 10 под липким меню (z-index 50), и окно, открытое
 * изнутри неё, оказалось бы под полосой меню.
 */
export default function UserActions({ variant }: { variant: 'sidebar' | 'topbar' }) {
  const logout = useAuth((s) => s.logout);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [tgOpen, setTgOpen] = useState(false);
  // В тёмном меню — прежние светлые иконки без подложки; в белой шапке —
  // квадратные кнопки как у колокольчика уведомлений рядом.
  const cls = variant === 'sidebar' ? 'logout-btn' : 'topbar-icon-btn';

  return (
    <>
      {/* 12.08.2026 — подключение личного Telegram: уведомления CRM
          дублируются в мессенджер. Рядом со сменой пароля, потому что это
          такая же личная настройка сотрудника, а не раздел системы. */}
      <motion.button
        className={cls}
        onClick={() => setTgOpen(true)}
        title="Уведомления в Telegram"
        aria-label="Уведомления в Telegram"
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.9 }}
        data-testid={`${variant}-telegram`}
      >
        <Icon name="send" size={20} />
      </motion.button>
      <motion.button
        className={cls}
        onClick={() => setPwdOpen(true)}
        title="Сменить пароль"
        aria-label="Сменить пароль"
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.9 }}
        data-testid={`${variant}-password`}
      >
        <Icon name="lock_reset" size={20} />
      </motion.button>
      <motion.button
        className={cls}
        onClick={logout}
        title="Выйти"
        aria-label="Выйти"
        whileHover={{ scale: 1.15, rotate: 15 }}
        whileTap={{ scale: 0.9 }}
        data-testid={`${variant}-logout`}
      >
        <Icon name="logout" size={20} />
      </motion.button>
      {createPortal(
        <>
          <TelegramLinkModal open={tgOpen} onClose={() => setTgOpen(false)} />
          <ChangePasswordModal open={pwdOpen} mode={{ kind: 'self' }} onClose={() => setPwdOpen(false)} />
        </>,
        document.body,
      )}
    </>
  );
}
