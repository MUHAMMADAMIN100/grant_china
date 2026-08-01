import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { Consultation, ConsultationKind, ConsultationOutcome, Direction, User } from '../api/types';
import {
  CONSULTATION_KIND_LABEL,
  CONSULTATION_OUTCOME_LABEL,
  LEAD_SOURCES,
  ROLE_LABEL,
  isPrivileged,
} from '../api/types';
import {
  convertConsultation,
  createConsultation,
  deleteConsultation,
  updateConsultation,
  type ConsultationPayload,
  type UpdateConsultationPayload,
} from '../api/consultations';
import { listUsers } from '../api/users';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { formatDateTimeRu, toDatetimeLocalValue } from '../utils/datetime';
import { compose, hasErrors, maxLen, minLen, phoneRule, required, validateAll } from '../utils/validators';
import DirectionOptions from '../components/DirectionOptions';
import PhoneInput from '../components/PhoneInput';
import Icon from '../Icon';
import { todayInputValue } from '../utils/datetime';

// Локальная дата, а не UTC: в Душанбе до 05:00 toISOString() подставил бы в
// heldAt вчерашний день, и консультация ушла бы в предыдущий расчётный период
// (KPI считает consultationsHeld по этой дате).
const todayStr = todayInputValue;

type Props = {
  /** Если передан — форма в режиме редактирования уже существующей консультации. */
  consultation?: Consultation | null;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * ТЗ 3.2 — фиксация очной консультации/собеседования. Обязательные поля:
 * ФИО, телефон, цель обращения. При заполнении «Дата и время повторного
 * звонка» бэкенд СИНХРОННО создаёт задачу через TasksService.createSystemTask —
 * форма явно показывает это до и после сохранения, иначе менеджер решит,
 * что автоматика не сработала, и заведёт задачу вручную ещё раз.
 */
export default function ConsultationFormModal({ consultation, onClose, onSaved }: Props) {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const isEdit = !!consultation;
  const isAdmin = isPrivileged(me?.role);

  const [fullName, setFullName] = useState(consultation?.fullName ?? '');
  const [phone, setPhone] = useState(consultation?.phone ?? '');
  const [kind, setKind] = useState<ConsultationKind>(consultation?.kind ?? 'CONSULTATION');
  const [purpose, setPurpose] = useState(consultation?.purpose ?? '');
  const [source, setSource] = useState(consultation?.source ?? '');
  const [direction, setDirection] = useState<Direction | ''>(consultation?.direction ?? '');
  const [heldAt, setHeldAt] = useState(consultation ? consultation.heldAt.slice(0, 10) : todayStr());
  const [managerId, setManagerId] = useState(consultation?.managerId ?? me?.id ?? '');
  const initialFollowUpLocal = toDatetimeLocalValue(consultation?.followUpAt);
  const [followUpLocal, setFollowUpLocal] = useState(initialFollowUpLocal);
  const [comment, setComment] = useState(consultation?.comment ?? '');
  const [outcome, setOutcome] = useState<ConsultationOutcome | ''>(consultation?.outcome ?? '');
  const [users, setUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (isAdmin) listUsers().then(setUsers).catch(() => {});
  }, [isAdmin]);

  const formErrors = validateAll(
    { fullName, phone, purpose },
    {
      fullName: compose(required('Введите ФИО'), minLen(2, 'Минимум 2 символа'), maxLen(120)),
      phone: compose(required('Введите телефон'), phoneRule()),
      purpose: compose(required('Укажите цель обращения'), maxLen(2000)),
    },
  );
  const formInvalid = hasErrors(formErrors);

  const assignedManagerName = isAdmin
    ? users.find((u) => u.id === managerId)?.fullName || (managerId === me?.id ? me?.fullName : '') || ''
    : me?.fullName || '';

  const followUpChanged = followUpLocal !== initialFollowUpLocal;
  const followUpIsoForHint = followUpLocal ? new Date(followUpLocal).toISOString() : null;

  const onSubmit = async () => {
    setTouched(true);
    if (formInvalid) {
      toast('Заполните обязательные поля корректно', 'error');
      return;
    }
    setSaving(true);
    try {
      if (isEdit && consultation) {
        const payload: UpdateConsultationPayload = {
          fullName: fullName.trim(),
          phone: phone.trim(),
          kind,
          purpose: purpose.trim(),
          source: source || undefined,
          direction: direction || undefined,
          comment: comment.trim() || undefined,
          heldAt: heldAt || undefined,
          outcome: outcome || undefined,
        };
        if (isAdmin && managerId && managerId !== consultation.managerId) payload.managerId = managerId;
        if (followUpChanged) {
          payload.followUpAt = followUpLocal ? new Date(followUpLocal).toISOString() : null;
        }
        await updateConsultation(consultation.id, payload);
        if (followUpChanged && followUpIsoForHint) {
          toast(`Изменения сохранены. Повторный звонок: ${formatDateTimeRu(followUpIsoForHint)}`, 'success');
        } else if (followUpChanged) {
          toast('Изменения сохранены. Повторный звонок отменён.', 'success');
        } else {
          toast('Изменения сохранены', 'success');
        }
      } else {
        const payload: ConsultationPayload = {
          fullName: fullName.trim(),
          phone: phone.trim(),
          purpose: purpose.trim(),
          kind,
          source: source || undefined,
          direction: direction || undefined,
          comment: comment.trim() || undefined,
          heldAt: heldAt || undefined,
          followUpAt: followUpIsoForHint || undefined,
        };
        if (isAdmin && managerId) payload.managerId = managerId;
        await createConsultation(payload);
        if (followUpIsoForHint) {
          toast(
            `Консультация записана. Создана задача: повторный звонок ${formatDateTimeRu(followUpIsoForHint)} для ${assignedManagerName || 'ответственного менеджера'}`,
            'success',
          );
        } else {
          toast('Консультация записана', 'success');
        }
      }
      onSaved();
      onClose();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка сохранения', 'error');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!consultation) return;
    const ok = await confirm({
      title: 'Удалить консультацию',
      message: `Запись «${consultation.fullName}» будет удалена. Связанная задача на повторный звонок снимется, если она ещё не взята в работу.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await deleteConsultation(consultation.id);
      toast('Консультация удалена', 'success');
      onSaved();
      onClose();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка удаления', 'error');
    } finally {
      setSaving(false);
    }
  };

  const onConvert = async () => {
    if (!consultation) return;
    setSaving(true);
    try {
      await convertConsultation(consultation.id);
      toast('Заявка создана из консультации', 'success');
      onSaved();
      onClose();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка создания заявки', 'error');
    } finally {
      setSaving(false);
    }
  };

  const busy = saving;
  // Конвертация читает данные консультации ИЗ БД (не из черновика формы) —
  // если в форме есть несохранённые правки (в первую очередь направление —
  // без него backend отклонит конвертацию), «Создать заявку» должна увести
  // именно на сохранённые данные, а не молча проигнорировать черновик.
  const isDirty =
    isEdit && !!consultation && (
      fullName.trim() !== consultation.fullName ||
      phone.trim() !== consultation.phone ||
      kind !== consultation.kind ||
      purpose.trim() !== consultation.purpose ||
      (source || null) !== consultation.source ||
      (direction || null) !== consultation.direction ||
      (comment.trim() || null) !== consultation.comment ||
      heldAt !== consultation.heldAt.slice(0, 10) ||
      (outcome || null) !== consultation.outcome ||
      followUpChanged ||
      (isAdmin && managerId !== consultation.managerId)
    );
  const canConvert = isEdit && !consultation?.applicationId;
  const convertBlockedReason = !consultation?.direction
    ? 'Сначала укажите и сохраните направление'
    : isDirty
      ? 'Сначала сохраните изменения'
      : undefined;

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="dialog-card payment-form-card"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="payment-form-header">
          <div className="dialog-title" style={{ marginBottom: 2 }}>
            {isEdit ? 'Редактирование консультации' : 'Запись консультации / собеседования'}
          </div>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label>ФИО *</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              onBlur={() => setTouched(true)}
              maxLength={120}
              className={touched && formErrors.fullName ? 'input-error' : ''}
              disabled={busy}
            />
            {touched && formErrors.fullName && <div className="form-error-text">{formErrors.fullName}</div>}
          </div>
          <div className="form-group">
            <label>Телефон *</label>
            <PhoneInput value={phone} onChange={setPhone} error={touched && !!formErrors.phone} disabled={busy} />
            {touched && formErrors.phone && <div className="form-error-text">{formErrors.phone}</div>}
          </div>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label>Тип</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as ConsultationKind)} disabled={busy}>
              {Object.entries(CONSULTATION_KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Дата проведения</label>
            <input type="date" value={heldAt} onChange={(e) => setHeldAt(e.target.value)} disabled={busy} />
          </div>
        </div>

        <div className="form-group">
          <label>Цель обращения *</label>
          <textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            onBlur={() => setTouched(true)}
            maxLength={2000}
            rows={3}
            className={touched && formErrors.purpose ? 'input-error' : ''}
            disabled={busy}
            placeholder="Что интересует клиента — как он сам это сформулировал"
          />
          {touched && formErrors.purpose && <div className="form-error-text">{formErrors.purpose}</div>}
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label>Источник привлечения</label>
            <select value={source} onChange={(e) => setSource(e.target.value)} disabled={busy}>
              <option value="">Не указан</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Направление</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as Direction | '')} disabled={busy}>
              <option value="">Не выбрано</option>
              <DirectionOptions />
            </select>
          </div>
        </div>

        {isAdmin && (
          <div className="form-group">
            <label>Ответственный менеджер</label>
            <select value={managerId} onChange={(e) => setManagerId(e.target.value)} disabled={busy}>
              <option value={me?.id}>{me?.fullName} (вы)</option>
              {users.filter((u) => u.id !== me?.id).map((u) => (
                <option key={u.id} value={u.id}>{u.fullName} ({ROLE_LABEL[u.role] || u.role})</option>
              ))}
            </select>
          </div>
        )}

        <div className="form-group">
          <label>Дата и время повторного звонка</label>
          <input
            type="datetime-local"
            value={followUpLocal}
            onChange={(e) => setFollowUpLocal(e.target.value)}
            disabled={busy}
          />
          <div className="receipt-dropzone-hint">
            Время местное (Душанбе). {followUpLocal
              ? `Будет создана задача для ${assignedManagerName || 'ответственного менеджера'}: повторный звонок ${followUpIsoForHint ? formatDateTimeRu(followUpIsoForHint) : ''}.`
              : 'Если не заполнить — задача не создастся.'}
          </div>
        </div>

        {isEdit && (
          <div className="form-group">
            <label>Результат (решение клиента)</label>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as ConsultationOutcome | '')} disabled={busy}>
              <option value="">Не зафиксирован</option>
              {Object.entries(CONSULTATION_OUTCOME_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        )}

        <div className="form-group">
          <label>Комментарий</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} disabled={busy} />
        </div>

        {isEdit && consultation?.applicationId && (
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              background: 'var(--info-soft)',
              color: 'var(--info)',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 13,
              lineHeight: 1.45,
              marginBottom: 14,
            }}
          >
            <Icon name="assignment_turned_in" size={18} />
            <div>Из этой консультации уже создана заявка.</div>
          </div>
        )}

        <div className="dialog-actions" style={{ flexWrap: 'wrap' }}>
          {isEdit && (
            <button className="btn btn-danger" onClick={onDelete} disabled={busy} style={{ marginRight: 'auto' }}>
              Удалить
            </button>
          )}
          {canConvert && (
            <button
              className="btn btn-secondary"
              onClick={onConvert}
              disabled={busy || !!convertBlockedReason}
              title={convertBlockedReason}
            >
              Создать заявку
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Отмена</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={busy}>
            {busy ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Записать'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
