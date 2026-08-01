import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  TICKET_STATUS_LABEL,
  TICKET_STATUS_OPTIONS,
  createTicket,
  listChinaCities,
  updateTicket,
  type ChinaCity,
  type Ticket,
  type TicketStatus,
} from '../api/tickets';
import { listStudents } from '../api/students';
import type { Student } from '../api/types';
import { useUI } from '../ui/Dialogs';
import { toDatetimeLocalValue } from '../utils/datetime';
import Icon from '../Icon';

type Props = {
  /** Заполнено — режим редактирования. */
  ticket?: Ticket | null;
  /** Предвыбранный студент (когда форма открыта из карточки студента). */
  studentId?: string;
  studentName?: string;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Подпись варианта автокомплита. Если почты нет — показываем телефон: двух
 * однофамильцев без email иначе не отличить друг от друга ни глазами, ни
 * кодом, и билет уходил бы первому попавшемуся из списка.
 */
const studentOptionLabel = (s: Student): string => {
  const hint = s.email?.trim() || s.phones?.[0]?.trim() || '';
  return hint ? `${s.fullName} · ${hint}` : s.fullName;
};

/**
 * ТЗ «Билеты», п.4.3 — карточка создания/редактирования билета.
 * «При вводе ФИО студента должен работать автокомплит по существующей базе CRM».
 *
 * Автокомплит сделан на нативном <datalist>, а не на самописном выпадающем
 * списке: он бесплатно даёт клавиатурную навигацию, поиск по подстроке и
 * корректное поведение на мобильном — а это раздел, в который заходят с
 * телефона прямо из аэропорта.
 */
export default function TicketFormModal({ ticket, studentId, studentName, onClose, onSaved }: Props) {
  const { toast } = useUI();
  const isEdit = Boolean(ticket);

  const [cities, setCities] = useState<ChinaCity[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentQuery, setStudentQuery] = useState(studentName ?? ticket?.student?.fullName ?? '');
  const [selectedStudentId, setSelectedStudentId] = useState(studentId ?? ticket?.studentId ?? '');

  const [destinationCity, setDestinationCity] = useState(ticket?.destinationCity ?? '');
  const [departureAt, setDepartureAt] = useState(toDatetimeLocalValue(ticket?.departureAt));
  const [arrivalAt, setArrivalAt] = useState(toDatetimeLocalValue(ticket?.arrivalAt));
  const [flightNumber, setFlightNumber] = useState(ticket?.flightNumber ?? '');
  const [airline, setAirline] = useState(ticket?.airline ?? '');
  const [status, setStatus] = useState<TicketStatus>(ticket?.status ?? 'BOOKED');
  const [comment, setComment] = useState(ticket?.comment ?? '');
  const [file, setFile] = useState<File | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Текст, который в поле подставил сам datalist при выборе варианта. */
  const pickedLabelRef = useRef<string | null>(null);

  useEffect(() => {
    listChinaCities().then(setCities).catch(() => setCities([]));
  }, []);

  // Автокомплит по студентам. Запрос уходит с задержкой и только когда
  // введено хотя бы два символа — иначе каждый нажатый символ бил бы в API.
  useEffect(() => {
    if (isEdit || studentId) return;
    // ВАЖНО: по подставленной datalist подписи «ФИО · email» не ищем. Бэкенд
    // ищет по fullName contains / email contains, такой подстроки нет ни в
    // имени, ни в почте — ответ приходил пустой, затирал список вариантов, а
    // вместе с ним и выбранного студента: кнопка «Добавить билет» оставалась
    // заблокированной навсегда.
    if (studentQuery === pickedLabelRef.current) return;
    const q = studentQuery.trim();
    if (q.length < 2) {
      setStudents([]);
      return;
    }
    const t = setTimeout(() => {
      listStudents({ search: q })
        .then((res) => setStudents(Array.isArray(res) ? res.slice(0, 20) : []))
        .catch(() => setStudents([]));
    }, 300);
    return () => clearTimeout(t);
  }, [studentQuery, isEdit, studentId]);

  /**
   * Пересопоставление ПОСЛЕ прихода списка студентов.
   *
   * Без этого форма не работала даже с корректным вводом: поиск уходит с
   * задержкой 300 мс, а сопоставление выполняется в onChange — то есть по
   * списку, которого на тот момент ещё нет. Менеджер дописывает ФИО целиком,
   * список приезжает через треть секунды, но onChange больше не вызывается, и
   * selectedStudentId навсегда остаётся пустым. Кнопка «Добавить билет»
   * заблокирована при полностью заполненной форме — ровно то, с чем пришёл
   * пользователь.
   *
   * Ставим id только когда он ещё не выбран: если выбор уже сделан, повторное
   * обновление списка не должно его трогать.
   */
  useEffect(() => {
    if (isEdit || studentId) return;
    if (selectedStudentId) return;
    if (!students.length) return;
    const id = resolveStudentId(studentQuery);
    if (id) {
      pickedLabelRef.current = studentQuery;
      setSelectedStudentId(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students]);

  /**
   * Выбор из datalist приходит тем же onChange, что и ручной ввод, поэтому
   * различаем их по содержимому поля. Id проставляется здесь, в момент выбора,
   * и НЕ пересчитывается из текста поля на каждый ответ API — иначе он терялся
   * бы при любом обновлении списка.
   *
   * СОПОСТАВЛЯЕМ ДВУМЯ СПОСОБАМИ, а не только по полной подписи «ФИО · почта».
   * Раньше засчитывалось лишь точное совпадение с подписью, и форма вставала
   * намертво в самом обычном сценарии: менеджер печатает «Иванов Иван», видит
   * подсказку браузера, но не кликает по ней (или дописывает имя руками до
   * конца) — текст в поле остаётся без хвоста « · почта», совпадения нет,
   * selectedStudentId пустой, кнопка «Добавить билет» заблокирована, а
   * подпись «Выберите студента из списка» не объясняет, что кликнуть надо
   * именно по варианту.
   *
   * Совпадение по одному ФИО засчитываем ТОЛЬКО когда однофамилец ровно один.
   * Если их несколько — id не ставим: билет не должен уехать наугад первому
   * попавшемуся (ровно ради этого в подписи и появился хвост с почтой).
   */
  const resolveStudentId = (value: string): string => {
    const v = value.trim().toLowerCase();
    if (!v) return '';
    // 1. Точное совпадение с подписью варианта — клик по datalist.
    const byLabel = students.find((s) => studentOptionLabel(s).toLowerCase() === v);
    if (byLabel) return byLabel.id;
    // 2. Точное совпадение по ФИО — набрано руками. Только если однозначно.
    const byName = students.filter((s) => s.fullName.trim().toLowerCase() === v);
    if (byName.length === 1) return byName[0].id;
    return '';
  };

  const onStudentQueryChange = (value: string) => {
    setStudentQuery(value);
    const id = resolveStudentId(value);
    pickedLabelRef.current = id ? value : null;
    setSelectedStudentId(id);
  };

  const canSubmit = useMemo(() => {
    if (!destinationCity.trim() || !departureAt || !flightNumber.trim()) return false;
    if (!isEdit && !selectedStudentId) return false;
    return true;
  }, [destinationCity, departureAt, flightNumber, isEdit, selectedStudentId]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || saving) return;
    setError(null);
    setSaving(true);
    try {
      if (isEdit && ticket) {
        await updateTicket(ticket.id, {
          destinationCity: destinationCity.trim(),
          departureAt: new Date(departureAt).toISOString(),
          // Пустая строка = стереть дату прилёта (договорённость с бэкендом).
          arrivalAt: arrivalAt ? new Date(arrivalAt).toISOString() : '',
          flightNumber: flightNumber.trim(),
          airline: airline.trim(),
          status,
          comment: comment.trim(),
        });
        toast('Билет обновлён', 'success');
      } else {
        await createTicket(
          {
            studentId: selectedStudentId,
            destinationCity: destinationCity.trim(),
            departureAt: new Date(departureAt).toISOString(),
            arrivalAt: arrivalAt ? new Date(arrivalAt).toISOString() : undefined,
            flightNumber: flightNumber.trim(),
            airline: airline.trim() || undefined,
            status,
            comment: comment.trim() || undefined,
          },
          file,
        );
        toast('Билет добавлен', 'success');
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message?.toString() || 'Не удалось сохранить билет');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="dialog-card"
        style={{ maxWidth: 640, textAlign: 'left' }}
        initial={{ opacity: 0, scale: 0.94, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={{ duration: 0.2 }}
      >
        <div className="dialog-title" style={{ textAlign: 'left' }}>
          {isEdit ? 'Редактировать билет' : 'Новый билет'}
        </div>

        <form onSubmit={onSubmit}>
          {error && <div className="error-banner">{error}</div>}

          {!isEdit && !studentId && (
            <div className="form-group">
              <label>Студент *</label>
              <input
                list="ticket-student-options"
                value={studentQuery}
                onChange={(e) => onStudentQueryChange(e.target.value)}
                placeholder="Начните вводить ФИО..."
                autoFocus
              />
              <datalist id="ticket-student-options">
                {students.map((s) => (
                  <option key={s.id} value={studentOptionLabel(s)} />
                ))}
              </datalist>
              {/* Найденные варианты кнопками, а не только нативным datalist.
                  Подсказка браузера показывается не всегда (её легко закрыть
                  Escape'ом, на мобильном она ведёт себя иначе), и тогда
                  единственным сигналом оставалась красная строка «выберите из
                  списка» — из которой непонятно, где этот список и почему
                  набранное вручную ФИО не подходит. Клик по кнопке ставит id
                  напрямую, минуя любое сопоставление по тексту. */}
              {!selectedStudentId && students.length > 0 && (
                <div className="student-suggestions">
                  {students.slice(0, 6).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        const label = studentOptionLabel(s);
                        setStudentQuery(label);
                        pickedLabelRef.current = label;
                        setSelectedStudentId(s.id);
                      }}
                    >
                      {studentOptionLabel(s)}
                    </button>
                  ))}
                </div>
              )}
              {selectedStudentId && (
                <div className="form-hint-ok">
                  <Icon name="check_circle" size={14} /> Студент выбран
                </div>
              )}
              {studentQuery.trim().length >= 2 && !selectedStudentId && students.length === 0 && (
                <div className="form-error-text">Студент не найден — проверьте написание ФИО</div>
              )}
            </div>
          )}
          {(isEdit || studentId) && (
            <div className="form-group">
              <label>Студент</label>
              <input value={studentName ?? ticket?.student?.fullName ?? ''} disabled />
            </div>
          )}

          <div className="form-grid-2">
            <div className="form-group">
              <label>Город назначения *</label>
              <input
                list="ticket-city-options"
                value={destinationCity}
                onChange={(e) => setDestinationCity(e.target.value)}
                placeholder="Пекин"
                maxLength={80}
              />
              <datalist id="ticket-city-options">
                {cities.map((c) => (
                  <option key={c.value} value={c.value}>{c.latin}</option>
                ))}
              </datalist>
            </div>
            <div className="form-group">
              <label>Номер рейса *</label>
              <input
                value={flightNumber}
                onChange={(e) => setFlightNumber(e.target.value)}
                placeholder="SU-208"
                maxLength={20}
              />
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label>Вылет *</label>
              <input type="datetime-local" value={departureAt} onChange={(e) => setDepartureAt(e.target.value)} />
            </div>
            <div className="form-group">
              <label>
                Прилёт{' '}
                <span style={{ fontWeight: 400, color: 'var(--text-soft)', fontSize: 12 }}>— для контроля стыковок</span>
              </label>
              <input type="datetime-local" value={arrivalAt} onChange={(e) => setArrivalAt(e.target.value)} />
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label>Авиакомпания</label>
              <input
                value={airline}
                onChange={(e) => setAirline(e.target.value)}
                placeholder="China Southern"
                maxLength={80}
              />
            </div>
            <div className="form-group">
              <label>Статус</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus)}>
                {TICKET_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{TICKET_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>
              Комментарий{' '}
              <span style={{ fontWeight: 400, color: 'var(--text-soft)', fontSize: 12 }}>
                — багаж, встреча в аэропорту и т.п.
              </span>
            </label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={2} />
          </div>

          {!isEdit && (
            <div className="form-group">
              <label>
                Файл билета{' '}
                <span style={{ fontWeight: 400, color: 'var(--text-soft)', fontSize: 12 }}>
                  — PDF или фото, до 20 МБ
                </span>
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file && (
                <div className="receipt-dropzone-hint" style={{ margin: '6px 0 0' }}>
                  <Icon name="attach_file" size={14} /> {file.name}
                </div>
              )}
            </div>
          )}
          {isEdit && (
            <div className="receipt-dropzone-hint">
              Файл билета прикрепляется и удаляется кнопками в списке билетов — здесь только данные рейса.
            </div>
          )}

          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit || saving}>
              {saving ? 'Сохраняем...' : isEdit ? 'Сохранить' : 'Добавить билет'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
