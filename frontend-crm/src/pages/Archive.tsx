import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { listStudentsPaged, unarchiveStudents } from '../api/students';
import { listUsers } from '../api/users';
import type { Direction, Student, User } from '../api/types';
import { DIRECTION_LABEL, STUDENT_STATUS_LABEL, isPrivileged } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import DirectionOptions from '../components/DirectionOptions';
import Pagination from '../components/Pagination';
import { BulkBar, HeaderCheckbox, RowCheckbox } from '../components/BulkSelect';
import Icon from '../Icon';
import { useUrlFilter } from '../hooks/useUrlFilter';
import { archiveResultToast } from '../utils/archive';
import { plural } from '../utils/plural';

const PAGE_SIZE = 10;

/**
 * 29.09.2026 — раздел «Архив» (пункт меню).
 *
 * Студенты, которых отправили в архив галочками из «Студентов» или кнопкой
 * в карточке. Решения владельца: здесь только студенты (архив заявок остаётся
 * вкладкой в «Заявках»); вернуть может тот, кто может править карточку —
 * руководство любых, менеджер своих (менеджер и видит здесь только своих).
 *
 * Экран намеренно устроен как «Студенты»: те же фильтры, та же таблица, те же
 * галочки и та же панель «Выбрано: N» — только действие обратное.
 */
export default function Archive() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const { toast, confirm } = useUI();
  const isAdmin = isPrivileged(me?.role);

  const defaults = useMemo(
    () => ({
      search: '',
      direction: '',
      manager: '',
      scope: isAdmin ? 'all' : 'mine',
      page: '1',
    }),
    [isAdmin],
  );
  const [filters, setFilter, setFilters] = useUrlFilter(defaults);
  const search = filters.search;
  const direction = filters.direction as Direction | '';
  const manager = filters.manager;
  const scope = filters.scope as 'all' | 'mine';
  const page = Math.max(1, parseInt(filters.page, 10) || 1);

  const [items, setItems] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // id → ФИО. Map, а не Set: окно подтверждения и тост называют людей по имени,
  // а выбранные на других страницах в текущем items уже не лежат.
  const [selected, setSelected] = useState<Map<string, string>>(() => new Map());
  const [busy, setBusy] = useState(false);

  // Тот же приём, что в «Студентах»: ответ устаревшего запроса отбрасываем.
  const reqRef = useRef(0);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      load();
    }, 500);
  };

  const load = () => {
    const my = ++reqRef.current;
    setLoading(true);
    setError(null);
    listStudentsPaged({
      archived: true,
      search: search || undefined,
      direction: direction || undefined,
      mine: scope === 'mine',
      manager: manager || undefined,
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
        setItems([]);
        setTotal(0);
        setError(e?.response?.data?.message || 'Не удалось загрузить архив');
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
  }, [search, direction, manager, scope, page]);

  // Вернули последнего на странице — сдвигаемся на существующую страницу.
  useEffect(() => {
    if (loading) return;
    if (total === 0) return;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > totalPages) setFilter('page', String(totalPages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, loading]);

  // Смена фильтра сбрасывает выбор: иначе «Вернуть» задело бы людей, которых
  // сейчас не видно на экране. Переход по страницам выбор сохраняет.
  const onFilterChange = (key: 'search' | 'direction' | 'manager' | 'scope', value: string) => {
    setFilters({ [key]: value, page: '1' });
    setSelected(new Map());
  };

  useEffect(() => {
    if (!isAdmin) return;
    listUsers().then(setUsers).catch(() => {});
  }, [isAdmin]);

  useRealtime({
    'student:updated': () => scheduleReload(),
  });

  const pageIds = items.map((s) => s.id);
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;
  const allOnPage = items.length > 0 && selectedOnPage === items.length;

  const toggle = (s: Student, on: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (on) next.set(s.id, s.fullName);
      else next.delete(s.id);
      return next;
    });
  };
  const togglePage = (on: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const s of items) {
        if (on) next.set(s.id, s.fullName);
        else next.delete(s.id);
      }
      return next;
    });
  };

  const restore = async (list: Array<{ id: string; fullName: string }>) => {
    if (list.length === 0 || busy) return;
    const n = list.length;
    const ok = await confirm({
      title: n === 1 ? 'Вернуть из архива' : `Вернуть из архива ${n} ${plural(n, 'студента', 'студентов', 'студентов')}`,
      message:
        n === 1
          ? `«${list[0].fullName}» вернётся в «Студенты» с прежним статусом: снова откроется личный кабинет, вернутся заявки, ушедшие в архив вместе с ним.`
          : 'Студенты вернутся в «Студенты» с прежним статусом: снова откроется личный кабинет, вернутся заявки, ушедшие в архив вместе с ними.',
      confirmText: 'Вернуть',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await unarchiveStudents(list.map((s) => s.id));
      const t = archiveResultToast(res.restored, res.skipped, 'restore');
      toast(t.message, t.kind);
      // Как в «Студентах»: выбор снимаем целиком — вернувшихся здесь больше нет,
      // а пропущенные сервером (уже вернул коллега) тоже пропадут с экрана.
      setSelected(new Map());
      load();
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      toast(Array.isArray(msg) ? msg.join(', ') : msg || 'Не удалось вернуть из архива', 'error');
    } finally {
      setBusy(false);
    }
  };

  const hasFilters = !!(search || direction || manager);

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="card-header">
        <h2 className="card-title">Архив студентов</h2>
        <div className="card-header-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
        </div>
      </div>
      <div className="card-body">
        <div className="archive-hint">
          <Icon name="info" size={16} />
          <span>
            Студенты в архиве не видны в «Студентах», их личный кабинет закрыт, напоминания не приходят. Платежи,
            договоры и документы сохранены. «Вернуть» возвращает прежний статус и заявки, ушедшие в архив вместе со студентом.
          </span>
        </div>

        <div className="filters">
          <input
            placeholder="Поиск по ФИО, email или телефону в любом формате..."
            value={search}
            onChange={(e) => onFilterChange('search', e.target.value)}
            title="Телефон можно вводить в любом виде: +992 90 123-45-67, 992901234567 или 901234567"
          />
          <select value={direction} onChange={(e) => onFilterChange('direction', e.target.value)}>
            <option value="">Все направления</option>
            <DirectionOptions />
          </select>
          {isAdmin && (
            <select
              value={manager}
              onChange={(e) => onFilterChange('manager', e.target.value)}
              title="Фильтр по менеджеру"
            >
              <option value="">Все менеджеры</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </select>
          )}
        </div>

        {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

        {selected.size > 0 && (
          <BulkBar count={selected.size} offPage={selected.size - selectedOnPage} onClear={() => setSelected(new Map())}>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => restore([...selected.entries()].map(([id, fullName]) => ({ id, fullName })))}
              disabled={busy}
              data-testid="bulk-restore"
            >
              <Icon name="unarchive" size={16} style={{ marginRight: 4 }} />
              {busy ? 'Возвращаем…' : 'Вернуть из архива'}
            </button>
          </BulkBar>
        )}

        {loading ? (
          <div className="empty">Загрузка...</div>
        ) : total === 0 ? (
          <div className="empty" data-testid="archive-empty">
            <div className="empty-icon"><Icon name="inventory_2" size={48} /></div>
            {hasFilters ? 'По этому фильтру в архиве никого нет' : scope === 'mine' ? 'В архиве нет ваших студентов' : 'Архив пуст'}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table" data-testid="archive-table">
              <thead>
                <tr>
                  <th className="select-cell">
                    <HeaderCheckbox
                      checked={allOnPage}
                      indeterminate={selectedOnPage > 0 && !allOnPage}
                      onChange={togglePage}
                    />
                  </th>
                  <th>ФИО</th><th>Телефоны</th><th>Направление</th><th>Менеджер</th><th>В архиве</th><th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const isSel = selected.has(s.id);
                  return (
                    <tr
                      key={s.id}
                      className={isSel ? 'row-selected' : undefined}
                      onClick={() => navigate(`/students/${s.id}`)}
                      data-testid="archive-row"
                    >
                      <td className="select-cell" onClick={(e) => e.stopPropagation()}>
                        <RowCheckbox checked={isSel} onChange={(on) => toggle(s, on)} name={s.fullName} />
                      </td>
                      <td className="archive-name-cell">
                        <strong>{s.fullName}</strong>
                      </td>
                      <td data-label="Телефоны">{s.phones.join(', ') || '—'}</td>
                      <td data-label="Направление">{DIRECTION_LABEL[s.direction]}</td>
                      <td data-label="Менеджеры">
                        <div className="mgr-cell">
                          <div className="mgr-row">
                            <span className="mgr-tag tj">TJ</span>
                            {s.manager ? (
                              <span className={s.manager.id === me?.id ? 'mgr-mine' : 'mgr-other'}>{s.manager.fullName}</span>
                            ) : (
                              <span className="mgr-none">—</span>
                            )}
                          </div>
                          <div className="mgr-row">
                            <span className="mgr-tag cn">CN</span>
                            {s.chinaManager ? (
                              <span className={s.chinaManager.id === me?.id ? 'mgr-mine' : 'mgr-other'}>{s.chinaManager.fullName}</span>
                            ) : (
                              <span className="mgr-none">—</span>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Когда · кто · комментарий — одной ячейкой: отдельная колонка
                          комментария не влезала в ширину, и кнопка «Вернуть» уезжала за край. */}
                      <td data-label="В архиве" data-testid="archive-when-cell">
                        <div>
                          <div className="archive-when">{s.archivedAt ? new Date(s.archivedAt).toLocaleDateString('ru-RU') : '—'}</div>
                          {s.archivedBy && <div className="archive-by">{s.archivedBy.fullName}</div>}
                          {s.archiveComment && (
                            <div className="archive-comment" title={s.archiveComment} data-testid="archive-comment-text">
                              «{s.archiveComment}»
                            </div>
                          )}
                        </div>
                      </td>
                      <td data-label="Действия" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => restore([{ id: s.id, fullName: s.fullName }])}
                          disabled={busy}
                          title={`Вернуть из архива · статус станет «${STUDENT_STATUS_LABEL[s.statusBeforeArchive && s.statusBeforeArchive !== 'ARCHIVED' ? s.statusBeforeArchive : 'ACTIVE']}»`}
                          data-testid="row-restore"
                        >
                          <Icon name="unarchive" size={14} style={{ marginRight: 4 }} />
                          Вернуть
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && (
          <Pagination
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            onChange={(p) => setFilter('page', String(p))}
          />
        )}
      </div>
    </motion.div>
  );
}
