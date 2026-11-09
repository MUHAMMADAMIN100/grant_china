import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Icon from '../Icon';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { useUrlFilter } from '../hooks/useUrlFilter';
import { archiveApplication, unarchiveApplication, updateApplication } from '../api/applications';
import { listUsers } from '../api/users';
import { DIRECTION_LABEL, STUDENT_ARCHIVE_REASON, isPrivileged, leadSourceLabel, type ApplicationStatus, type User } from '../api/types';
import { FUNNEL_COLUMNS, getFunnelBoard, saveFunnelLabels, type FunnelCard, type FunnelColumn, type FunnelColumnKey } from '../api/funnel';
import DirectionOptions from '../components/DirectionOptions';
import LeadSourceSelect from '../components/LeadSourceSelect';
import ApplicationTasks from '../components/ApplicationTasks';
import { formatDateTimeRu } from '../utils/datetime';

/**
 * 09.11.2026 — «Воронка»: заявки на доске по этапам (просьба владельца по
 * образцу его другой CRM, в дизайне GrantChina).
 *
 * Колонки — 6 этапов заявки и «Отказ» (архив). Перенос карточки меняет этап
 * той же операцией, что выпадающий список в заявке (права, журнал, KPI, SMS
 * студенту — как раньше). В «Отказ» — через окно с причиной (случайное
 * перетаскивание не закрывает заявку), обратно — возврат из архива.
 * Менеджер видит только свои заявки (как в «Заявках»).
 */

const PERIODS = [
  { value: '', label: 'Всё время' },
  { value: 'month', label: 'Месяц' },
  { value: 'week', label: 'Неделя' },
  { value: 'today', label: 'Сегодня' },
] as const;

const COLUMN_COLOR: Record<FunnelColumnKey, string> = {
  NEW: '#3b82f6',
  DOCS_REVIEW: '#f59e0b',
  DOCS_SUBMITTED: '#8b5cf6',
  PRE_ADMISSION: '#14b8a6',
  AWAITING_PAYMENT: '#f97316',
  ENROLLED: '#10b981',
  ARCHIVED: '#ef4444',
};

const SOURCE_ICON: Record<string, string> = {
  WEBSITE: 'language',
  INSTAGRAM: 'photo_camera',
  TELEGRAM: 'send',
  FACEBOOK: 'thumb_up',
  WHATSAPP: 'chat',
  TIKTOK: 'music_note',
  REFERRAL: 'group',
  OFFICE_VISIT: 'storefront',
  ADS: 'campaign',
};

/**
 * Причина отказа по-человечески. В базе: «MANUAL[: текст]» — вручную,
 * «AUTO: текст» — авто-архив, «STUDENT» — ушла в архив вместе со студентом.
 */
function reasonText(raw: string | null): string | null {
  if (!raw || raw === 'MANUAL') return null;
  if (raw === STUDENT_ARCHIVE_REASON) return 'В архиве вместе со студентом';
  if (raw.startsWith('MANUAL: ')) return raw.slice(8);
  if (raw.startsWith('AUTO: ')) return `Автоматически: ${raw.slice(6)}`;
  return raw;
}

/** Старые статусы ложатся в свои колонки так же, как на сервере. */
const columnOf = (status: ApplicationStatus): FunnelColumnKey =>
  status === 'IN_PROGRESS' ? 'DOCS_REVIEW' : status === 'COMPLETED' ? 'ENROLLED' : (status as FunnelColumnKey);

/** Границы периода по местному времени сотрудника. */
function periodRange(period: string): { from?: string; to?: string } {
  if (!period) return {};
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (period === 'month') start.setDate(1);
  return { from: start.toISOString() };
}

const initials = (name: string | null | undefined) =>
  (name || '?')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase() || '?';

const AVATAR_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];
const avatarColor = (name: string) => AVATAR_COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length];

function moveCard(columns: FunnelColumn[], cardId: string, from: FunnelColumnKey, to: FunnelColumnKey): FunnelColumn[] {
  const card = columns.find((c) => c.key === from)?.items.find((i) => i.id === cardId);
  if (!card) return columns;
  return columns.map((c) => {
    if (c.key === from) return { ...c, count: Math.max(0, c.count - 1), items: c.items.filter((i) => i.id !== cardId) };
    if (c.key === to) {
      const moved: FunnelCard = { ...card, status: to === 'ARCHIVED' ? card.status : (to as ApplicationStatus), archivedAt: to === 'ARCHIVED' ? new Date().toISOString() : null };
      return { ...c, count: c.count + 1, items: [moved, ...c.items] };
    }
    return c;
  });
}

/** Excel понимает CSV с «;» и BOM — тот же формат, что у выгрузки билетов. */
function exportCsv(columns: FunnelColumn[]) {
  const cell = (v: unknown) => {
    const s = String(v ?? '');
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Этап', 'ФИО', 'Телефон', 'Направление', 'Источник', 'Менеджер (TJ)', 'Менеджер (CN)', 'Создана', 'Открытых задач', 'Просрочено', 'Причина отказа'];
  const rows = columns.flatMap((c) =>
    c.items.map((a) =>
      [
        c.label,
        a.fullName,
        a.phone,
        DIRECTION_LABEL[a.direction] ?? a.direction,
        leadSourceLabel(a.source),
        a.manager?.fullName ?? '',
        a.chinaManager?.fullName ?? '',
        formatDateTimeRu(a.createdAt),
        a.openTasks,
        a.overdueTasks,
        reasonText(a.archiveReason) ?? '',
      ]
        .map(cell)
        .join(';'),
    ),
  );
  const lines = [header.map(cell).join(';'), ...rows];
  // Не молчим об обрезке: в колонке приходит не больше 300 карточек.
  if (columns.some((c) => c.count > c.items.length)) {
    lines.push('', cell('ВНИМАНИЕ: выгружены не все заявки (в колонке показывается до 300) — сузьте фильтр и повторите выгрузку'));
  }
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `voronka-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Funnel() {
  const me = useAuth((s) => s.user);
  const isAdmin = isPrivileged(me?.role);
  const navigate = useNavigate();
  const { toast } = useUI();
  const defaults = useMemo(() => ({ search: '', period: '', direction: '', manager: '', source: '', view: 'board' }), []);
  const [filters, setFilter, setFilters] = useUrlFilter(defaults);
  const [searchInput, setSearchInput] = useState(filters.search);
  const [showFilters, setShowFilters] = useState(!!(filters.direction || filters.manager || filters.source));
  const [columns, setColumns] = useState<FunnelColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [drag, setDrag] = useState<{ id: string; from: FunnelColumnKey } | null>(null);
  const [over, setOver] = useState<FunnelColumnKey | null>(null);
  const [refuse, setRefuse] = useState<{ card: FunnelCard; from: FunnelColumnKey } | null>(null);
  const [refuseReason, setRefuseReason] = useState('');
  const [tasksFor, setTasksFor] = useState<FunnelCard | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState<Partial<Record<FunnelColumnKey, string>>>({});
  const reqRef = useRef(0);
  // Пока идут свои переносы, доску с сервера не берём: ответ, начатый до
  // переноса, на миг вернул бы карточку назад. После — одна свежая загрузка.
  const busyRef = useRef(0);

  // Поле поиска следует за адресом (кнопка «назад», «Сбросить»).
  useEffect(() => setSearchInput(filters.search), [filters.search]);
  // Поиск — с паузой: каждый символ не должен дёргать сервер.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== filters.search) setFilter('search', searchInput);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput, filters.search, setFilter]);

  const load = useCallback(
    (opts?: { silent?: boolean }) => {
      const my = ++reqRef.current;
      if (busyRef.current > 0) return;
      if (!opts?.silent) setLoading(true);
      getFunnelBoard({
        search: filters.search,
        direction: filters.direction,
        manager: filters.manager,
        source: filters.source,
        ...periodRange(filters.period),
      })
        .then((res) => {
          if (my !== reqRef.current) return;
          setColumns(res.columns);
          setError(null);
        })
        .catch((e) => {
          if (my !== reqRef.current) return;
          setError(e?.response?.data?.message || 'Не удалось загрузить воронку');
        })
        .finally(() => {
          if (my === reqRef.current) setLoading(false);
        });
    },
    [filters.search, filters.direction, filters.manager, filters.source, filters.period],
  );
  useEffect(() => load(), [load]);
  useEffect(() => {
    if (isAdmin) listUsers().then(setUsers).catch(() => {});
  }, [isAdmin]);

  // Изменения от коллег (и наши же) — фоном, одной перезагрузкой на пачку событий.
  // Через ref — с текущими фильтрами, даже если вызвал обработчик со старого рендера.
  const loadRef = useRef(load);
  loadRef.current = load;
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => loadRef.current({ silent: true }), 600);
  }, []);
  useEffect(() => () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
  }, []);
  useRealtime({
    'application:new': scheduleReload,
    'application:updated': scheduleReload,
    'application:deleted': scheduleReload,
    'task:new': scheduleReload,
    'task:updated': scheduleReload,
    'task:deleted': scheduleReload,
    'funnel:labels': scheduleReload,
  });

  /** Счётчик задач на карточке — сразу из окна «Задачи», не дожидаясь перезагрузки доски. */
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const setCardCounts = useCallback(
    (id: string, c: { open: number; overdue: number }) => {
      const hit = columnsRef.current.some((col) => col.items.some((i) => i.id === id && (i.openTasks !== c.open || i.overdueTasks !== c.overdue)));
      if (!hit) return;
      reqRef.current++; // ответ доски, начатый раньше, уже устарел
      setColumns((prev) =>
        prev.map((col) => ({
          ...col,
          items: col.items.map((i) => (i.id === id ? { ...i, openTasks: c.open, overdueTasks: c.overdue } : i)),
        })),
      );
      scheduleReload();
    },
    [scheduleReload],
  );

  const labelOf = (key: FunnelColumnKey) => columns.find((c) => c.key === key)?.label ?? key;
  const total = columns.reduce((s, c) => s + (c.key === 'ARCHIVED' ? 0 : c.count), 0);
  const refused = columns.find((c) => c.key === 'ARCHIVED')?.count ?? 0;

  /** Перенос карточки. Сразу на экране; не вышло — доска сверяется с сервером. */
  const move = async (card: FunnelCard, from: FunnelColumnKey, to: FunnelColumnKey, reason?: string) => {
    if (from === to) return;
    busyRef.current++;
    reqRef.current++;
    setColumns((prev) => moveCard(prev, card.id, from, to));
    try {
      if (to === 'ARCHIVED') {
        await archiveApplication(card.id, reason || undefined);
      } else {
        if (from === 'ARCHIVED') {
          const back = await unarchiveApplication(card.id);
          if (columnOf(back.status) !== to) await updateApplication(card.id, { status: to as ApplicationStatus });
        } else if (columnOf(card.status) !== to) {
          await updateApplication(card.id, { status: to as ApplicationStatus });
        }
      }
      toast(`«${card.fullName}» — ${labelOf(to)}`, 'success');
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Не удалось перенести заявку', 'error');
    } finally {
      busyRef.current--;
      reqRef.current++;
      scheduleReload();
    }
  };

  const requestMove = (card: FunnelCard, from: FunnelColumnKey, to: FunnelColumnKey) => {
    if (from === to) return;
    if (to === 'ARCHIVED') {
      setRefuseReason('');
      setRefuse({ card, from });
      return;
    }
    void move(card, from, to);
  };

  const onDrop = (to: FunnelColumnKey) => {
    const d = drag;
    setDrag(null);
    setOver(null);
    if (!d) return;
    const card = columns.find((c) => c.key === d.from)?.items.find((i) => i.id === d.id);
    if (card) requestMove(card, d.from, to);
  };

  // Доску можно двигать мышью за пустое место — как на образце.
  const boardRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; left: number } | null>(null);
  const onBoardPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest('.fn-card, button, a, input, select, textarea, label')) return;
    pan.current = { x: e.clientX, left: boardRef.current?.scrollLeft ?? 0 };
  };
  const onBoardPointerMove = (e: React.PointerEvent) => {
    if (!pan.current || !boardRef.current) return;
    boardRef.current.scrollLeft = pan.current.left - (e.clientX - pan.current.x);
  };
  const endPan = () => {
    pan.current = null;
  };
  // Колонок больше, чем влезает в экран: карточку поднесли к краю — доска едет сама.
  const onBoardDragOver = (e: React.DragEvent) => {
    const el = boardRef.current;
    if (!drag || !el) return;
    // Чем ближе к краю, тем быстрее: у самого края ~40px за событие.
    const r = el.getBoundingClientRect();
    const zone = 110;
    const step = (d: number) => Math.round(6 + ((zone - Math.max(0, d)) / zone) * 36);
    if (e.clientX > r.right - zone) el.scrollLeft += step(r.right - e.clientX);
    else if (e.clientX < r.left + zone) el.scrollLeft -= step(e.clientX - r.left);
  };

  const openLabels = () => {
    setLabelDraft(Object.fromEntries(columns.map((c) => [c.key, c.label])) as Partial<Record<FunnelColumnKey, string>>);
    setLabelsOpen(true);
  };
  const saveLabels = async () => {
    try {
      await saveFunnelLabels(labelDraft);
      toast('Названия колонок сохранены', 'success');
      setLabelsOpen(false);
      load({ silent: true });
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Не удалось сохранить', 'error');
    }
  };

  const hasFilters = !!(filters.search || filters.period || filters.direction || filters.manager || filters.source);

  const cardView = (card: FunnelCard, col: FunnelColumnKey) => {
    const manager = card.manager ?? card.chinaManager;
    const reason = col === 'ARCHIVED' ? reasonText(card.archiveReason) : null;
    // Заявку, ушедшую в архив вместе со студентом, отдельно не вернуть (сервер
    // ответит 409) — она возвращается со студентом из раздела «Архив».
    const locked = card.archiveReason === STUDENT_ARCHIVE_REASON;
    return (
      <div
        key={card.id}
        className={`fn-card${drag?.id === card.id ? ' dragging' : ''}${locked ? ' locked' : ''}`}
        draggable={!locked}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', card.id);
          setDrag({ id: card.id, from: col });
        }}
        onDragEnd={() => {
          setDrag(null);
          setOver(null);
        }}
        onClick={() => navigate(`/applications/${card.id}`)}
        data-testid="fn-card"
        data-id={card.id}
      >
        <div className="fn-card-head">
          <span className="fn-avatar" style={{ background: avatarColor(card.fullName) }}>{initials(card.fullName)}</span>
          <span className="fn-card-name">{card.fullName}</span>
        </div>
        <div className="fn-card-row">
          <Icon name={SOURCE_ICON[card.source ?? ''] ?? 'sell'} size={14} />
          <span>{leadSourceLabel(card.source)}</span>
          {card.repeatOfId && <span className="fn-tag" title="Повторное обращение">повтор</span>}
        </div>
        <div className="fn-card-row fn-card-soft">
          <span>{formatDateTimeRu(card.createdAt)}</span>
          {manager ? (
            <span className="fn-avatar fn-avatar-sm" style={{ background: avatarColor(manager.fullName) }} title={`Менеджер: ${manager.fullName}`}>
              {initials(manager.fullName)}
            </span>
          ) : (
            <span className="fn-free" title="Менеджер не назначен">
              <Icon name="person_off" size={13} />
            </span>
          )}
        </div>
        {col === 'ARCHIVED' && reason && <div className="fn-reason" title={reason}>{reason}</div>}
        <div className="fn-card-foot" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`fn-tasks${card.overdueTasks ? ' overdue' : card.openTasks ? ' open' : ''}`}
            onClick={() => setTasksFor(card)}
            title={card.overdueTasks ? `Просрочено: ${card.overdueTasks}` : 'Задачи по заявке'}
            data-testid="fn-tasks"
          >
            <Icon name="event" size={14} /> Задачи <b>{card.openTasks}</b>
          </button>
          <span className="fn-card-actions">
            {card.phone && (
              <a className="fn-icon" href={`tel:${card.phone.replace(/[^\d+]/g, '')}`} title={`Позвонить: ${card.phone}`}>
                <Icon name="call" size={16} />
              </a>
            )}
            {card.chat && (
              <Link className="fn-icon" to={`/conversations?c=${card.chat.id}`} title="Открыть переписку">
                <Icon name="chat_bubble" size={16} />
              </Link>
            )}
            {!locked && (
            <label className="fn-icon fn-move" title="Перенести в другой этап">
              <Icon name="swap_horiz" size={16} />
              <select
                value=""
                aria-label={`Перенести «${card.fullName}» в другой этап`}
                onChange={(e) => {
                  const to = e.target.value as FunnelColumnKey;
                  if (to) requestMove(card, col, to);
                }}
                data-testid="fn-move"
              >
                <option value="">Перенести в…</option>
                {FUNNEL_COLUMNS.filter((k) => k !== col).map((k) => (
                  <option key={k} value={k}>
                    {labelOf(k)}
                  </option>
                ))}
              </select>
            </label>
            )}
          </span>
        </div>
      </div>
    );
  };

  return (
    <motion.div className="fn-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="fn-hero">
        <div>
          <h2 className="fn-title">Воронка заявок</h2>
          <span className="fn-total" data-testid="fn-total">
            В работе: {total} · {labelOf('ARCHIVED')}: {refused}
          </span>
        </div>
        <div className="fn-hero-actions">
          {isAdmin && (
            <button type="button" className="btn btn-secondary" onClick={openLabels} data-testid="fn-labels-btn">
              <Icon name="view_column" size={16} /> Колонки
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => exportCsv(columns)} disabled={!columns.length} data-testid="fn-export">
            <Icon name="table_view" size={16} /> Excel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/students/new')}>
            <Icon name="person_add" size={16} /> Новый клиент
          </button>
        </div>
      </div>

      <div className="fn-toolbar">
        <div className="fn-search">
          <Icon name="search" size={18} />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Имя или телефон" data-testid="fn-search" />
        </div>
        <div className="fn-seg" role="group" aria-label="Период">
          {PERIODS.map((p) => (
            <button key={p.value} type="button" className={filters.period === p.value ? 'on' : ''} onClick={() => setFilter('period', p.value)} data-testid={`fn-period-${p.value || 'all'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" className={`btn btn-secondary fn-filter-btn${showFilters || hasFilters ? ' active' : ''}`} onClick={() => setShowFilters((v) => !v)}>
          <Icon name="tune" size={16} /> Фильтры
        </button>
        <div className="fn-seg fn-view" role="group" aria-label="Вид">
          <button type="button" className={filters.view !== 'list' ? 'on' : ''} onClick={() => setFilter('view', 'board')} title="Доска" data-testid="fn-view-board">
            <Icon name="view_kanban" size={18} />
          </button>
          <button type="button" className={filters.view === 'list' ? 'on' : ''} onClick={() => setFilter('view', 'list')} title="Список" data-testid="fn-view-list">
            <Icon name="view_list" size={18} />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {showFilters && (
          <motion.div className="fn-filters" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <select value={filters.direction} onChange={(e) => setFilter('direction', e.target.value)} data-testid="fn-direction">
              <option value="">Все направления</option>
              <DirectionOptions />
            </select>
            {isAdmin && (
              <select value={filters.manager} onChange={(e) => setFilter('manager', e.target.value)} data-testid="fn-manager">
                <option value="">Все менеджеры</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            )}
            <LeadSourceSelect variant="filter" value={filters.source} onChange={(v) => setFilter('source', v)} title="Источник" />
            {hasFilters && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setSearchInput('');
                  setFilters({ search: '', period: '', direction: '', manager: '', source: '' });
                }}
              >
                Сбросить
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {error && <div className="error-banner">{error}</div>}

      {loading && !columns.length ? (
        <div className="empty">Загрузка…</div>
      ) : filters.view === 'list' ? (
        <div className="card fn-list-card">
          <div className="table-wrap">
            <table className="table fn-table" data-testid="fn-table">
              <thead>
                <tr>
                  <th>Клиент</th>
                  <th>Этап</th>
                  <th>Источник</th>
                  <th>Направление</th>
                  <th>Менеджер</th>
                  <th>Создана</th>
                  <th>Задачи</th>
                </tr>
              </thead>
              <tbody>
                {columns.flatMap((c) =>
                  c.items.map((a) => (
                    <tr key={a.id} onClick={() => navigate(`/applications/${a.id}`)} className="fn-row">
                      <td>
                        <div className="fn-row-name">{a.fullName}</div>
                        <div className="fn-row-sub">{a.phone}</div>
                      </td>
                      <td>
                        <span className="fn-stage" style={{ borderColor: COLUMN_COLOR[c.key], color: COLUMN_COLOR[c.key] }}>{c.label}</span>
                      </td>
                      <td>{leadSourceLabel(a.source)}</td>
                      <td>{DIRECTION_LABEL[a.direction] ?? a.direction}</td>
                      <td>{(a.manager ?? a.chinaManager)?.fullName ?? '—'}</td>
                      <td>{formatDateTimeRu(a.createdAt)}</td>
                      <td>
                        <span className={`fn-tasks-plain${a.overdueTasks ? ' overdue' : ''}`}>{a.openTasks}</span>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          {!columns.some((c) => c.items.length) && <div className="empty">{hasFilters ? 'По фильтрам заявок нет' : 'Заявок пока нет'}</div>}
        </div>
      ) : (
        <>
          <div className="fn-hint">
            <Icon name="pan_tool" size={15} /> Перетащите карточку в другую колонку, чтобы перенести заявку на другой этап. Доску можно двигать мышью за пустое место.
          </div>
          <div
            className="fn-board"
            ref={boardRef}
            onPointerDown={onBoardPointerDown}
            onPointerMove={onBoardPointerMove}
            onPointerUp={endPan}
            onPointerLeave={endPan}
            onDragOver={onBoardDragOver}
            data-testid="fn-board"
          >
            {columns.map((c) => (
              <section
                key={c.key}
                className={`fn-col${over === c.key && drag && drag.from !== c.key ? ' over' : ''}`}
                onDragEnter={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  if (over !== c.key) setOver(c.key);
                }}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (over !== c.key) setOver(c.key);
                }}
                onDragLeave={(e) => {
                  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(c.key);
                }}
                data-testid="fn-col"
                data-key={c.key}
              >
                <header className="fn-col-head" style={{ borderColor: COLUMN_COLOR[c.key] }}>
                  <span className="fn-col-title">{c.label}</span>
                  <span className="fn-col-count" data-testid="fn-col-count">{c.count}</span>
                </header>
                <div className="fn-col-body">
                  {c.items.map((card) => cardView(card, c.key))}
                  {!c.items.length && <div className="fn-col-empty">{c.key === 'ARCHIVED' ? 'Перетащите сюда, чтобы отказать' : 'Пусто'}</div>}
                  {c.count > c.items.length && <div className="fn-col-more">Показано {c.items.length} из {c.count} — сузьте фильтр</div>}
                </div>
              </section>
            ))}
          </div>
          {/* «Отказ» — последняя колонка и часто за краем экрана: пока карточку
              тащат, внизу появляется полоса, куда её можно бросить. */}
          {drag && drag.from !== 'ARCHIVED' && (
            <div
              className={`fn-dropbar${over === 'ARCHIVED' ? ' over' : ''}`}
              onDragEnter={(e) => {
                e.preventDefault();
                if (over !== 'ARCHIVED') setOver('ARCHIVED');
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (over !== 'ARCHIVED') setOver('ARCHIVED');
              }}
              onDragLeave={(e) => {
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop('ARCHIVED');
              }}
              data-testid="fn-dropbar"
            >
              <Icon name="block" size={20} /> {labelOf('ARCHIVED')}
            </div>
          )}
        </>
      )}

      {/* Отказ — с причиной */}
      <AnimatePresence>
        {refuse && (
          <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setRefuse(null)}>
            <motion.div className="dialog-card fn-dialog" initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }} onClick={(e) => e.stopPropagation()} data-testid="fn-refuse">
              <div className="dialog-title">Отказ: {refuse.card.fullName}</div>
              <p className="fn-dialog-text">Заявка уйдёт в архив. Вернуть её можно, перетащив карточку обратно в нужный этап.</p>
              <div className="form-group">
                <label>Причина отказа (необязательно)</label>
                <textarea rows={3} value={refuseReason} onChange={(e) => setRefuseReason(e.target.value)} maxLength={500} placeholder="Например: выбрал другое агентство" data-testid="fn-refuse-reason" />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setRefuse(null)}>
                  Отмена
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    const r = refuse;
                    setRefuse(null);
                    void move(r.card, r.from, 'ARCHIVED', refuseReason.trim());
                  }}
                  data-testid="fn-refuse-ok"
                >
                  Отказать
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Задачи по заявке */}
      <AnimatePresence>
        {tasksFor && (
          <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setTasksFor(null)}>
            <motion.div className="dialog-card fn-dialog fn-tasks-dialog" initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }} onClick={(e) => e.stopPropagation()} data-testid="fn-tasks-dialog">
              <div className="fn-dialog-head">
                <div className="dialog-title">Задачи: {tasksFor.fullName}</div>
                <button type="button" className="fn-icon" onClick={() => setTasksFor(null)} aria-label="Закрыть">
                  <Icon name="close" size={18} />
                </button>
              </div>
              <ApplicationTasks applicationId={tasksFor.id} onChanged={scheduleReload} onCounts={(c) => setCardCounts(tasksFor.id, c)} />
              <Link className="fn-open-app" to={`/applications/${tasksFor.id}`}>
                Открыть заявку <Icon name="arrow_forward" size={14} />
              </Link>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Названия колонок — руководство */}
      <AnimatePresence>
        {labelsOpen && (
          <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setLabelsOpen(false)}>
            <motion.div className="dialog-card fn-dialog" initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }} onClick={(e) => e.stopPropagation()} data-testid="fn-labels">
              <div className="dialog-title">Колонки воронки</div>
              <p className="fn-dialog-text">Названия видят все сотрудники. Этапы заявки и их порядок не меняются — на них завязаны KPI и кабинет студента. Пустое поле — стандартное название.</p>
              {FUNNEL_COLUMNS.map((k, i) => (
                <div key={k} className="fn-label-row">
                  <span className="fn-label-num" style={{ background: COLUMN_COLOR[k] }}>{i + 1}</span>
                  <input value={labelDraft[k] ?? ''} onChange={(e) => setLabelDraft((d) => ({ ...d, [k]: e.target.value }))} maxLength={40} data-testid={`fn-label-${k}`} />
                  <span className="fn-label-count">{columns.find((c) => c.key === k)?.count ?? 0}</span>
                </div>
              ))}
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setLabelsOpen(false)}>
                  Отмена
                </button>
                <button type="button" className="btn btn-primary" onClick={saveLabels} data-testid="fn-labels-save">
                  Сохранить
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
