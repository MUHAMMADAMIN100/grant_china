import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ManagerInfo, User } from '../api/types';
import { listUsers } from '../api/users';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import Icon from '../Icon';

type Props = {
  manager: ManagerInfo | null | undefined;
  canEditNow: boolean;
  onReassign: (managerId: string | null) => Promise<void>;
};

export default function ManagerBar({ manager, canEditNow, onReassign }: Props) {
  const me = useAuth((s) => s.user);
  const { toast } = useUI();
  const [users, setUsers] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const isAdmin = me?.role === 'ADMIN';
  const isMine = manager?.id === me?.id;

  useEffect(() => {
    if (isAdmin) {
      listUsers().then(setUsers).catch(() => {});
    }
  }, [isAdmin]);

  const pick = async (userId: string | null) => {
    setSaving(true);
    try {
      await onReassign(userId);
      toast('Менеджер обновлён', 'success');
      setOpen(false);
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка переназначения', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`manager-bar${isMine ? ' manager-bar-mine' : ''}${!manager ? ' manager-bar-empty' : ''}`}>
      <div className="manager-bar-label">
        <Icon name="account_circle" size={22} />
        <div>
          <div className="manager-bar-title">Менеджер</div>
          <div className="manager-bar-name">
            {manager ? manager.fullName : 'Не назначен'}
            {isMine && <span className="manager-bar-you">(вы)</span>}
          </div>
        </div>
      </div>
      {isAdmin && (
        <div className="manager-bar-actions">
          <motion.button
            className="btn btn-sm btn-secondary"
            onClick={() => setOpen((o) => !o)}
            disabled={saving}
            whileTap={{ scale: 0.95 }}
          >
            <Icon name="edit" size={16} style={{ marginRight: 4 }} />
            Переназначить
          </motion.button>
          <AnimatePresence>
            {open && (
              <motion.div
                className="manager-dropdown"
                initial={{ opacity: 0, y: -5, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -5, scale: 0.97 }}
                transition={{ duration: 0.18 }}
              >
                <div className="manager-dropdown-list">
                  {users.map((u) => (
                    <button
                      key={u.id}
                      className={`manager-dropdown-item${u.id === manager?.id ? ' active' : ''}`}
                      onClick={() => pick(u.id)}
                      disabled={saving}
                    >
                      <Icon name={u.id === manager?.id ? 'radio_button_checked' : 'radio_button_unchecked'} size={18} />
                      <div>
                        <div className="manager-dropdown-name">{u.fullName}</div>
                        <div className="manager-dropdown-role">
                          {u.role === 'ADMIN' ? 'Администратор' : 'Сотрудник'}
                        </div>
                      </div>
                    </button>
                  ))}
                  {manager && (
                    <button
                      className="manager-dropdown-item manager-dropdown-clear"
                      onClick={() => pick(null)}
                      disabled={saving}
                    >
                      <Icon name="person_off" size={18} />
                      Снять менеджера
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      {!isAdmin && !isMine && manager && canEditNow === false && (
        <div className="manager-bar-hint">
          <Icon name="lock" size={16} />
          Только менеджер может редактировать
        </div>
      )}
    </div>
  );
}
