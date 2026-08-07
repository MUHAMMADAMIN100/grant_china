import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  GRANT_INTAKE_LABEL,
  GRANT_STATUS_BADGE,
  GRANT_STATUS_LABEL,
  advanceGrant,
  deleteGrant,
  listGrants,
  ordinalShortRu,
  type StudentGrant,
} from '../api/grants';
import { isPrivileged } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { removeById, runOptimistic } from '../utils/optimistic';
import GrantFormModal from './GrantFormModal';
import Icon from '../Icon';

type Props = {
  studentId: string;
  /** Может ли текущий пользователь вести карточку студента (isAdmin || свой менеджер) — та же граница, что у PaymentsSection. */
  canEdit: boolean;
};

const fmtDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '—');

const daysUntil = (iso: string): number => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

/**
 * ТЗ 4 — блок «Грант» в карточке студента: признак пролонгации (totalYears > 1),
 * текущий год обучения, дата старта учебного года, сколько лет всего.
 * У человека грантов может быть НЕСКОЛЬКО (языковой год → бакалавриат) —
 * поэтому рендерим список карточек, а не одно поле.
 */
export default function GrantCard({ studentId, canEdit }: Props) {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const [grants, setGrants] = useState<StudentGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ kind: 'create' } | { kind: 'edit'; grant: StudentGrant } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isPriv = isPrivileged(me?.role);

  /**
   * `silent` — обновление на фоне: карточка не подменяется строкой «Загрузка...».
   * Со спиннером остаются только первый показ и переход к другому студенту;
   * событие от другого сотрудника гасить блок под руками не должно.
   */
  const load = (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    // multiOnly: false — карточка студента должна показывать ЛЮБОЙ грант
    // (включая разовый, на 1 год), не только «двойные» из общего реестра.
    listGrants({ studentId, multiOnly: false, pageSize: 20 })
      .then((res) => setGrants(res.items))
      .catch(() => setGrants([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  useRealtime({
    // Событие приходит и на собственное закрытие гранта: перезагрузка сверит
    // локально убранную карточку с сервером. Список заменяется целиком —
    // задвоиться нечему.
    'grant:updated': (d: any) => { if (d?.studentId === studentId) load({ silent: true }); },
  });

  const onAdvance = async (g: StudentGrant) => {
    const nextN = g.currentYear + 1;
    const ok = await confirm({
      title: 'Перевести на следующий год',
      message: `Подтвердите, что грант продлён на ${ordinalShortRu(nextN)} год обучения. Действие фиксируется в журнале активности и не может быть отменено автоматически.`,
      confirmText: 'Подтвердить',
    });
    if (!ok) return;
    setBusyId(g.id);
    try {
      await advanceGrant(g.id);
      toast(`Грант переведён на ${ordinalShortRu(nextN)} год`, 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка перевода на следующий год', 'error');
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Закрытие гранта. Карточка исчезает сразу, запрос уходит следом.
   *
   * Здесь предсказывать нечего: удаление — не расчёт, результат известен
   * заранее (в отличие от перевода на следующий год выше, где дату считает
   * сервер и потому ждём ответ). Было два похода на сервер на клик — DELETE и
   * перезагрузка всего списка грантов; стало — один. Сервер отказал (нет прав,
   * грант уже закрыт другим) — карточка возвращается на место вместе с
   * причиной отказа.
   */
  const onClose = async (g: StudentGrant) => {
    const ok = await confirm({
      title: 'Закрыть грант',
      message: `Запись «${g.name || 'Грант'}» будет удалена из реестра. Действие нельзя отменить.`,
      confirmText: 'Закрыть',
      danger: true,
    });
    if (!ok) return;
    const done = await runOptimistic<StudentGrant[], { ok: true }>({
      current: grants,
      optimistic: (prev) => removeById(prev, g.id),
      commit: setGrants,
      request: () => deleteGrant(g.id),
      onError: (message) => toast(message, 'error'),
    });
    if (done) toast('Грант закрыт', 'success');
  };

  const renderGrant = (g: StudentGrant) => {
    const canAdvance = g.status === 'ACTIVE' && !!g.nextYearStartsAt && g.currentYear < g.totalYears;
    const soon = g.nextYearStartsAt ? daysUntil(g.nextYearStartsAt) : null;
    return (
      <motion.div key={g.id} className="grant-item" layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <div className="grant-item-head">
          <div className="grant-item-title">
            {g.name || 'Грант'}
            {g.university && <span className="grant-item-university"> · {g.university}</span>}
          </div>
          <span className={`badge ${GRANT_STATUS_BADGE[g.status]}`}>{GRANT_STATUS_LABEL[g.status]}</span>
        </div>

        <div className="grant-item-figures">
          <div>
            <span>Год обучения</span>
            <strong>
              {ordinalShortRu(g.currentYear)} из {g.totalYears}
              {g.totalYears > 1 && <span className="badge badge-info" style={{ marginLeft: 6 }}>Двойной грант</span>}
            </strong>
          </div>
          <div>
            <span>Набор</span>
            <strong>{GRANT_INTAKE_LABEL[g.intake]}</strong>
          </div>
          <div>
            <span>Начало обучения</span>
            <strong>{fmtDate(g.startDate)}</strong>
          </div>
          <div>
            <span>Следующий учебный год</span>
            <strong>
              {fmtDate(g.nextYearStartsAt)}
              {soon !== null && soon >= 0 && soon <= 60 && (
                <span className="badge badge-warning" style={{ marginLeft: 6 }}>через {soon} дн.</span>
              )}
            </strong>
          </div>
        </div>

        {g.note && <div className="grant-item-note">{g.note}</div>}

        {canEdit && (
          <div className="grant-item-actions">
            {canAdvance && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => onAdvance(g)}
                disabled={busyId === g.id}
              >
                <Icon name="trending_up" size={15} style={{ marginRight: 4 }} />
                Перевести на следующий год
              </button>
            )}
            <button className="btn btn-sm btn-secondary" onClick={() => setModal({ kind: 'edit', grant: g })} disabled={busyId === g.id}>
              Изменить
            </button>
            {isPriv && (
              <button className="btn btn-sm btn-danger" onClick={() => onClose(g)} disabled={busyId === g.id}>
                Закрыть
              </button>
            )}
          </div>
        )}
      </motion.div>
    );
  };

  return (
    <div className="grant-card">
      <div className="grant-card-header">
        <div className="grant-card-title">
          <Icon name="workspace_premium" size={18} style={{ marginRight: 6 }} />
          {grants.length > 1 ? 'Гранты' : 'Грант'}
        </div>
        {canEdit && (
          <button className="btn btn-sm btn-secondary" onClick={() => setModal({ kind: 'create' })}>
            <Icon name="add" size={15} style={{ marginRight: 4 }} />
            Добавить грант
          </button>
        )}
      </div>

      {loading ? (
        <div className="empty" style={{ padding: 16 }}>Загрузка...</div>
      ) : grants.length === 0 ? (
        <div className="grant-card-empty">Грант не оформлен</div>
      ) : (
        <div className="grant-card-list">{grants.map(renderGrant)}</div>
      )}

      {/* onSaved — честная перезагрузка, а не предсказание: у нового гранта id
          и дату следующего учебного года считает бэкенд. Но тихая: модалка к
          этому моменту закрыта, и карточке гаснуть незачем. */}
      <AnimatePresence>
        {modal?.kind === 'create' && (
          <GrantFormModal key="create" studentId={studentId} onClose={() => setModal(null)} onSaved={() => load({ silent: true })} />
        )}
        {modal?.kind === 'edit' && (
          <GrantFormModal
            key="edit"
            studentId={studentId}
            grant={modal.grant}
            onClose={() => setModal(null)}
            onSaved={() => load({ silent: true })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
