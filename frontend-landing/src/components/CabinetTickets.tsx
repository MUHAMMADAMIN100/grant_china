import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  attachMyTicketFile,
  listMyTickets,
  listTicketCities,
  removeMyTicketFile,
  submitMyTicket,
  updateMyTicket,
  withdrawMyTicket,
  type StudentTicket,
  type StudentTicketPayload,
} from '../studentApi';
import { useStudentRealtime } from '../realtime';
import Icon from '../Icon';

type Props = {
  onToast: (kind: 'ok' | 'err', text: string) => void;
};

const STATUS_LABEL: Record<StudentTicket['status'], string> = {
  BOOKED: 'Забронирован',
  PURCHASED: 'Выкуплен',
  CHANGED: 'Изменён',
  CANCELLED: 'Отменён',
};

const OTHER_CITY = '__other__';

const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU') : '';

const fmtBytes = (b: number) => {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / 1024 / 1024).toFixed(2)} МБ`;
};

/** ISO → значение для <input type="datetime-local"> в ЛОКАЛЬНОМ времени браузера. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type FormState = {
  city: string;
  customCity: string;
  departureAt: string;
  arrivalAt: string;
  flightNumber: string;
  airline: string;
  status: 'BOOKED' | 'PURCHASED';
  comment: string;
  file: File | null;
};

const EMPTY_FORM: FormState = {
  city: '',
  customCity: '',
  departureAt: '',
  arrivalAt: '',
  flightNumber: '',
  airline: '',
  status: 'PURCHASED',
  comment: '',
  file: null,
};

const ALLOWED_FILE_RE = /\.(jpe?g|png|heic|heif|pdf)$/i;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * 26.08.2026 — «Мой билет» в личном кабинете.
 *
 * Студент подаёт данные рейса, менеджер проверяет и подтверждает (решение
 * заказчика: слова студента не попадают в рабочий список CRM, пока их не
 * проверили). Пока билет на проверке и менеджер его не трогал, студент
 * правит и отзывает его сам; один ожидающий билет за раз.
 *
 * Файл билета студенту обратно не показывается ссылкой: /uploads файлы
 * билетов студенту не отдаёт (STUDENT_RESTRICTED_DOC_TYPES). Показываем имя
 * и размер — что файл прикреплён и какой именно.
 */
export default function CabinetTickets({ onToast }: Props) {
  const [items, setItems] = useState<StudentTicket[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [cities, setCities] = useState<{ value: string; latin: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  const load = async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await listMyTickets();
      setItems(res.items);
      setPendingId(res.pendingId);
    } catch {
      /* кабинет уже показал бы 401 через /me */
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    load(true);
    listTicketCities().then(setCities).catch(() => setCities([]));
  }, []);

  // Менеджер принял/отклонил — студент видит это без перезагрузки страницы.
  useStudentRealtime({ 'ticket:updated': () => load() });

  const pending = items.find((t) => t.id === pendingId) ?? null;
  const others = items.filter((t) => t.id !== pendingId);

  const openCreate = (prefill?: StudentTicket) => {
    if (prefill) {
      const known = cities.some((c) => c.value === prefill.destinationCity);
      setForm({
        city: known ? prefill.destinationCity : OTHER_CITY,
        customCity: known ? '' : prefill.destinationCity,
        departureAt: toLocalInput(prefill.departureAt),
        arrivalAt: toLocalInput(prefill.arrivalAt),
        flightNumber: prefill.flightNumber,
        airline: prefill.airline ?? '',
        status: prefill.status === 'BOOKED' ? 'BOOKED' : 'PURCHASED',
        comment: prefill.comment ?? '',
        file: null,
      });
    } else {
      setForm({ ...EMPTY_FORM });
    }
    setEditingId(null);
  };

  const openEdit = (t: StudentTicket) => {
    const known = cities.some((c) => c.value === t.destinationCity);
    setForm({
      city: known ? t.destinationCity : OTHER_CITY,
      customCity: known ? '' : t.destinationCity,
      departureAt: toLocalInput(t.departureAt),
      arrivalAt: toLocalInput(t.arrivalAt),
      flightNumber: t.flightNumber,
      airline: t.airline ?? '',
      status: t.status === 'BOOKED' ? 'BOOKED' : 'PURCHASED',
      comment: t.comment ?? '',
      file: null,
    });
    setEditingId(t.id);
  };

  const closeForm = () => {
    setForm(null);
    setEditingId(null);
  };

  const validateFile = (file: File | null): string | null => {
    if (!file) return null;
    if (!ALLOWED_FILE_RE.test(file.name) && !/^(image\/|application\/pdf)/.test(file.type)) {
      return 'Файл билета — PDF или фото (JPG, PNG, HEIC)';
    }
    if (file.size > MAX_FILE_BYTES) return 'Файл больше 20 МБ';
    return null;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || saving) return;
    const city = (form.city === OTHER_CITY ? form.customCity : form.city).trim();
    if (city.length < 2) return onToast('err', 'Укажите город назначения');
    if (!form.departureAt) return onToast('err', 'Укажите дату и время вылета');
    if (form.flightNumber.trim().length < 2) return onToast('err', 'Укажите номер рейса');
    const departure = new Date(form.departureAt);
    const arrival = form.arrivalAt ? new Date(form.arrivalAt) : null;
    if (arrival && arrival.getTime() < departure.getTime()) {
      return onToast('err', 'Прилёт не может быть раньше вылета');
    }
    const fileError = validateFile(form.file);
    if (fileError) return onToast('err', fileError);

    const payload: StudentTicketPayload = {
      destinationCity: city,
      departureAt: departure.toISOString(),
      arrivalAt: arrival ? arrival.toISOString() : undefined,
      flightNumber: form.flightNumber.trim(),
      airline: form.airline.trim() || undefined,
      status: form.status,
      comment: form.comment.trim() || undefined,
    };

    setSaving(true);
    try {
      if (editingId) {
        // На PATCH пустая строка arrivalAt = «стереть дату прилёта».
        await updateMyTicket(editingId, { ...payload, arrivalAt: arrival ? arrival.toISOString() : '' });
        if (form.file) await attachMyTicketFile(editingId, form.file);
        onToast('ok', 'Изменения отправлены менеджеру');
      } else {
        await submitMyTicket(payload, form.file);
        onToast('ok', 'Билет отправлен менеджеру на проверку');
      }
      closeForm();
      await load();
    } catch (err: any) {
      onToast('err', err?.response?.data?.message || 'Не удалось сохранить билет');
    } finally {
      setSaving(false);
    }
  };

  const onWithdraw = async (t: StudentTicket) => {
    if (!confirm(`Отозвать билет ${t.flightNumber}? Менеджер перестанет его видеть.`)) return;
    setBusyId(t.id);
    try {
      await withdrawMyTicket(t.id);
      onToast('ok', 'Билет отозван');
      closeForm();
      await load();
    } catch (err: any) {
      onToast('err', err?.response?.data?.message || 'Не удалось отозвать билет');
    } finally {
      setBusyId(null);
    }
  };

  const onReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!file || !pending) return;
    const fileError = validateFile(file);
    if (fileError) return onToast('err', fileError);
    setBusyId(pending.id);
    try {
      await attachMyTicketFile(pending.id, file);
      onToast('ok', 'Файл билета прикреплён');
      await load();
    } catch (err: any) {
      onToast('err', err?.response?.data?.message || 'Не удалось загрузить файл');
    } finally {
      setBusyId(null);
    }
  };

  const onRemoveFile = async (t: StudentTicket) => {
    const doc = t.documents[0];
    if (!doc) return;
    if (!confirm('Удалить файл билета?')) return;
    setBusyId(t.id);
    try {
      await removeMyTicketFile(t.id, doc.id);
      onToast('ok', 'Файл удалён');
      await load();
    } catch (err: any) {
      onToast('err', err?.response?.data?.message || 'Не удалось удалить файл');
    } finally {
      setBusyId(null);
    }
  };

  const renderBadge = (t: StudentTicket) => {
    if (t.reviewStatus === 'PENDING') {
      return (
        <span className="stu-ticket-badge pending">
          <Icon name="schedule" size={14} /> На проверке у менеджера
        </span>
      );
    }
    if (t.reviewStatus === 'REJECTED') {
      return (
        <span className="stu-ticket-badge rejected">
          <Icon name="cancel" size={14} /> Отклонён
        </span>
      );
    }
    if (t.reviewStatus === 'APPROVED') {
      return (
        <span className="stu-ticket-badge approved">
          <Icon name="verified" size={14} /> Подтверждён менеджером
        </span>
      );
    }
    return (
      <span className="stu-ticket-badge manager">
        <Icon name="badge" size={14} /> Добавлен менеджером
      </span>
    );
  };

  const renderTicket = (t: StudentTicket, opts: { editable: boolean }) => {
    const doc = t.documents[0];
    const busy = busyId === t.id;
    const cancelled = t.status === 'CANCELLED';
    return (
      <motion.div
        key={t.id}
        className={`stu-ticket${t.reviewStatus === 'PENDING' ? ' is-pending' : ''}${cancelled ? ' is-cancelled' : ''}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="stu-ticket-head">
          <div className="stu-ticket-title">
            <Icon name="flight_takeoff" size={20} />
            <div>
              <div className="stu-ticket-route">
                {t.destinationCity} · рейс {t.flightNumber}
              </div>
              <div className="stu-ticket-sub">
                {t.airline ? `${t.airline} · ` : ''}
                {STATUS_LABEL[t.status]}
              </div>
            </div>
          </div>
          {renderBadge(t)}
        </div>

        <div className="stu-ticket-grid">
          <div>
            <span>Вылет</span>
            <b>{fmtDateTime(t.departureAt)}</b>
          </div>
          <div>
            <span>Прилёт</span>
            <b>{fmtDateTime(t.arrivalAt)}</b>
          </div>
          <div>
            <span>Файл билета</span>
            <b>
              {doc ? (
                <span title="Файл получен. Скачать его может менеджер">
                  <Icon name="description" size={14} /> {doc.originalName}{' '}
                  <span className="stu-ticket-muted">({fmtBytes(doc.size)})</span>
                </span>
              ) : (
                <span className="stu-ticket-muted">не прикреплён</span>
              )}
            </b>
          </div>
        </div>

        {t.comment && <div className="stu-ticket-comment">{t.comment}</div>}

        {t.reviewStatus === 'REJECTED' && (
          <div className="stu-ticket-reject">
            <Icon name="info" size={16} />
            <div>
              <b>Менеджер не подтвердил этот билет{t.reviewedAt ? ` (${fmtDate(t.reviewedAt)})` : ''}.</b>
              {t.reviewNote && <div>Причина: {t.reviewNote}</div>}
              <div className="stu-ticket-muted">Исправьте данные и подайте билет заново.</div>
            </div>
          </div>
        )}

        {t.reviewStatus === 'APPROVED' && t.reviewedAt && (
          <div className="stu-ticket-muted" style={{ marginTop: 6 }}>
            Подтверждено {fmtDate(t.reviewedAt)}. Изменить данные теперь может только менеджер.
          </div>
        )}

        {t.reviewStatus === 'PENDING' && t.staffEditedAt && (
          <div className="stu-ticket-muted" style={{ marginTop: 6 }}>
            Менеджер уже правил этот билет — дальнейшие изменения через него.
          </div>
        )}

        {opts.editable && (
          <div className="stu-ticket-actions">
            <button type="button" className="btn btn-outline btn-small" onClick={() => openEdit(t)} disabled={busy}>
              <Icon name="edit" size={14} /> Изменить
            </button>
            {doc ? (
              <>
                <button
                  type="button"
                  className="btn btn-outline btn-small"
                  onClick={() => replaceRef.current?.click()}
                  disabled={busy}
                >
                  <Icon name="upload" size={14} /> Заменить файл
                </button>
                <button type="button" className="btn btn-outline btn-small" onClick={() => onRemoveFile(t)} disabled={busy}>
                  <Icon name="delete" size={14} /> Удалить файл
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-outline btn-small"
                onClick={() => replaceRef.current?.click()}
                disabled={busy}
              >
                <Icon name="attach_file" size={14} /> Прикрепить файл
              </button>
            )}
            <button type="button" className="btn btn-danger btn-small" onClick={() => onWithdraw(t)} disabled={busy}>
              <Icon name="undo" size={14} /> Отозвать
            </button>
          </div>
        )}

        {t.reviewStatus === 'REJECTED' && !pending && !form && (
          <div className="stu-ticket-actions">
            <button type="button" className="btn btn-primary btn-small" onClick={() => openCreate(t)}>
              <Icon name="refresh" size={14} /> Подать заново
            </button>
          </div>
        )}
      </motion.div>
    );
  };

  return (
    <motion.section
      className="stu-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
    >
      <div className="stu-ticket-section-head">
        <h2 className="stu-section-title" style={{ marginBottom: 0 }}>Мой билет</h2>
        {!loading && !pending && !form && (
          <button type="button" className="btn btn-primary btn-small" onClick={() => openCreate()}>
            <Icon name="add" size={16} /> Добавить билет
          </button>
        )}
      </div>

      <div className="stu-note" style={{ marginTop: 14 }}>
        <Icon name="info" size={18} />
        <div>
          Купили билет в Китай? Добавьте данные рейса — менеджер проверит и подтвердит. Пока билет на проверке,
          его можно изменить или отозвать. Один билет на проверке за раз.
        </div>
      </div>

      {loading ? (
        <div className="stu-empty" style={{ marginTop: 14 }}>Загрузка...</div>
      ) : (
        <>
          {form && (
            <form className="stu-ticket-form" onSubmit={onSubmit}>
              <div className="stu-ticket-form-title">
                {editingId ? 'Изменить билет' : 'Новый билет'}
              </div>
              <div className="stu-form-grid">
                <label className="stu-field">
                  <span>Город назначения *</span>
                  <select value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required>
                    <option value="">Выберите город</option>
                    {cities.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.value} ({c.latin})
                      </option>
                    ))}
                    <option value={OTHER_CITY}>Другой город</option>
                  </select>
                </label>
                {form.city === OTHER_CITY && (
                  <label className="stu-field">
                    <span>Какой город? *</span>
                    <input
                      value={form.customCity}
                      onChange={(e) => setForm({ ...form, customCity: e.target.value })}
                      placeholder="Например, Чэнду"
                      maxLength={80}
                      required
                    />
                  </label>
                )}
                <label className="stu-field">
                  <span>Дата и время вылета *</span>
                  <input
                    type="datetime-local"
                    value={form.departureAt}
                    onChange={(e) => setForm({ ...form, departureAt: e.target.value })}
                    required
                  />
                </label>
                <label className="stu-field">
                  <span>Дата и время прилёта</span>
                  <input
                    type="datetime-local"
                    value={form.arrivalAt}
                    onChange={(e) => setForm({ ...form, arrivalAt: e.target.value })}
                  />
                </label>
                <label className="stu-field">
                  <span>Номер рейса *</span>
                  <input
                    value={form.flightNumber}
                    onChange={(e) => setForm({ ...form, flightNumber: e.target.value })}
                    placeholder="Например, CZ6052"
                    maxLength={20}
                    required
                  />
                </label>
                <label className="stu-field">
                  <span>Авиакомпания</span>
                  <input
                    value={form.airline}
                    onChange={(e) => setForm({ ...form, airline: e.target.value })}
                    placeholder="China Southern, Somon Air…"
                    maxLength={80}
                  />
                </label>
                <div className="stu-field">
                  <span>Билет</span>
                  <div className="stu-radio-row">
                    <label>
                      <input
                        type="radio"
                        name="ticket-status"
                        checked={form.status === 'PURCHASED'}
                        onChange={() => setForm({ ...form, status: 'PURCHASED' })}
                      />
                      Выкуплен
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="ticket-status"
                        checked={form.status === 'BOOKED'}
                        onChange={() => setForm({ ...form, status: 'BOOKED' })}
                      />
                      Только забронирован
                    </label>
                  </div>
                </div>
                <div className="stu-field">
                  <span>Файл билета (PDF или фото)</span>
                  <button
                    type="button"
                    className="btn btn-outline btn-small"
                    onClick={() => fileRef.current?.click()}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <Icon name="attach_file" size={14} />
                    {form.file ? form.file.name : editingId ? 'Заменить файл' : 'Выбрать файл'}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/*"
                    hidden
                    onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })}
                  />
                </div>
                <label className="stu-field stu-field-wide">
                  <span>Комментарий</span>
                  <textarea
                    value={form.comment}
                    onChange={(e) => setForm({ ...form, comment: e.target.value })}
                    placeholder="Багаж, пересадка, кто встречает…"
                    maxLength={2000}
                    rows={2}
                  />
                </label>
              </div>
              <div className="stu-ticket-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  <Icon name={saving ? 'progress_activity' : 'send'} size={16} />
                  {saving ? 'Отправка…' : editingId ? 'Сохранить изменения' : 'Отправить менеджеру'}
                </button>
                <button type="button" className="btn btn-outline" onClick={closeForm} disabled={saving}>
                  Отмена
                </button>
              </div>
            </form>
          )}

          {pending && !form && renderTicket(pending, { editable: !pending.staffEditedAt })}
          {pending && form && editingId === pending.id && null}

          {others.length > 0 && (
            <div className="stu-ticket-history">
              {pending || form ? <div className="stu-ticket-history-title">Предыдущие билеты</div> : null}
              {others.map((t) => renderTicket(t, { editable: false }))}
            </div>
          )}

          {!pending && !form && others.length === 0 && (
            <div className="stu-empty" style={{ marginTop: 14 }}>
              Билетов пока нет. Как только купите — добавьте его здесь.
            </div>
          )}
        </>
      )}

      <input
        ref={replaceRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/*"
        hidden
        onChange={onReplaceFile}
      />
    </motion.section>
  );
}
