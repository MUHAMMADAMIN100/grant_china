import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  TICKET_STATUS_BADGE,
  TICKET_STATUS_LABEL,
  deleteTicket,
  deleteTicketDocument,
  listTickets,
  uploadTicketDocument,
  type Ticket,
} from '../api/tickets';
import { isPrivileged } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { downloadProtectedFile } from '../utils/fileUrl';
import { formatDateTimeRu } from '../utils/datetime';
import { removeById, runOptimistic } from '../utils/optimistic';
import TicketFormModal from './TicketFormModal';
import Icon from '../Icon';

type Props = {
  studentId: string;
  studentName: string;
  /** Та же граница, что у GrantCard и PaymentsSection: isAdmin || свой менеджер. */
  canEdit: boolean;
};

/**
 * ТЗ «Билеты» — блок перелётов в карточке студента.
 *
 * Здесь билеты нужны в другом разрезе, чем в общем разделе: не «кто летит на
 * этой неделе», а «вся история перелётов этого человека» — включая
 * перебронирования, поэтому отменённые записи тоже показываем.
 */
export default function TicketsCard({ studentId, studentName, canEdit }: Props) {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const isPriv = isPrivileged(me?.role);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: 'create' } | { kind: 'edit'; ticket: Ticket } | null>(null);
  const uploadForRef = useRef<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  /**
   * `silent` — обновление на фоне: карточка не подменяется строкой «Загрузка...».
   * Первый показ и переход к другому студенту — обычные, со спиннером; всё
   * остальное (событие от другого сотрудника, возврат из формы) не должно
   * гасить блок под руками у того, кто в него смотрит.
   */
  const load = (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    listTickets({ studentId, pageSize: 20 })
      .then((res) => setTickets(res.items))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  useRealtime({
    'ticket:updated': (d: any) => {
      // Событие приходит и на собственное удаление — перезагрузка сверит
      // локально убранную строку с сервером. Список заменяется целиком,
      // поэтому задвоиться нечему.
      if (d?.studentId === studentId) load({ silent: true });
    },
  });

  /**
   * Удаление билета. Строка уходит сразу, запрос — следом.
   *
   * Было два похода на сервер на клик: DELETE и перезагрузка всего списка
   * билетов студента. Стало — один; сервер отказал (нет прав, билет уже удалён
   * другим сотрудником) — строка возвращается на место вместе с причиной.
   * busyId не трогаем: блокировать нечего, строки на экране уже нет.
   */
  const onDelete = async (t: Ticket) => {
    const ok = await confirm({
      title: 'Удалить билет',
      message: `Билет ${t.flightNumber} будет скрыт из карточки. Данные останутся в системе и в журнале действий.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    const done = await runOptimistic<Ticket[], { ok: true }>({
      current: tickets,
      optimistic: (prev) => removeById(prev, t.id),
      commit: setTickets,
      request: () => deleteTicket(t.id),
      onError: (message) => toast(message, 'error'),
    });
    if (done) toast('Билет удалён', 'success');
  };

  const onDownload = async (t: Ticket) => {
    const doc = t.documents[0];
    if (!doc) return;
    setBusyId(t.id);
    try {
      const ext = doc.originalName.includes('.') ? `.${doc.originalName.split('.').pop()}` : '';
      const safeName = `${studentName} — ${t.flightNumber}${ext}`.replace(/[\\/:*?"<>|]/g, '_');
      await downloadProtectedFile(doc.url, safeName);
    } catch {
      toast('Не удалось скачать файл билета', 'error');
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Удаление приложенного файла. Без этой кнопки ошибочно прикреплённую чужую
   * квитанцию исправить нечем: общий эндпоинт документов удалять файлы билета
   * не даёт, а замены «поверх» бэкенд не делает.
   */
  const onDeleteDoc = async (t: Ticket) => {
    const doc = t.documents[0];
    if (!doc) return;
    const ok = await confirm({
      title: 'Удалить файл билета',
      message: `Файл «${doc.originalName}» будет удалён из билета ${t.flightNumber}. Данные рейса останутся, файл можно приложить заново.`,
      confirmText: 'Удалить файл',
      danger: true,
    });
    if (!ok) return;
    setBusyId(t.id);
    try {
      await deleteTicketDocument(doc.id);
      toast('Файл билета удалён', 'success');
      load();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Не удалось удалить файл', 'error');
    } finally {
      setBusyId(null);
    }
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

  return (
    <div className="sub-card">
      <div className="sub-card-header">
        <div className="sub-card-title">
          <Icon name="flight" size={18} style={{ marginRight: 6 }} />
          Билеты
        </div>
        {canEdit && (
          <button className="btn btn-sm btn-secondary" onClick={() => setModal({ kind: 'create' })}>
            <Icon name="add" size={15} style={{ marginRight: 4 }} />
            Добавить билет
          </button>
        )}
      </div>

      {loading ? (
        <div className="empty" style={{ padding: 16 }}>Загрузка...</div>
      ) : tickets.length === 0 ? (
        <div className="sub-card-empty">Билетов нет</div>
      ) : (
        <div className="sub-card-list">
          {tickets.map((t) => {
            const doc = t.documents[0];
            const busy = busyId === t.id;
            return (
              <motion.div key={t.id} className="sub-item" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <div className="sub-item-head">
                  <div className="sub-item-title">
                    {t.destinationCity} · рейс {t.flightNumber}
                    {t.airline && <span className="sub-item-muted"> · {t.airline}</span>}
                  </div>
                  <span className={`badge ${TICKET_STATUS_BADGE[t.status]}`}>{TICKET_STATUS_LABEL[t.status]}</span>
                </div>

                <div className="sub-item-figures">
                  <div>
                    <span>Вылет</span>
                    <strong>{formatDateTimeRu(t.departureAt)}</strong>
                  </div>
                  <div>
                    <span>Прилёт</span>
                    <strong>{formatDateTimeRu(t.arrivalAt)}</strong>
                  </div>
                </div>

                {t.comment && <div className="sub-item-note">{t.comment}</div>}

                <div className="sub-item-actions">
                  {doc ? (
                    <>
                      <button className="btn btn-sm btn-secondary" onClick={() => onDownload(t)} disabled={busy}>
                        <Icon name="download" size={15} style={{ marginRight: 4 }} />
                        Скачать билет
                      </button>
                      {/* Условие видимости то же, что у «Изменить»: кто правит билет,
                          тот и исправляет ошибочно приложенный файл. */}
                      {canEdit && (
                        <button className="btn btn-sm btn-secondary" onClick={() => onDeleteDoc(t)} disabled={busy}>
                          <Icon name="delete" size={15} style={{ marginRight: 4 }} />
                          Удалить файл
                        </button>
                      )}
                    </>
                  ) : (
                    canEdit && (
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => {
                          uploadForRef.current = t.id;
                          uploadInputRef.current?.click();
                        }}
                        disabled={busy}
                      >
                        <Icon name="attach_file" size={15} style={{ marginRight: 4 }} />
                        Прикрепить файл
                      </button>
                    )
                  )}
                  {canEdit && (
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => setModal({ kind: 'edit', ticket: t })}
                      disabled={busy}
                    >
                      Изменить
                    </button>
                  )}
                  {isPriv && (
                    <button className="btn btn-sm btn-danger" onClick={() => onDelete(t)} disabled={busy}>
                      Удалить
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <input
        ref={uploadInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/*"
        style={{ display: 'none' }}
        onChange={onFileSelected}
      />

      {/* onSaved — честная перезагрузка, а не предсказание: id нового билета и
          прикреплённый файл рождаются на бэкенде. Но тихая — модалка к этому
          моменту закрыта, и карточке гаснуть незачем. */}
      <AnimatePresence>
        {modal?.kind === 'create' && (
          <TicketFormModal
            key="create"
            studentId={studentId}
            studentName={studentName}
            onClose={() => setModal(null)}
            onSaved={() => load({ silent: true })}
          />
        )}
        {modal?.kind === 'edit' && (
          <TicketFormModal
            key={modal.ticket.id}
            ticket={modal.ticket}
            studentName={studentName}
            onClose={() => setModal(null)}
            onSaved={() => load({ silent: true })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
