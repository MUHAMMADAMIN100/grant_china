import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createTask, deleteTask, listTasks, updateTask } from '../api/tasks';
import { listUsers } from '../api/users';
import type { Task, TaskStatus, User } from '../api/types';
import { ROLE_LABEL, TASK_STATUS_BADGE, TASK_STATUS_LABEL, isPrivileged } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import Icon from '../Icon';
import { compose, hasErrors, maxLen, minLen, required, validateAll } from '../utils/validators';
import { formatDateTimeRu, toDatetimeLocalValue } from '../utils/datetime';

type Scope = 'all' | 'mine';
type DueFilter = '' | 'overdue' | 'today';

/** true — срок прошёл и задача ещё не закрыта (ТЗ 3.2 — «мои задачи по срокам»). */
function isOverdue(t: Task): boolean {
  return !!t.dueDate && t.status !== 'DONE' && new Date(t.dueDate).getTime() < Date.now();
}

function isDueToday(t: Task): boolean {
  if (!t.dueDate || t.status === 'DONE') return false;
  const d = new Date(t.dueDate);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export default function Tasks() {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const isAdmin = isPrivileged(me?.role);
  const [items, setItems] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [scope, setScope] = useState<Scope>(isAdmin ? 'all' : 'mine');
  const [search, setSearch] = useState('');
  const [dueFilter, setDueFilter] = useState<DueFilter>('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', assignedToId: '', dueDate: '' });
  const [submitting, setSubmitting] = useState(false);

  // Инлайн-редактирование срока у уже существующей задачи (ТЗ 3.2 — перенос
  // даты повторного звонка/срока). Отдельный маленький стейт вместо полноценной
  // формы редактирования — так же лаконично, как переключатель статуса ниже.
  const [dueEditId, setDueEditId] = useState<string | null>(null);
  const [dueDraft, setDueDraft] = useState('');
  const [dueSaving, setDueSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      let dueFrom: string | undefined;
      let dueTo: string | undefined;
      let overdue: boolean | undefined;
      if (dueFilter === 'overdue') {
        overdue = true;
      } else if (dueFilter === 'today') {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        dueFrom = start.toISOString();
        dueTo = end.toISOString();
      }
      const data = await listTasks({ mine: scope === 'mine', search: search || undefined, dueFrom, dueTo, overdue });
      setItems(data);
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка загрузки', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, search, dueFilter]);

  useRealtime({
    'task:new': () => load(),
    'task:updated': () => load(),
    'task:deleted': () => load(),
  });

  useEffect(() => {
    if (isAdmin) {
      listUsers().then(setUsers).catch(() => {});
    }
  }, [isAdmin]);

  const formErrors = validateAll(
    { title: form.title, description: form.description, assignedToId: form.assignedToId },
    {
      title: compose(required('Введите заголовок'), minLen(3, 'Минимум 3 символа'), maxLen(200)),
      description: compose(required('Опишите задачу'), minLen(5, 'Минимум 5 символов'), maxLen(2000)),
      assignedToId: required('Выберите сотрудника'),
    },
  );
  const formInvalid = hasErrors(formErrors);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formInvalid) {
      toast('Заполните все поля корректно', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await createTask({
        title: form.title.trim(),
        description: form.description.trim(),
        assignedToId: form.assignedToId,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
      });
      toast('Задача создана. Сотрудник получит email и уведомление.', 'success');
      setForm({ title: '', description: '', assignedToId: '', dueDate: '' });
      setCreating(false);
      await load();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Ошибка создания', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const setStatus = async (t: Task, next: TaskStatus) => {
    if (t.status === next) return;
    try {
      await updateTask(t.id, { status: next });
      if (next === 'DONE') toast('Задача выполнена', 'success');
      else if (next === 'IN_PROGRESS') toast('Задача взята в работу', 'success');
      else toast('Задача возвращена в очередь', 'info');
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

  const openDueEdit = (t: Task) => {
    setDueEditId(t.id);
    setDueDraft(toDatetimeLocalValue(t.dueDate));
  };

  const cancelDueEdit = () => {
    setDueEditId(null);
    setDueDraft('');
  };

  const saveDueEdit = async (t: Task) => {
    setDueSaving(true);
    try {
      await updateTask(t.id, { dueDate: dueDraft ? new Date(dueDraft).toISOString() : null });
      toast(dueDraft ? 'Срок обновлён' : 'Срок снят', 'success');
      cancelDueEdit();
      await load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка сохранения срока', 'error');
    } finally {
      setDueSaving(false);
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
        <div className="card-header-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
        <div className="filters">
          <input
            placeholder="Поиск по заголовку или описанию..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={dueFilter} onChange={(e) => setDueFilter(e.target.value as DueFilter)} title="Фильтр по сроку">
            <option value="">Все сроки</option>
            <option value="today">На сегодня</option>
            <option value="overdue">Просроченные</option>
          </select>
        </div>
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
                <label>Заголовок *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Например: Собрать документы для Иванова"
                  maxLength={200}
                  className={formErrors.title ? 'input-error' : ''}
                  required
                />
                {formErrors.title && <div className="form-error-text">{formErrors.title}</div>}
              </div>
              <div className="form-group">
                <label>Описание *</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Что именно нужно сделать..."
                  maxLength={2000}
                  className={formErrors.description ? 'input-error' : ''}
                  required
                  rows={4}
                />
                {formErrors.description && <div className="form-error-text">{formErrors.description}</div>}
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
                      {u.fullName} ({ROLE_LABEL[u.role] || u.role})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Срок (необязательно)</label>
                <input
                  type="datetime-local"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                />
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setCreating(false); setForm({ title: '', description: '', assignedToId: '', dueDate: '' }); }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting || formInvalid}
                  title={formInvalid ? 'Исправьте ошибки в форме' : ''}
                >
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
                const canChange = isAdmin || isOwner;
                const overdue = isOverdue(t);
                const dueToday = !overdue && isDueToday(t);
                const isAuto = t.createdById === null;
                const statuses: { value: TaskStatus; icon: string; label: string }[] = [
                  { value: 'TODO', icon: 'radio_button_unchecked', label: 'К выполнению' },
                  { value: 'IN_PROGRESS', icon: 'autorenew', label: 'В работе' },
                  { value: 'DONE', icon: 'check_circle', label: 'Выполнено' },
                ];
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
                    <div className="task-content">
                      <div className="task-title">
                        {t.title}
                        {isAuto && (
                          <span className="badge badge-gray" style={{ marginLeft: 8 }} title="Создана автоматически системой">
                            Авто
                          </span>
                        )}
                      </div>
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
                        {t.dueDate && dueEditId !== t.id && (
                          <span className="task-meta-item" style={overdue ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>
                            <Icon name="event" size={14} />
                            Срок: {formatDateTimeRu(t.dueDate)}
                            {overdue && <span className="badge badge-danger" style={{ marginLeft: 6 }}>Просрочено</span>}
                            {dueToday && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Сегодня</span>}
                          </span>
                        )}
                        {canChange && dueEditId !== t.id && (
                          <button className="btn btn-sm btn-secondary" onClick={() => openDueEdit(t)} title="Изменить срок">
                            <Icon name={t.dueDate ? 'edit_calendar' : 'event'} size={14} style={{ marginRight: 4 }} />
                            {t.dueDate ? 'Срок' : 'Задать срок'}
                          </button>
                        )}
                      </div>

                      {dueEditId === t.id && (
                        <div className="task-meta" style={{ marginTop: 8 }}>
                          <input
                            type="datetime-local"
                            value={dueDraft}
                            onChange={(e) => setDueDraft(e.target.value)}
                            disabled={dueSaving}
                          />
                          <button className="btn btn-sm btn-primary" onClick={() => saveDueEdit(t)} disabled={dueSaving}>
                            Сохранить
                          </button>
                          <button className="btn btn-sm btn-secondary" onClick={cancelDueEdit} disabled={dueSaving}>
                            Отмена
                          </button>
                        </div>
                      )}

                      <div className="task-status-switch">
                        {statuses.map((s) => (
                          <button
                            key={s.value}
                            className={`task-status-btn${t.status === s.value ? ' active' : ''} task-status-${s.value.toLowerCase()}`}
                            onClick={() => canChange && setStatus(t, s.value)}
                            disabled={!canChange}
                            title={canChange ? s.label : 'Только назначенный сотрудник или админ'}
                          >
                            <Icon name={s.icon} size={16} />
                            <span>{s.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    {isAdmin && (
                      <button className="btn btn-sm btn-danger task-delete-btn" onClick={() => onDelete(t)} title="Удалить задачу">
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
