import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLeadSources, useLeadSourcesStore } from '../store/leadSources';
import { useUI } from '../ui/Dialogs';
import Icon from '../Icon';

/** Служебное значение пункта «Другое…» — в базу не попадает, только открывает окно. */
const OTHER_SENTINEL = '__other__';

type Props = {
  value: string;
  onChange: (code: string) => void;
  /**
   * 'form' — выбор источника для записи: «Не указан» + справочник + «Другое…».
   * 'filter' — фильтр списка: «Все источники», «Не указан», справочник,
   * «Без названия» (старые заявки с безымянным «Другое») + «Другое…».
   */
  variant?: 'form' | 'filter';
  disabled?: boolean;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-testid'?: string;
};

/**
 * 08.09.2026 — выбор источника привлечения со своим справочником.
 *
 * Пункт «Другое…» больше не значение, а действие: открывается окно с
 * названием, источник сохраняется в общий справочник и сразу выбирается.
 * Безымянное «Другое» выбрать нельзя — оно обнуляло отчёт по каналам:
 * всё, чего не было в списке, сливалось в одну строку. Старые заявки с
 * таким значением остаются как есть и в фильтре отбираются пунктом
 * «Без названия».
 *
 * Скрытые руководством источники в выборе не показываются, кроме одного
 * случая: он уже стоит у этой записи — тогда он виден с пометкой, чтобы
 * форма не «теряла» значение при пересохранении.
 */
export default function LeadSourceSelect({ value, onChange, variant = 'form', disabled, title, className, style, ...rest }: Props) {
  const items = useLeadSources();
  const [adding, setAdding] = useState(false);

  const visible = items.filter((i) => i.code !== 'OTHER' && (!i.hidden || i.code === value || (variant === 'filter' && i.applications + i.consultations > 0)));
  const builtin = visible.filter((i) => i.builtin);
  const custom = visible.filter((i) => !i.builtin);

  const onSelect = (v: string) => {
    if (v === OTHER_SENTINEL) {
      setAdding(true);
      return;
    }
    onChange(v);
  };

  return (
    <>
      <select value={value} onChange={(e) => onSelect(e.target.value)} disabled={disabled} title={title} className={className} style={style} data-testid={rest['data-testid']}>
        {variant === 'filter' ? (
          <>
            <option value="">Все источники</option>
            <option value="NONE">Не указан</option>
          </>
        ) : (
          <option value="">Не указан</option>
        )}
        {builtin.map((s) => (
          <option key={s.code} value={s.code}>{s.label}</option>
        ))}
        {custom.length > 0 && (
          <optgroup label="Добавленные сотрудниками">
            {custom.map((s) => (
              <option key={s.code} value={s.code}>{s.label}{s.hidden ? ' (скрыт)' : ''}</option>
            ))}
          </optgroup>
        )}
        {variant === 'filter' && <option value="OTHER">Без названия (старое «Другое»)</option>}
        {variant === 'form' && value === 'OTHER' && <option value="OTHER">Другое (без названия)</option>}
        <option value={OTHER_SENTINEL}>Другое… (добавить свой источник)</option>
      </select>
      <AnimatePresence>
        {adding && (
          <NewLeadSourceModal
            onClose={() => setAdding(false)}
            onCreated={(code) => {
              setAdding(false);
              onChange(code);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export function NewLeadSourceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const add = useLeadSourcesStore((s) => s.add);
  const { toast } = useUI();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const trimmed = label.trim().replace(/\s+/g, ' ');
  const valid = trimmed.length >= 2 && trimmed.length <= 60;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await add(trimmed);
      toast(res.created ? `Источник «${res.item.label}» добавлен` : `Источник «${res.item.label}» уже есть — выбран он`, 'success');
      onCreated(res.item.code);
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Не удалось добавить источник');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={busy ? undefined : onClose}>
      <motion.div
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label="Новый источник привлечения"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        data-testid="new-lead-source-modal"
      >
        <div className="dialog-icon" style={{ background: '#fff0f0', color: 'var(--primary)' }}>
          <Icon name="add_circle" size={28} />
        </div>
        <div className="dialog-title">Новый источник привлечения</div>
        <div className="dialog-message" style={{ marginBottom: 12 }}>
          Название появится в списке у всех сотрудников, по нему можно будет отбирать заявки. Если такое уже есть — будет выбрано существующее.
        </div>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <input
            ref={inputRef}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
            maxLength={60}
            placeholder="Например: Ярмарка вузов, Партнёр-школа №5, блогер @name"
            disabled={busy}
            data-testid="new-lead-source-input"
          />
          {error && <div className="form-error-text">{error}</div>}
          {!error && label && !valid && <div className="form-error-text">От 2 до 60 символов</div>}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Отмена</button>
          <button className="btn btn-primary" onClick={submit} disabled={!valid || busy} data-testid="new-lead-source-save">
            {busy ? 'Сохраняем…' : 'Добавить'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
