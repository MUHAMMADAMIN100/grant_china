import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  TICKET_STATUS_BADGE,
  TICKET_STATUS_LABEL,
  approveTicket,
  listTickets,
  rejectTicket,
  type Ticket,
} from '../api/tickets';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { downloadProtectedFile } from '../utils/fileUrl';
import { formatDateTimeRu } from '../utils/datetime';
import PaymentReasonPrompt from './PaymentReasonPrompt';
import TicketFormModal from './TicketFormModal';
import Icon from '../Icon';

type Props = {
  /** После принятия/отклонения родитель обновляет счётчик вкладки, сводку и общий список. */
  onChanged: () => void;
};

/**
 * 26.08.2026 — очередь билетов, поданных студентами из кабинета.
 *
 * Отдельная таблица, а не фильтр общей: здесь другой набор колонок («кто и
 * когда подал», файл) и другие действия (принять/отклонить вместо
 * редактирования). Порядок — по времени подачи, кто раньше прислал, того
 * раньше и проверят (см. tickets.service.findAll).
 *
 * «Изменить» здесь тоже есть: менеджер может поправить опечатку в номере
 * рейса и сразу принять, а не отклонять из-за одной буквы. После его правки
 * студент билет больше не редактирует (staffEditedAt на бэкенде).
 */
export default function PendingTicketsTable({ onChanged }: Props) {
  const { confirm, toast } = useUI();
  const [items, setItems] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Ticket | null>(null);
  const [editing, setEditing] = useState<Ticket | null>(null);

  const load = (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    listTickets({ review: 'pending', pageSize: 100 })
      .then((res) => setItems(res.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // Студент правит или отзывает заявку, пока менеджер на неё смотрит —
  // таблица обязана это показать сама, иначе подтвердят то, чего уже нет.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime({
    'ticket:updated': () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        load({ silent: true });
      }, 500);
    },
  });

  const daysUntil = (iso: string): number => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

  const onApprove = async (t: Ticket) => {
    const ok = await confirm({
      title: 'Подтвердить билет',
      message: `Рейс ${t.flightNumber} → ${t.destinationCity}, вылет ${formatDateTimeRu(t.departureAt)}. После подтверждения билет попадёт в общий список и напоминания.`,
      confirmText: 'Подтвердить',
    });
    if (!ok) return;
    setBusyId(t.id);
    try {
      await approveTicket(t.id);
      setItems((prev) => prev.filter((x) => x.id !== t.id));
      toast('Билет подтверждён', 'success');
      onChanged();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Не удалось подтвердить билет', 'error');
      load({ silent: true });
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async (t: Ticket, reason: string) => {
    setRejecting(null);
    setBusyId(t.id);
    try {
      await rejectTicket(t.id, reason);
      setItems((prev) => prev.filter((x) => x.id !== t.id));
      toast('Билет отклонён — студент увидит причину в кабинете', 'success');
      onChanged();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Не удалось отклонить билет', 'error');
      load({ silent: true });
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
      const safeName = `${t.student?.fullName ?? 'student'} — ${t.flightNumber}${ext}`.replace(/[\\/:*?"<>|]/g, '_');
      await downloadProtectedFile(doc.url, safeName);
    } catch {
      toast('Не удалось скачать файл билета', 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="empty">Загрузка...</div>;
  }

  if (items.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon"><Icon name="task_alt" size={48} /></div>
        Нет билетов, ожидающих подтверждения
        <div className="receipt-dropzone-hint" style={{ marginTop: 10 }}>
          Сюда попадают билеты, которые студенты добавляют сами в личном кабинете. Пока билет здесь, в общем
          списке и в сводке его нет.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="receipt-dropzone-hint" style={{ marginBottom: 12 }}>
        Данные внёс студент — проверьте номер рейса и дату по файлу билета. «Принять» переносит билет в общий
        список, «Отклонить» возвращает его студенту с вашей причиной.
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Студент</th>
              <th>Город назначения</th>
              <th>Вылет</th>
              <th>Рейс</th>
              <th>Подан</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => {
              const left = daysUntil(t.departureAt);
              const past = left < 0;
              const doc = t.documents[0];
              const busy = busyId === t.id;
              return (
                <tr key={t.id}>
                  <td>
                    <Link to={`/students/${t.studentId}`} className="link-cell">
                      {t.student?.fullName ?? '—'}
                    </Link>
                    {t.student?.phones?.[0] && (
                      <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>{t.student.phones[0]}</div>
                    )}
                  </td>
                  <td data-label="Город назначения">{t.destinationCity}</td>
                  <td data-label="Вылет">
                    <div>{formatDateTimeRu(t.departureAt)}</div>
                    <div style={{ fontSize: 12, color: past ? 'var(--danger)' : 'var(--text-soft)' }}>
                      {past ? 'дата уже прошла' : left === 0 ? 'сегодня' : `через ${left} дн.`}
                    </div>
                  </td>
                  <td data-label="Рейс">
                    <strong>{t.flightNumber}</strong>
                    {t.airline && <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>{t.airline}</div>}
                    <span className={`badge ${TICKET_STATUS_BADGE[t.status]}`} style={{ marginTop: 4 }}>
                      {TICKET_STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td data-label="Подан">
                    <div>{formatDateTimeRu(t.submittedByStudentAt ?? t.createdAt)}</div>
                    {doc ? (
                      <button
                        className="btn btn-sm btn-secondary"
                        style={{ marginTop: 4 }}
                        onClick={() => onDownload(t)}
                        disabled={busy}
                        title={doc.originalName}
                      >
                        <Icon name="download" size={15} style={{ marginRight: 4 }} />
                        Файл билета
                      </button>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 4 }}>без файла</div>
                    )}
                  </td>
                  <td data-label="Действия">
                    <div className="row-actions">
                      <button className="btn btn-sm btn-primary" onClick={() => onApprove(t)} disabled={busy}>
                        <Icon name="check" size={16} style={{ marginRight: 4 }} />
                        Принять
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => setRejecting(t)} disabled={busy}>
                        <Icon name="close" size={16} style={{ marginRight: 4 }} />
                        Отклонить
                      </button>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => setEditing(t)}
                        disabled={busy}
                        title="Поправить данные перед подтверждением"
                      >
                        <Icon name="edit" size={16} />
                      </button>
                    </div>
                    {t.comment && (
                      <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 4 }} title={t.comment}>
                        {t.comment.length > 60 ? `${t.comment.slice(0, 60)}...` : t.comment}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {rejecting && (
          <PaymentReasonPrompt
            key="reject"
            title="Отклонить билет"
            message={`${rejecting.student?.fullName ?? 'Студент'} увидит причину в личном кабинете и сможет подать билет заново.`}
            confirmText="Отклонить"
            danger
            onCancel={() => setRejecting(null)}
            onConfirm={(reason) => onReject(rejecting, reason)}
          />
        )}
        {editing && (
          <TicketFormModal
            key={editing.id}
            ticket={editing}
            studentName={editing.student?.fullName}
            onClose={() => setEditing(null)}
            onSaved={() => {
              load({ silent: true });
              onChanged();
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
