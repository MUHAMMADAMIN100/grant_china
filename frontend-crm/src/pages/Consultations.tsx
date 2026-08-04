import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listConsultations } from '../api/consultations';
import { listUsers } from '../api/users';
import type { Consultation, ConsultationKind, ConsultationOutcome, User } from '../api/types';
import {
  CONSULTATION_KIND_LABEL,
  CONSULTATION_OUTCOME_BADGE,
  CONSULTATION_OUTCOME_LABEL,
  LEAD_SOURCES,
  isPrivileged,
  leadSourceLabel,
} from '../api/types';
import { useAuth } from '../store/auth';
import { useRealtime } from '../realtime';
import { useUrlFilter } from '../hooks/useUrlFilter';
import { formatDateTimeRu, toPeriodRange } from '../utils/datetime';
import Icon from '../Icon';
import Pagination from '../components/Pagination';
import ConsultationFormModal from '../components/ConsultationFormModal';

const PAGE_SIZE = 10;

export default function Consultations() {
  const me = useAuth((s) => s.user);
  const isAdmin = isPrivileged(me?.role);

  const defaults = useMemo(
    () => ({
      search: '',
      from: '',
      to: '',
      manager: '',
      kind: '',
      outcome: '',
      source: '',
      scope: isAdmin ? 'all' : 'mine',
      page: '1',
    }),
    [isAdmin],
  );
  const [filters, setFilter, setFilters] = useUrlFilter(defaults);
  const search = filters.search;
  const from = filters.from;
  const to = filters.to;
  const manager = filters.manager;
  const kind = filters.kind as ConsultationKind | '';
  const outcome = filters.outcome as ConsultationOutcome | '';
  const source = filters.source;
  const scope = filters.scope as 'all' | 'mine';
  const page = Math.max(1, parseInt(filters.page, 10) || 1);

  const [items, setItems] = useState<Consultation[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Consultation | null>(null);

  // Счётчик поколений запросов списка. debounce откладывает СТАРТ, но уже
  // улетевший запрос не отменяет: медленный ответ по прошлому фильтру
  // приходил после свежего и перерисовывал таблицу чужими консультациями,
  // а пагинация считалась по чужому total. Ответ с устаревшим номером
  // отбрасываем — это же снимает гонку с realtime-перезагрузкой.
  const reqRef = useRef(0);

  const load = () => {
    const my = ++reqRef.current;
    setLoading(true);
    setError(null);
    listConsultations({
      search: search || undefined,
      ...toPeriodRange(from, to),
      managerId: manager || undefined,
      kind: kind || undefined,
      outcome: outcome || undefined,
      source: source || undefined,
      mine: scope === 'mine',
      page,
      pageSize: PAGE_SIZE,
    })
      .then((res) => {
        if (my !== reqRef.current) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((e: any) => {
        if (my !== reqRef.current) return;
        // Без сброса items/total на экране осталась бы выборка ПРОШЛОГО
        // фильтра, а сброшенный loading выдал бы её за успешно применённый.
        // Пустая таблица без баннера читалась бы как «ничего не найдено».
        setItems([]);
        setTotal(0);
        setError(e?.response?.data?.message || 'Не удалось загрузить список консультаций');
      })
      .finally(() => {
        if (my !== reqRef.current) return;
        setLoading(false);
      });
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, from, to, manager, kind, outcome, source, scope, page]);

  useEffect(() => {
    if (loading) return;
    if (total === 0) return;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > totalPages) setFilter('page', String(totalPages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, loading]);

  useEffect(() => {
    if (!isAdmin) return;
    listUsers().then(setUsers).catch(() => {});
  }, [isAdmin]);

  // Debounce realtime — та же схема, что на Applications.tsx/Payments.tsx.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      load();
    }, 500);
  };
  useRealtime({
    'consultation:new': () => scheduleReload(),
    'consultation:updated': () => scheduleReload(),
    'consultation:deleted': () => scheduleReload(),
  });

  const onFilterChange = (
    key: 'search' | 'from' | 'to' | 'manager' | 'kind' | 'outcome' | 'source' | 'scope',
    value: string,
  ) => {
    setFilters({ [key]: value, page: '1' });
  };

  const onSaved = () => {
    load();
  };

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="card-header">
        <h2 className="card-title">Консультации и собеседования</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {isAdmin && (
            <div className="scope-switch">
              <button
                className={`scope-btn${scope === 'mine' ? ' active' : ''}`}
                onClick={() => onFilterChange('scope', 'mine')}
              >
                <Icon name="person" size={16} />
                Мои
              </button>
              <button
                className={`scope-btn${scope === 'all' ? ' active' : ''}`}
                onClick={() => onFilterChange('scope', 'all')}
              >
                <Icon name="groups" size={16} />
                Все
              </button>
            </div>
          )}
          <motion.button
            className="btn btn-primary"
            onClick={() => setCreating(true)}
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
          >
            <Icon name="add" size={16} style={{ marginRight: 4 }} />
            Записать консультацию
          </motion.button>
        </div>
      </div>

      <div className="card-body">
        <div className="filters">
          {/* ТЗ v3 раздел 1. consultations.service ищет тем же приёмом, что и
              applications.service: сырой Consultation.phone плюс
              phoneNormalized цифрами запроса и после normalizePhone — отсюда
              «в любом формате».
              Email в подписи НЕТ намеренно: у консультации такого поля не
              существует (schema.prisma — fullName + phone + purpose), и
              обещание искать по email отправляло бы менеджера в пустоту. */}
          <input
            placeholder="Поиск по ФИО или телефону в любом формате..."
            value={search}
            onChange={(e) => onFilterChange('search', e.target.value)}
            title="Телефон можно вводить в любом виде: +992 90 123-45-67, 992901234567 или 901234567"
          />
          <select value={kind} onChange={(e) => onFilterChange('kind', e.target.value)}>
            <option value="">Консультация и собеседование</option>
            {Object.entries(CONSULTATION_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select value={outcome} onChange={(e) => onFilterChange('outcome', e.target.value)}>
            <option value="">Все результаты</option>
            {Object.entries(CONSULTATION_OUTCOME_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select value={source} onChange={(e) => onFilterChange('source', e.target.value)} title="Источник привлечения">
            <option value="">Все источники</option>
            <option value="NONE">Не указан</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {isAdmin && (
            <select value={manager} onChange={(e) => onFilterChange('manager', e.target.value)} title="Фильтр по ответственному менеджеру">
              <option value="">Все менеджеры</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </select>
          )}
          <input type="date" value={from} onChange={(e) => onFilterChange('from', e.target.value)} title="Дата проведения от" />
          <input type="date" value={to} onChange={(e) => onFilterChange('to', e.target.value)} title="Дата проведения до" />
        </div>

        {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Загрузка...
            </motion.div>
          ) : total === 0 ? (
            <motion.div key="empty" className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="empty-icon"><Icon name="record_voice_over" size={48} /></div>
              {scope === 'mine' ? 'У вас пока нет записанных консультаций' : 'Консультаций не найдено'}
            </motion.div>
          ) : (
            <motion.div key="table" className="table-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Дата</th><th>ФИО</th><th>Телефон</th><th>Тип</th><th>Цель обращения</th><th>Менеджер</th><th>Повторный звонок</th><th>Результат</th>
                  </tr>
                </thead>
                <motion.tbody
                  initial="hidden"
                  animate="show"
                  variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
                >
                  {items.map((c) => {
                    const followUpOverdue = c.followUpAt && !c.outcome && new Date(c.followUpAt) < new Date();
                    return (
                      <motion.tr
                        key={c.id}
                        onClick={() => setEditing(c)}
                        variants={{
                          hidden: { opacity: 0, x: -10 },
                          show: { opacity: 1, x: 0, transition: { duration: 0.25 } },
                        }}
                        whileHover={{ backgroundColor: 'rgba(0,0,0,0.02)', x: 2 }}
                        style={{ cursor: 'pointer' }}
                      >
                        <td data-label="Дата">{new Date(c.heldAt).toLocaleDateString('ru-RU')}</td>
                        <td><strong>{c.fullName}</strong></td>
                        <td data-label="Телефон">{c.phone}</td>
                        <td data-label="Тип">
                          <span className={`badge ${c.kind === 'INTERVIEW' ? 'badge-info' : 'badge-gray'}`}>
                            {CONSULTATION_KIND_LABEL[c.kind]}
                          </span>
                          <div style={{ fontSize: 11, color: 'var(--text-soft)', marginTop: 4 }}>{leadSourceLabel(c.source)}</div>
                        </td>
                        <td data-label="Цель обращения" title={c.purpose} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.purpose}
                        </td>
                        <td data-label="Менеджер">
                          {c.manager ? (
                            <span className={c.manager.id === me?.id ? 'mgr-mine' : 'mgr-other'}>{c.manager.fullName}</span>
                          ) : (
                            <span className="mgr-none">—</span>
                          )}
                        </td>
                        <td data-label="Повторный звонок">
                          {c.followUpAt ? (
                            <span className={followUpOverdue ? 'badge badge-danger' : undefined}>
                              {formatDateTimeRu(c.followUpAt)}
                            </span>
                          ) : (
                            <span className="mgr-none">—</span>
                          )}
                        </td>
                        <td data-label="Результат">
                          {c.outcome ? (
                            <span className={`badge ${CONSULTATION_OUTCOME_BADGE[c.outcome]}`}>{CONSULTATION_OUTCOME_LABEL[c.outcome]}</span>
                          ) : (
                            <span className="mgr-none">—</span>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </motion.tbody>
              </table>
            </motion.div>
          )}
        </AnimatePresence>

        {!loading && (
          <Pagination
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            onChange={(p) => setFilter('page', String(p))}
          />
        )}
      </div>

      <AnimatePresence>
        {creating && (
          <ConsultationFormModal
            key="create"
            onClose={() => setCreating(false)}
            onSaved={onSaved}
          />
        )}
        {editing && (
          <ConsultationFormModal
            key={editing.id}
            consultation={editing}
            onClose={() => setEditing(null)}
            onSaved={onSaved}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
