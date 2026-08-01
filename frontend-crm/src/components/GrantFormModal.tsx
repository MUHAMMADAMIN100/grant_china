import { useState } from 'react';
import { motion } from 'framer-motion';
import { GRANT_STATUS_LABEL, createGrant, updateGrant, type GrantStatus, type StudentGrant } from '../api/grants';
import { useUI } from '../ui/Dialogs';
import { hasErrors, maxLen, validateAll } from '../utils/validators';
// Правило «календарная дата по Душанбе -> <input type="date">» живёт в одном
// месте: локальная копия уже разъезжалась с PayrollRules (см. utils/datetime.ts).
import { toDateInputValue } from '../utils/datetime';
import Icon from '../Icon';

type Props = {
  studentId: string;
  /** Если передан — форма в режиме редактирования уже существующего гранта. */
  grant?: StudentGrant | null;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * ТЗ 4 — создание/правка записи реестра грантов. Год обучения двигается
 * ТОЛЬКО через отдельное действие «Перевести на следующий год» (GrantCard),
 * здесь его можно поправить руками лишь как исправление ошибки ввода.
 */
export default function GrantFormModal({ studentId, grant, onClose, onSaved }: Props) {
  const { toast } = useUI();
  const isEdit = !!grant;

  const [name, setName] = useState(grant?.name ?? '');
  const [university, setUniversity] = useState(grant?.university ?? '');
  const [totalYears, setTotalYears] = useState(String(grant?.totalYears ?? 4));
  const [currentYear, setCurrentYear] = useState(String(grant?.currentYear ?? 1));
  const [startDate, setStartDate] = useState(toDateInputValue(grant?.startDate));
  const [nextYearStartsAt, setNextYearStartsAt] = useState(toDateInputValue(grant?.nextYearStartsAt));
  const [status, setStatus] = useState<GrantStatus>(grant?.status ?? 'ACTIVE');
  const [note, setNote] = useState(grant?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const formErrors = validateAll(
    { name, university, note },
    {
      name: maxLen(200),
      university: maxLen(200),
      note: maxLen(2000),
    },
  );
  const totalYearsNum = Number(totalYears);
  const currentYearNum = Number(currentYear);
  const yearsInvalid =
    !Number.isInteger(totalYearsNum) || totalYearsNum < 1 || totalYearsNum > 8 ||
    !Number.isInteger(currentYearNum) || currentYearNum < 1 || currentYearNum > 8 ||
    currentYearNum > totalYearsNum;
  const startDateInvalid = !startDate;
  const formInvalid = hasErrors(formErrors) || yearsInvalid || startDateInvalid;

  const onSubmit = async () => {
    setTouched(true);
    if (formInvalid) {
      toast('Проверьте поля формы — текущий год не может быть больше общего количества лет', 'error');
      return;
    }
    setSaving(true);
    try {
      if (isEdit && grant) {
        // Пустые строки отправляем КАК ЕСТЬ: `|| undefined` axios не
        // сериализует, бэкенд обновляет поле только при dto.name !== undefined —
        // очистка названия, вуза или заметки молча не сохранялась, а форма
        // при этом рапортовала об успехе. Пустая строка проходит валидацию и
        // превращается на бэкенде в null.
        await updateGrant(grant.id, {
          name: name.trim(),
          university: university.trim(),
          totalYears: totalYearsNum,
          currentYear: currentYearNum,
          startDate,
          nextYearStartsAt: nextYearStartsAt || null,
          status,
          note: note.trim(),
        });
        toast('Грант обновлён', 'success');
      } else {
        await createGrant({
          studentId,
          name: name.trim() || undefined,
          university: university.trim() || undefined,
          totalYears: totalYearsNum,
          currentYear: currentYearNum,
          startDate,
          nextYearStartsAt: nextYearStartsAt || undefined,
          note: note.trim() || undefined,
        });
        toast('Грант добавлен в реестр', 'success');
      }
      onSaved();
      onClose();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка сохранения гранта', 'error');
    } finally {
      setSaving(false);
    }
  };

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
            {isEdit ? 'Редактирование гранта' : 'Добавить грант'}
          </div>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label>Название гранта</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="Например, CSC Type A"
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label>Вуз</label>
            <input
              value={university}
              onChange={(e) => setUniversity(e.target.value)}
              maxLength={200}
              disabled={saving}
            />
          </div>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label>Всего лет по гранту *</label>
            <input
              type="number"
              min={1}
              max={8}
              value={totalYears}
              onChange={(e) => setTotalYears(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={() => setTouched(true)}
              className={touched && yearsInvalid ? 'input-error' : ''}
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label>Текущий год обучения *</label>
            <input
              type="number"
              min={1}
              max={8}
              value={currentYear}
              onChange={(e) => setCurrentYear(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={() => setTouched(true)}
              className={touched && yearsInvalid ? 'input-error' : ''}
              disabled={saving}
            />
          </div>
        </div>
        {touched && yearsInvalid && (
          <div className="form-error-text" style={{ marginTop: -10, marginBottom: 12 }}>
            Текущий год не может быть больше общего количества лет (1–8)
          </div>
        )}

        <div className="form-grid-2">
          <div className="form-group">
            <label>Начало обучения *</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              onBlur={() => setTouched(true)}
              className={touched && startDateInvalid ? 'input-error' : ''}
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label>Начало следующего учебного года</label>
            <input
              type="date"
              value={nextYearStartsAt}
              onChange={(e) => setNextYearStartsAt(e.target.value)}
              disabled={saving || currentYearNum >= totalYearsNum || status !== 'ACTIVE'}
            />
          </div>
        </div>
        <div className="receipt-dropzone-hint" style={{ marginTop: -10, marginBottom: 14 }}>
          Обычно 1 сентября; для февральского набора укажите фактическую дату. Если не заполнить —
          дата встанет автоматически на год позже начала обучения.
        </div>

        {isEdit && (
          <div className="form-group">
            <label>Статус гранта</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as GrantStatus)} disabled={saving}>
              {Object.entries(GRANT_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {status !== 'ACTIVE' && (
              <div className="receipt-dropzone-hint">
                Автоматическое напоминание менеджеру о начале нового учебного года приходит только для грантов в статусе «Действует».
              </div>
            )}
          </div>
        )}

        <div className="form-group">
          <label>Заметка</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            placeholder="Условия продления, договорённости с вузом..."
            disabled={saving}
          />
        </div>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={saving}>
            {saving ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Добавить'}
            {!saving && <Icon name="check" size={16} style={{ marginLeft: 4 }} />}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
