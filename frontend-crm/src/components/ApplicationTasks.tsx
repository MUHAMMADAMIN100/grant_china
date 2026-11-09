import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';
import { createTask, listTasks, updateTask } from '../api/tasks';
import { listUsers } from '../api/users';
import { isPrivileged, type Task, type User } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { formatDateTimeRu } from '../utils/datetime';

/** Быстрые названия — самые частые следующие шаги с клиентом. */
const QUICK_TITLES = ['Перезвонить', 'Встреча', 'Документы', 'Оплата'];

const isOverdue = (t: Task) => !!t.dueDate && t.status !== 'DONE' && new Date(t.dueDate).getTime() < Date.now();

/**
 * 09.11.2026 — задачи по заявке: список открытых (просроченные — красным) и
 * форма «поставить задачу». Используется в воронке (окно с карточки) и в
 * карточке заявки. Менеджер ставит задачу себе, руководство — любому.
 * Закрыть задачу может её исполнитель или руководство (как в «Задачах»).
 */
export default function ApplicationTasks({
  applicationId,
  onChanged,
  onCounts,
}: {
  applicationId: string;
  onChanged?: () => void;
  /** Открытые и просроченные — сразу после любого изменения (счётчик на карточке воронки). */
  onCounts?: (c: { open: number; overdue: number }) => void;
}) {
  const me = useAuth((s) => s.user);
  const isAdmin = isPrivileged(me?.role);
  const { toast } = useUI();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState(me?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [showDone, setShowDone] = useState(false);

  // Пока своя правка в пути, список с сервера не берём: ответ, начатый раньше,
  // на миг вернул бы закрытую задачу обратно. После правки — одна свежая загрузка.
  const reqRef = useRef(0);
  const busyRef = useRef(0);
  const load = useCallback(() => {
    const my = ++reqRef.current;
    if (busyRef.current > 0) return;
    listTasks({ applicationId })
      .then((list) => {
        if (my === reqRef.current) setTasks(list);
      })
      .catch(() => {
        if (my === reqRef.current) setTasks([]);
      })
      .finally(() => {
        if (my === reqRef.current) setLoading(false);
      });
  }, [applicationId]);
  const begin = () => {
    busyRef.current++;
    reqRef.current++;
  };
  const end = () => {
    busyRef.current--;
    reqRef.current++;
    if (busyRef.current === 0) load();
  };
  useEffect(load, [load]);
  useEffect(() => {
    if (isAdmin) listUsers().then(setUsers).catch(() => {});
  }, [isAdmin]);
  useRealtime({ 'task:new': load, 'task:updated': load, 'task:deleted': load });

  const open = useMemo(() => tasks.filter((t) => t.status !== 'DONE'), [tasks]);
  const done = useMemo(() => tasks.filter((t) => t.status === 'DONE'), [tasks]);
  const onCountsRef = useRef(onCounts);
  onCountsRef.current = onCounts;
  useEffect(() => {
    if (!loading) onCountsRef.current?.({ open: open.length, overdue: open.filter(isOverdue).length });
  }, [loading, open]);

  const add = async () => {
    const t = title.trim();
    if (t.length < 2 || !me) return;
    setSaving(true);
    begin();
    try {
      await createTask({
        title: t,
        description: comment.trim() || t,
        assignedToId: isAdmin ? assignee || me.id : me.id,
        dueDate: due ? new Date(due).toISOString() : undefined,
        applicationId,
      });
      setTitle('');
      setComment('');
      setDue('');
      toast('Задача поставлена', 'success');
      onChanged?.();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Не удалось поставить задачу', 'error');
    } finally {
      setSaving(false);
      end();
    }
  };

  const toggle = async (task: Task) => {
    const next = task.status === 'DONE' ? 'TODO' : 'DONE';
    begin();
    setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, status: next } : x)));
    try {
      await updateTask(task.id, { status: next });
      onChanged?.();
    } catch (e: any) {
      setTasks((prev) => prev.map((x) => (x.id === task.id ? task : x)));
      toast(e?.response?.data?.message || 'Не удалось изменить задачу', 'error');
    } finally {
      end();
    }
  };

  const canToggle = (t: Task) => isAdmin || t.assignedToId === me?.id;

  const row = (t: Task) => (
    <li key={t.id} className={`app-task${t.status === 'DONE' ? ' done' : ''}${isOverdue(t) ? ' overdue' : ''}`} data-testid="app-task">
      <input
        type="checkbox"
        checked={t.status === 'DONE'}
        disabled={!canToggle(t)}
        onChange={() => toggle(t)}
        title={canToggle(t) ? (t.status === 'DONE' ? 'Вернуть в работу' : 'Отметить выполненной') : 'Закрыть может исполнитель или руководство'}
        aria-label={`Выполнено: ${t.title}`}
      />
      <div className="app-task-body">
        <div className="app-task-title">{t.title}</div>
        {t.description && t.description !== t.title && <div className="app-task-desc">{t.description}</div>}
        <div className="app-task-meta">
          {t.dueDate ? (
            <span className="app-task-due">
              <Icon name="schedule" size={13} /> {formatDateTimeRu(t.dueDate)}
              {isOverdue(t) ? ' · просрочено' : ''}
            </span>
          ) : (
            <span>без срока</span>
          )}
          {t.assignedTo && <span>· {t.assignedTo.fullName}</span>}
        </div>
      </div>
    </li>
  );

  return (
    <div className="app-tasks" data-testid="app-tasks">
      {loading ? (
        <div className="app-tasks-empty">Загрузка…</div>
      ) : open.length === 0 ? (
        <div className="app-tasks-empty">Открытых задач нет</div>
      ) : (
        <ul className="app-task-list">{open.map(row)}</ul>
      )}
      {done.length > 0 && (
        <>
          <button type="button" className="app-tasks-toggle" onClick={() => setShowDone((v) => !v)}>
            {showDone ? 'Скрыть выполненные' : `Выполненные: ${done.length}`}
          </button>
          {showDone && <ul className="app-task-list">{done.map(row)}</ul>}
        </>
      )}

      <div className="app-task-form">
        <div className="app-task-quick">
          {QUICK_TITLES.map((q) => (
            <button key={q} type="button" className={`conv-chip${title === q ? ' active' : ''}`} onClick={() => setTitle(q)}>
              {q}
            </button>
          ))}
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что сделать" maxLength={200} data-testid="app-task-title" />
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий (необязательно)" rows={2} maxLength={2000} />
        <div className="app-task-form-row">
          <label>
            Срок
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} data-testid="app-task-due" />
          </label>
          {isAdmin && (
            <label>
              Исполнитель
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="app-task-assignee">
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button type="button" className="btn btn-primary" onClick={add} disabled={saving || title.trim().length < 2} data-testid="app-task-add">
          <Icon name="add_task" size={16} /> {saving ? 'Ставим…' : isAdmin ? 'Поставить задачу' : 'Поставить себе'}
        </button>
      </div>
    </div>
  );
}
