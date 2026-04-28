import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { changePassword } from '../api/auth';
import { updateUser } from '../api/users';
import { useUI } from '../ui/Dialogs';
import Icon from '../Icon';

type Mode =
  | { kind: 'self' }
  | { kind: 'admin'; userId: string; userName: string };

type Props = {
  open: boolean;
  mode: Mode;
  onClose: () => void;
};

export default function ChangePasswordModal({ open, mode, onClose }: Props) {
  const { toast } = useUI();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setErr(null);
    setBusy(false);
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (next.length < 8) {
      setErr('Новый пароль: минимум 8 символов');
      return;
    }
    if (next !== confirm) {
      setErr('Пароли не совпадают');
      return;
    }
    setBusy(true);
    try {
      if (mode.kind === 'self') {
        await changePassword(current, next);
      } else {
        await updateUser(mode.userId, { password: next });
      }
      toast('Пароль обновлён', 'success');
      reset();
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.message?.toString() || 'Не удалось сменить пароль');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="dialog-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.form
            className="dialog-card"
            style={{ maxWidth: 420 }}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
          >
            <div className="dialog-icon">
              <Icon name="lock_reset" size={28} />
            </div>
            <div className="dialog-title">
              {mode.kind === 'self' ? 'Сменить пароль' : `Пароль: ${mode.userName}`}
            </div>
            <div className="dialog-message" style={{ marginBottom: 16 }}>
              {mode.kind === 'self'
                ? 'Укажите текущий и новый пароль.'
                : 'Установите новый пароль для этого сотрудника.'}
            </div>

            {err && (
              <div className="error-banner" style={{ marginBottom: 12, textAlign: 'left' }}>
                {err}
              </div>
            )}

            {mode.kind === 'self' && (
              <div className="form-group" style={{ textAlign: 'left', marginBottom: 12 }}>
                <label>Текущий пароль</label>
                <input
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            )}
            <div className="form-group" style={{ textAlign: 'left', marginBottom: 12 }}>
              <label>Новый пароль (мин. 8 симв.)</label>
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                minLength={8}
                autoFocus={mode.kind === 'admin'}
              />
            </div>
            <div className="form-group" style={{ textAlign: 'left', marginBottom: 16 }}>
              <label>Повторите новый пароль</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
              />
            </div>

            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
                Отмена
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
