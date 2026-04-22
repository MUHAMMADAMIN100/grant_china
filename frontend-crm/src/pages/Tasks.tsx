import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createTask, deleteTask, listTasks, updateTask } from '../api/tasks';
import { listUsers } from '../api/users';
import type { Task, TaskStatus, User } from '../api/types';
import { TASK_STATUS_BADGE, TASK_STATUS_LABEL } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import Icon from '../Icon';

type Scope = 'all' | 'mine';

export default function Tasks() {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const isAdmin = me?.role === 'ADMIN';
  const [items, setItems] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [scope, setScope] = useState<Scope>(isAdmin ? 'all' : 'mine');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', assignedToId: '' });
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listTasks(scope === 'mine');
      setItems(data);
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка загрузки', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [scope]);

  useEffect(() => {
    if (isAdmin) {
      listUsers().then(setUsers).catch(() => {});
    }
  }, [isAdmin]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim() || !form.assignedToId) {
      toast('Заполните все поля', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await createTask({
        title: form.title.trim(),
        description: form.description.trim(),
        assignedToId: form.assignedToId,
      });
      toast('Задача создана. Сотрудник получит email и уведомление.', 'success');
      setForm({ title: '', description: '', assignedToId: '' });
      setCreating(false);
      await load();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Ошибка создания', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (t: Task) => {
    const next: TaskStatus = t.status === 'DONE' ? 'TODO' : 'DONE';
    try {
      await updateTask(t.id, { status: next });
      toast(next === 'DONE' ? 'Задача выполнена' : 'Задача возвращена в работу', 'success');
      await load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка', 'error');
    }
  };

  const onDelete = async (t: Task) => {
    const ok = await confirm({
      title: 'Удалить задачу',
      message: `«${t.title}» — действие нельзя отменить.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteTask(t.id);
      toast('Задача удалена', 'success');
      await load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка удаления', 'error');
    }
  };

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="card-header">
        <h2 className="card-title">Задачи</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isAdmin && (
            <div className="scope-switch">
              <button
                className={`scope-btn${scope === 'mine' ? ' active' : ''}`}
                onClick={() => setScope('mine')}
              >
                <Icon name="person" size={16} />
                Мои
              </button>
              <button
                className={`scope-btn${scope === 'all' ? ' active' : ''}`}
                onClick={() => setScope('all')}
              >
                <Icon name="groups" size={16} />
                Все
              </button>
            </div>
          )}
          {isAdmin && !creating && (
            <motion.button
              className="btn btn-primary"
              onClick={() => setCreating(true)}
              whileHover={{ scale: 1.05, y: -2 }}
              whileTap={{ scale: 0.95 }}
            >
              <Icon name="add" size={16} style={{ marginRight: 4 }} />
              Новая задача
            </motion.button>
          )}
        </div>
      </div>

      <div className="card-body">
        <AnimatePresence>
          {creating && isAdmin && (
            <motion.form
              onSubmit={onCreate}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              style={{ marginBottom: 20, padding: 18, background: 'var(--bg)', borderRadius: 10, overflow: 'hidden' }}
            >
              <div className="form-group">
                <label>Заголовок</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Например: Собрать документы для Иванова"
                  maxLength={200}
                  required
                />
              </div>
              <div className="form-group">
                <label>Описание</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Что именно нужно сделать..."
                  maxLength={2000}
                  required
                  rows={4}
                />
              </div>
              <div className="form-group">
                <label>Назначить сотрудника</label>
                <select
                  value={form.assignedToId}
                  onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}
                  required
                >
                  <option value="">— Выберите сотрудника —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} {u.role === 'ADMIN' ? '(Админ)' : '(Сотрудник)'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setCreating(false); setForm({ title: '', description: '', assignedToId: '' }); }}
                >
                  Отмена
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Создаём...' : 'Создать'}
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Загрузка...
            </motion.div>
          ) : items.length === 0 ? (
            <motion.div key="empty" className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="empty-icon"><Icon name="task_alt" size={48} /></div>
              {scope === 'mine' ? 'У вас пока нет назначенных задач' : 'Задач пока нет'}
            </motion.div>
          ) : (
            <motion.div
              key="list"
              className="tasks-list"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
            >
              {items.map((t) => {
                const isOwner = t.assignedToId === me?.id;
                const canToggle = isAdmin || isOwner;
                return (
                  <motion.div
                    key={t.id}
                    className={`task-item task-${t.status.toLowerCase()}`}
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
                    }}
                    layout
                  >
                    <button
                      className={`task-check${t.status === 'DONE' ? ' checked' : ''}${!canToggle ? ' disabled' : ''}`}
                      onClick={() => canToggle && toggleStatus(t)}
                      disabled={!canToggle}
                      title={canToggle ? (t.status === 'DONE' ? 'Вернуть в работу' : 'Отметить выполненной') : 'Только назначенный сотрудник или админ'}
                    >
                      <Icon name={t.status === 'DONE' ? 'check_circle' : 'radio_button_unchecked'} size={26} />
                    </button>
                    <div className="task-content">
                      <div className="task-title">{t.title}</div>
                      <div className="task-desc">{t.description}</div>
                      <div className="task-meta">
                        <span className={`badge ${TASK_STATUS_BADGE[t.status]}`}>{TASK_STATUS_LABEL[t.status]}</span>
                        <span className="task-meta-item">
                          <Icon name="person" size={14} />
                          {t.assignedTo?.fullName || '—'}
                          {isOwner && <span className="mgr-you"> (вы)</span>}
                        </span>
                        {t.createdBy && (
                          <span className="task-meta-item">
                            <Icon name="edit" size={14} />
                            От: {t.createdBy.fullName}
                          </span>
                        )}
                        <span className="task-meta-item">
                          <Icon name="schedule" size={14} />
                          {new Date(t.createdAt).toLocaleDateString('ru-RU')}
                        </span>
                      </div>
                    </div>
                    {isAdmin && (
                      <button className="btn btn-sm btn-danger" onClick={() => onDelete(t)} title="Удалить задачу">
                        <Icon name="delete" size={16} />
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
