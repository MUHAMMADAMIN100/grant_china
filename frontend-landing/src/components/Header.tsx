import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import Icon from '../Icon';

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: '/#services', label: 'Программы' },
  { href: '/#directions', label: 'Направления' },
  { href: '/#advantages', label: 'Преимущества' },
  { href: '/#testimonials', label: 'Отзывы' },
  { href: '/#contacts', label: 'Контакты' },
];

export default function Header() {
  const [open, setOpen] = useState(false);

  // Блокируем прокрутку body, пока открыто мобильное меню
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Закрываем по Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <motion.header
      className="header"
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="container header-inner">
        <motion.a
          href="#"
          className="logo"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <img src="/logo.png" alt="Grant China" className="logo-image" />
        </motion.a>

        <nav className="nav nav-desktop">
          {NAV_ITEMS.map((item) => (
            <motion.a key={item.href} href={item.href} whileHover={{ y: -2 }}>
              {item.label}
            </motion.a>
          ))}
        </nav>

        <div className="header-actions header-actions-desktop">
          <Link to="/login" className="header-login">
            <Icon name="person" size={18} />
            <span>Вход</span>
          </Link>
          <motion.a
            href="#apply"
            className="btn btn-primary"
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
          >
            Оставить заявку
          </motion.a>
        </div>

        <button
          type="button"
          className="header-burger"
          aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? 'close' : 'menu'} size={26} />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="backdrop"
              className="header-mobile-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              key="drawer"
              className="header-mobile-drawer"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="header-mobile-top">
                <img src="/logo.png" alt="Grant China" className="logo-image" />
                <button
                  type="button"
                  className="header-mobile-close"
                  aria-label="Закрыть меню"
                  onClick={() => setOpen(false)}
                >
                  <Icon name="close" size={24} />
                </button>
              </div>

              <nav className="header-mobile-nav">
                {NAV_ITEMS.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>

              <div className="header-mobile-actions">
                <Link
                  to="/login"
                  className="btn btn-secondary"
                  onClick={() => setOpen(false)}
                >
                  <Icon name="person" size={18} />
                  <span>Вход</span>
                </Link>
                <a
                  href="#apply"
                  className="btn btn-primary"
                  onClick={() => setOpen(false)}
                >
                  Оставить заявку
                </a>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
