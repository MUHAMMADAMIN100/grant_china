import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { studentLogin, getToken } from '../studentApi';
import Icon from '../Icon';

export default function StudentLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (getToken()) {
    navigate('/cabinet', { replace: true });
    return null;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await studentLogin(email.trim(), password);
      navigate('/cabinet');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Неверный email или пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stu-login-page">
      <motion.div
        className="stu-login-card"
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <Link to="/" className="stu-login-home">
          <Icon name="arrow_back" size={18} />
          На главную
        </Link>

        <div className="stu-login-brand">
          <img src="/logo.png" alt="Grant China" />
        </div>

        <h2 className="stu-login-title">Личный кабинет студента</h2>
        <p className="stu-login-sub">
          Войдите, используя email и пароль, которые выдал вам менеджер Grant China.
        </p>

        {error && (
          <motion.div
            className="stu-login-error"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: [0, -6, 6, -4, 4, 0] }}
            transition={{ duration: 0.4 }}
          >
            <Icon name="error" size={18} /> {error}
          </motion.div>
        )}

        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="form-row">
            <label>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль, выданный менеджером"
              required
              autoComplete="current-password"
            />
          </div>
          <motion.button
            type="submit"
            className="btn btn-primary btn-large"
            style={{ width: '100%' }}
            disabled={loading}
            whileHover={!loading ? { scale: 1.02, y: -2 } : {}}
            whileTap={!loading ? { scale: 0.98 } : {}}
          >
            {loading ? 'Вход...' : 'Войти'}
          </motion.button>
        </form>

        <p className="stu-login-hint">
          Нет аккаунта? Оставьте заявку на <Link to="/#apply">главной</Link> — мы создадим вам личный кабинет после первого контакта.
        </p>
      </motion.div>
    </div>
  );
}
