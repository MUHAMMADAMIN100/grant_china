import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  TICKET_STATUS_BADGE,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_OPTIONS,
  deleteTicket,
  listChinaCities,
  listTickets,
  ticketStats,
  uploadTicketDocument,
  type ChinaCity,
  type Ticket,
  type TicketStats,
  type TicketStatus,
} from '../api/tickets';
import { isPrivileged } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { useUrlFilter } from '../hooks/useUrlFilter';
import { downloadProtectedFile } from '../utils/fileUrl';
import { formatDateTimeRu, toPeriodRange } from '../utils/datetime';
import { exportTicketsCsv } from '../utils/ticketsReport';
import TicketFormModal from '../components/TicketFormModal';
import Pagination from '../components/Pagination';
import Icon from '../Icon';
import { fadeUp, staggerContainer } from '../motion';

const PAGE_SIZE = 20;
/** Потолок выгрузки — совпадает с pageSize по умолчанию на бэкенде. */
const EXPORT_LIMIT = 1000;

/**
 * ТЗ «Билеты» — раздел учёта авиабилетов студентов.
 *
 * Видимость режется на бэкенде по той же формуле владения студентом, что у
 * заявок и финансов (canAccessStudentRecord), поэтому отдельного
 * ProtectedRoute с ролями здесь нет: менеджер видит билеты своих студентов,
 * Основатель и Администратор — все.
 *
 * Удаление (ТЗ п.2 «Полный доступ... включая удаление») по ролям режет
 * бэкенд; кнопка прячется только чтобы не показывать заведомо запрещённое
 * действие.
 */
export default function Tickets() {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const isAdmin = isPrivileged(me?.role);

  const defaults = useMemo(
    () => ({
      search: '',
      city: '',
      status: '',
      // '' — все даты; 'week' | 'month' — пресеты из ТЗ; 'custom' — свои даты.
      range: '',
      from: '',
      to: '',
      page: '1',
    }),
    [],
  );
  const [filters, setFilter, setFilters] = useUrlFilter(defaults);
  const search = filters.search;
  const city = filters.city;
  const status = filters.status as TicketStatus | '';
  const range = filters.range as '' | 'week' | 'month' | 'custom';
  const from = filters.from;
  const to = filters.to;
  const page = Math.max(1, parseInt(filters.page, 10) || 1);

  const [items, setItems] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [cities, setCities] = useState<ChinaCity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Ticket | null>(null);
  const uploadForRef = useRef<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  /**
   * Пресеты «на эту неделю» / «на этот месяц» из ТЗ п.4.2.
   * Неделя считается с понедельника — так живёт рабочий календарь в Таджикистане.
   */
  const periodRange = useMemo((): { from?: string; to?: string } => {
    if (range === 'custom') return toPeriodRange(from || undefined, to || undefined);
    if (range === 'week') {
      const now = new Date();
      const dow = (now.getDay() + 6) % 7; // 0 = понедельник
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
      return { from: start.toISOString(), to: end.toISOString() };
    }
    if (range === 'month') {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { from: start.toISOString(), to: end.toISOString() };
    }
    return {};
  }, [range, from, to]);

  const queryFilters = useMemo(
    () => ({
      search: search || undefined,
      city: city || undefined,
      status: status || undefined,
      ...periodRange,
    }),
    [search, city, status, periodRange],
  );

  const load = () => {
    setLoading(true);
    listTickets({ ...queryFilters, page, pageSize: PAGE_SIZE })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  };

  const loadStats = () => {
    ticketStats().then(setStats).catch(() => setStats(null));
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryFilters, page]);

  useEffect(() => {
    loadStats();
    listChinaCities().then(setCities).catch(() => setCities([]));
  }, []);

  // Схлопываем поток ticket:updated в одну перезагрузку — тот же приём, что в
  // Applications.tsx и Grants.tsx.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime({
    'ticket:updated': () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        load();
        loadStats();
      }, 600);
    },
  });

  const onFilterChange = (key: keyof typeof defaults, value: string) => {
    setFilters({ [key]: value, page: '1' });
  };

  const onRangeChange = (value: string) => {
    // Уходя с «своего периода», чистим даты — иначе они висят в URL
    // невидимым фильтром и список молча не совпадает с выбранным пресетом.
    if (value === 'custom') {
      setFilters({ range: value, page: '1' });
    } else {
      setFilters({ range: value, from: '', to: '', page: '1' });
    }
  };

  const onDelete = async (t: Ticket) => {
    const ok = await confirm({
      title: 'Удалить билет',
      message: `Билет ${t.flightNumber} (${t.student?.fullName ?? 'студент'}) будет скрыт из раздела. Данные останутся в системе и в журнале действий.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    setBusyId(t.id);
    try {
      await deleteTicket(t.id);
      toast('Билет удалён', 'success');
      load();
      loadStats();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Не удалось удалить билет', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const onDownload = async (t: Ticket) => {
    const doc = t.documents[0];
    if (!doc) return;
    setBusyId(t.id);
    try {
      const ext = doc.originalName.includes('.') ? `.${doc.originalName.split('.').pop()}` : '';
      const safeName = `${t.student?.fullName ?? 'Студент'} — ${t.flightNumber}${ext}`.replace(/[\\/:*?"<>|]/g, '_');
      await downloadProtectedFile(doc.url, safeName);
    } catch {
      toast('Не удалось скачать файл билета', 'error');
    } finally {
      setBusyId(null);
    }
  };

  /** Прикрепление файла к билету, заведённому без него. */
  const onPickFile = (ticketId: string) => {
    uploadForRef.current = ticketId;
    uploadInputRef.current?.click();
  };

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const ticketId = uploadForRef.current;
    e.target.value = '';
    uploadForRef.current = null;
    if (!file || !ticketId) return;
    setBusyId(ticketId);
    try {
      await uploadTicketDocument(ticketId, file);
      toast('Файл билета прикреплён', 'success');
      load();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Не удалось загрузить файл', 'error');
    } finally {
      setBusyId(null);
    }
  };

  /**
   * ТЗ п.2 — массовый экспорт для Администратора. Выгружаем ТЕКУЩИЙ срез
   * фильтров, а не только видимую страницу: экспортировать 20 строк из 300
   * бессмысленно.
   */
  const onExport = async () => {
    setExporting(true);
    try {
      const res = await listTickets({ ...queryFilters, page: 1, pageSize: EXPORT_LIMIT });
      if (!res.items.length) {
        toast('По текущим фильтрам билетов нет', 'info');
        return;
      }
      const truncated = res.total > res.items.length;
      exportTicketsCsv(res.items, { truncated });
      toast(
        truncated
          ? `Выгружено ${res.items.length} из ${res.total} — сузьте фильтр и повторите`
          : `Выгружено билетов: ${res.items.length}`,
        truncated ? 'info' : 'success',
      );
    } catch {
      toast('Не удалось выгрузить билеты', 'error');
    } finally {
      setExporting(false);
    }
  };

  const statCards = stats
    ? [
        { label: 'Всего билетов', value: stats.total, color: '#3b82f6', bg: '#eff6ff', icon: 'flight' },
        { label: 'Вылет ≤ 7 дней', value: stats.upcoming7, color: '#d52b2b', bg: '#fff0f0', icon: 'flight_takeoff' },
        { label: 'Вылет ≤ 30 дней', value: stats.upcoming30, color: '#f59e0b', bg: '#fffbeb', icon: 'event_upcoming' },
        { label: 'Не выкуплено', value: stats.booked, color: '#8b5cf6', bg: '#f5f3ff', icon: 'pending_actions' },
        { label: 'Отменённых', value: stats.cancelled, color: '#64748b', bg: '#f1f5f9', icon: 'cancel' },
      ]
    : [];

  /** Дней до вылета; отрицательное — рейс уже был. */
  const daysUntil = (iso: string): number => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

  return (
    <div>
      {stats && (
        <motion.div className="stats-grid" variants={staggerContainer} initial="hidden" animate="show">
          {statCards.map((c) => (
            <motion.div key={c.label} className="stat-card" variants={fadeUp}>
              <div className="stat-icon-row">
                <div>
                  <div className="stat-label">{c.label}</div>
                  <div className="stat-value" style={{ color: c.color }}>{c.value}</div>
                </div>
                <div className="stat-icon" style={{ background: c.bg, color: c.color }}>
                  <Icon name={c.icon} size={24} />
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="card-header">
          <h2 className="card-title">Билеты</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isAdmin && (
              <button className="btn btn-secondary" onClick={onExport} disabled={exporting || loading}>
                <Icon name="download" size={16} />
                {exporting ? 'Выгружаем...' : 'Экспорт CSV'}
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Icon name="add" size={16} />
              Новый билет
            </button>
          </div>
        </div>

        <div className="card-body">
          <div className="filters">
            <input
              placeholder="ФИО студента или номер рейса..."
              value={search}
              onChange={(e) => onFilterChange('search', e.target.value)}
            />
            <select value={city} onChange={(e) => onFilterChange('city', e.target.value)}>
              <option value="">Все города</option>
              {cities.map((c) => (
                <option key={c.value} value={c.value}>{c.value}</option>
              ))}
              {/* Город мог быть введён вручную — иначе выбранный фильтр
                  пропал бы из списка после перезагрузки страницы. */}
              {city && !cities.some((c) => c.value === city) && <option value={city}>{city}</option>}
            </select>
            <select value={range} onChange={(e) => onRangeChange(e.target.value)}>
              <option value="">Любая дата вылета</option>
              <option value="week">На эту неделю</option>
              <option value="month">На этот месяц</option>
              <option value="custom">Свой период</option>
            </select>
            {range === 'custom' && (
              <>
                <input type="date" value={from} onChange={(e) => onFilterChange('from', e.target.value)} title="Вылет с" />
                <input type="date" value={to} onChange={(e) => onFilterChange('to', e.target.value)} title="Вылет по" />
              </>
            )}
            <select value={status} onChange={(e) => onFilterChange('status', e.target.value)}>
              <option value="">Все статусы</option>
              {TICKET_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{TICKET_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>

          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div key="loading" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                Загрузка...
              </motion.div>
            ) : total === 0 ? (
              <motion.div key="empty" className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="empty-icon"><Icon name="flight" size={48} /></div>
                Билетов не найдено
              </motion.div>
            ) : (
              <motion.div key="table" className="table-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Студент</th>
                      <th>Город назначения</th>
                      <th>Вылет</th>
                      <th>Рейс</th>
                      <th>Статус</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((t) => {
                      const left = daysUntil(t.departureAt);
                      const past = left < 0;
                      const soon = !past && left <= 7 && t.status !== 'CANCELLED';
                      const doc = t.documents[0];
                      const busy = busyId === t.id;
                      return (
                        <tr key={t.id}>
                          <td>
                            <Link to={`/students/${t.studentId}`} className="link-cell" onClick={(e) => e.stopPropagation()}>
                              {t.student?.fullName ?? '—'}
                            </Link>
                            {t.student?.phones?.[0] && (
                              <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>{t.student.phones[0]}</div>
                            )}
                          </td>
                          <td data-label="Город назначения">{t.destinationCity}</td>
                          <td data-label="Вылет">
                            <div>{formatDateTimeRu(t.departureAt)}</div>
                            <div
                              style={{
                                fontSize: 12,
                                color: soon ? 'var(--danger)' : 'var(--text-soft)',
                              }}
                            >
                              {past
                                ? 'рейс состоялся'
                                : left === 0
                                  ? 'сегодня'
                                  : `через ${left} дн.`}
                            </div>
                          </td>
                          <td data-label="Рейс">
                            <strong>{t.flightNumber}</strong>
                            {t.airline && (
                              <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>{t.airline}</div>
                            )}
                          </td>
                          <td data-label="Статус">
                            <span className={`badge ${TICKET_STATUS_BADGE[t.status]}`}>{TICKET_STATUS_LABEL[t.status]}</span>
                          </td>
                          <td data-label="Действия">
                            <div className="row-actions">
                              <button
                                className="btn btn-sm btn-secondary"
                                onClick={() => {
                                  setEditing(t);
                                  setFormOpen(true);
                                }}
                                title="Редактировать"
                              >
                                <Icon name="edit" size={16} />
                              </button>
                              {doc ? (
                                <button
                                  className="btn btn-sm btn-secondary"
                                  onClick={() => onDownload(t)}
                                  disabled={busy}
                                  title={`Скачать файл билета (${doc.originalName})`}
                                >
                                  <Icon name="download" size={16} />
                                </button>
                              ) : (
                                <button
                                  className="btn btn-sm btn-secondary"
                                  onClick={() => onPickFile(t.id)}
                                  disabled={busy}
                                  title="Прикрепить файл билета"
                                >
                                  <Icon name="attach_file" size={16} />
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  className="btn btn-sm btn-danger"
                                  onClick={() => onDelete(t)}
                                  disabled={busy}
                                  title="Удалить"
                                >
                                  <Icon name="delete" size={16} />
                                </button>
                              )}
                            </div>
                            {t.comment && (
                              <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 4 }} title={t.comment}>
                                {t.comment.length > 40 ? `${t.comment.slice(0, 40)}...` : t.comment}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </motion.div>
            )}
          </AnimatePresence>

          {!loading && (
            <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={(p) => setFilter('page', String(p))} />
          )}
        </div>
      </motion.div>

      {/* Один скрытый input на всю таблицу — переиспользуется для любой строки. */}
      <input
        ref={uploadInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/*"
        style={{ display: 'none' }}
        onChange={onFileSelected}
      />

      <AnimatePresence>
        {formOpen && (
          <TicketFormModal
            ticket={editing}
            onClose={() => {
              setFormOpen(false);
              setEditing(null);
            }}
            onSaved={() => {
              load();
              loadStats();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
