import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FORM_SECTIONS,
  countProgress,
  emptyForm,
  LATIN_RE,
  type FieldDef,
  type SectionDef,
} from '../formSchema';
import { updateStudentForm } from '../api/students';
import Icon from '../Icon';
import PhoneInput from './PhoneInput';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function useDebouncedSave(form: any, onSave: (form: any) => Promise<void>, enabled: boolean) {
  const [state, setState] = useState<SaveState>('idle');
  const firstRun = useRef(true);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (timer.current) window.clearTimeout(timer.current);
    setState('idle');
    timer.current = window.setTimeout(async () => {
      setState('saving');
      try {
        await onSave(form);
        setState('saved');
        window.setTimeout(() => setState('idle'), 1500);
      } catch {
        setState('error');
      }
    }, 900);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(form), enabled]);

  return state;
}

const CURRENT_YEAR = new Date().getFullYear();

function Field({
  def,
  value,
  onChange,
  readOnly,
}: {
  def: FieldDef;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
}) {
  const sanitizeText = (raw: string): string => {
    if (def.kind === 'tel') return raw;
    if (def.kind === 'number' || def.digitsOnly) {
      let digits = raw.replace(/[^\d]/g, '');
      if (digits.length > 1) digits = digits.replace(/^0+/, '') || '0';
      return digits;
    }
    if (def.latin) {
      return raw.replace(/[^A-Za-z0-9 .,'\-/()&+#@]/g, '');
    }
    return raw.replace(/[<>{}[\]\\]/g, '');
  };

  const isInvalidLatin = def.latin && value && !LATIN_RE.test(value);

  const common = {
    value: value ?? '',
    disabled: readOnly,
    onChange: (e: any) => onChange(sanitizeText(e.target.value)),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (def.kind === 'number' || def.digitsOnly) {
        if (['e', 'E', '+', '-', '.', ','].includes(e.key)) e.preventDefault();
      }
    },
    onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => {
      if (def.kind === 'number' || def.digitsOnly) {
        const pasted = e.clipboardData.getData('text');
        if (!/^\d+$/.test(pasted)) {
          e.preventDefault();
          const cleaned = sanitizeText(pasted);
          if (cleaned) onChange(cleaned);
        }
      }
    },
    placeholder: def.placeholder,
  };

  if (def.kind === 'radio' && def.options) {
    return (
      <div className="af-field">
        <label className="af-label">
          {def.label} <span className="af-label-en">{def.labelEn}</span>
        </label>
        <div className="af-radio-group">
          {def.options.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={readOnly}
              className={`af-chip${value === o.value ? ' active' : ''}`}
              onClick={() => !readOnly && onChange(value === o.value ? '' : o.value)}
            >
              {value === o.value && <Icon name="check" size={14} />}
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (def.kind === 'textarea') {
    return (
      <div className="af-field af-field-wide">
        <label className="af-label">
          {def.label} <span className="af-label-en">{def.labelEn}</span>
          {def.optional && <span className="af-optional">— необязательно</span>}
        </label>
        <textarea {...common} rows={3} className={isInvalidLatin ? 'af-input-error' : ''} />
        {isInvalidLatin && <div className="af-field-error">Только латиница</div>}
      </div>
    );
  }

  if (def.kind === 'year') {
    return (
      <div className="af-field">
        <label className="af-label">
          {def.label} <span className="af-label-en">{def.labelEn}</span>
        </label>
        <select {...common}>
          <option value="">—</option>
          {Array.from({ length: 60 }, (_, i) => CURRENT_YEAR + 5 - i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
    );
  }

  if (def.kind === 'tel') {
    return (
      <div className="af-field">
        <label className="af-label">
          {def.label} <span className="af-label-en">{def.labelEn}</span>
          {def.optional && <span className="af-optional">— необязательно</span>}
        </label>
        <PhoneInput value={value || ''} onChange={onChange} disabled={readOnly} />
      </div>
    );
  }

  if (def.kind === 'select' && def.options) {
    return (
      <div className="af-field">
        <label className="af-label">
          {def.label} <span className="af-label-en">{def.labelEn}</span>
          {def.optional && <span className="af-optional">— необязательно</span>}
        </label>
        <select {...common} value={value || (def.noEmpty ? def.options[0].value : '')}>
          {!def.noEmpty && <option value="">— выберите —</option>}
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    );
  }

  let numError: string | null = null;
  if (def.kind === 'number' && value !== '' && value !== null && value !== undefined) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      if (def.min !== undefined && n < def.min) numError = `Минимум ${def.min}`;
      else if (def.max !== undefined && n > def.max) numError = `Максимум ${def.max}`;
    }
  }
  const inputErrCls = (isInvalidLatin || numError) ? 'af-input-error' : '';

  return (
    <div className="af-field">
      <label className="af-label">
        {def.label} <span className="af-label-en">{def.labelEn}</span>
        {def.optional && <span className="af-optional">— необязательно</span>}
      </label>
      <input
        type={def.kind || 'text'}
        {...common}
        min={def.kind === 'number' ? def.min : undefined}
        max={def.kind === 'number' ? def.max : undefined}
        step={def.kind === 'number' && def.max !== undefined && def.max <= 9 ? 0.5 : undefined}
        className={inputErrCls}
      />
      {isInvalidLatin && <div className="af-field-error">Только латиница</div>}
      {numError && <div className="af-field-error">{numError}</div>}
    </div>
  );
}

function SectionFields({
  section,
  value,
  onChange,
  readOnly,
}: {
  section: SectionDef;
  value: any;
  onChange: (v: any) => void;
  readOnly?: boolean;
}) {
  if (section.fields) {
    return (
      <div className="af-grid">
        {section.fields.map((f) => (
          <Field
            key={f.key}
            def={f}
            value={value?.[f.key] ?? ''}
            onChange={(v) => onChange({ ...(value || {}), [f.key]: v })}
            readOnly={readOnly}
          />
        ))}
      </div>
    );
  }
  return null;
}

function TableSection({
  section,
  rows,
  onChange,
  readOnly,
}: {
  section: SectionDef;
  rows: any[];
  onChange: (rows: any[]) => void;
  readOnly?: boolean;
}) {
  const [openRows, setOpenRows] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    rows.forEach((row, i) => {
      if (row && !row.__notAttended) {
        const hasData = section.table?.columns.some((c) => row[c.key]?.toString().trim());
        if (hasData) init[i] = true;
      }
    });
    return init;
  });
  const toggleRow = (i: number) => setOpenRows((p) => ({ ...p, [i]: !p[i] }));

  if (!section.table) return null;
  const { columns, rowLabels, fixedRows, minRows, skipLabels } = section.table;
  const isCollapsible = !!fixedRows && !!rowLabels;

  const updateCell = (ri: number, key: string, v: string) => {
    const next = [...rows];
    next[ri] = { ...next[ri], [key]: v };
    onChange(next);
  };
  const setNotAttended = (ri: number, value: boolean) => {
    const next = [...rows];
    if (value) {
      const cleared: any = { __notAttended: true };
      for (const c of columns) cleared[c.key] = '';
      next[ri] = cleared;
    } else {
      next[ri] = { ...(next[ri] || {}), __notAttended: false };
    }
    onChange(next);
  };
  const addRow = () => {
    const empty: any = {};
    for (const c of columns) empty[c.key] = '';
    onChange([...rows, empty]);
  };
  const removeRow = (ri: number) => {
    if (fixedRows) return;
    if (minRows && rows.length <= minRows) return;
    onChange(rows.filter((_, i) => i !== ri));
  };

  if (isCollapsible) {
    return (
      <div className="af-table-wrap af-collapsible">
        {rows.map((row, ri) => {
          const isOpen = !!openRows[ri];
          const notAttended = !!row?.__notAttended;
          return (
            <div key={ri} className={`af-edu-row${notAttended ? ' not-attended' : ''}`}>
              <div className="af-edu-head" onClick={() => !notAttended && toggleRow(ri)}>
                <div className="af-edu-title">{rowLabels![ri] || `Строка ${ri + 1}`}</div>
                <label
                  className="af-edu-skip"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={notAttended}
                    onChange={(e) => setNotAttended(ri, e.target.checked)}
                  />
                  <span>{skipLabels?.[ri] || 'Не учился(-ась)'}</span>
                </label>
                {!notAttended && (
                  <Icon name={isOpen ? 'expand_less' : 'expand_more'} size={20} />
                )}
              </div>
              {!notAttended && isOpen && (
                <div className="af-row-cells">
                  {columns.map((c) => (
                    <Field
                      key={c.key}
                      def={c}
                      value={row?.[c.key] ?? ''}
                      onChange={(v) => updateCell(ri, c.key, v)}
                      readOnly={readOnly}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="af-table-wrap">
      <div className="af-table">
        {rows.map((row, ri) => (
          <div key={ri} className="af-table-row">
            {rowLabels && <div className="af-row-label">{rowLabels[ri] || `Строка ${ri + 1}`}</div>}
            <div className="af-row-cells">
              {columns.map((c) => (
                <Field
                  key={c.key}
                  def={c}
                  value={row?.[c.key] ?? ''}
                  onChange={(v) => updateCell(ri, c.key, v)}
                  readOnly={readOnly}
                />
              ))}
            </div>
            {!fixedRows && rows.length > (minRows || 1) && !readOnly && (
              <button
                type="button"
                className="af-row-remove"
                onClick={() => removeRow(ri)}
                title="Удалить строку"
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
      {!fixedRows && !readOnly && (
        <button type="button" className="af-add-row" onClick={addRow}>
          <Icon name="add" size={16} /> Добавить ещё
        </button>
      )}
    </div>
  );
}

type Props = {
  studentId: string;
  initialForm: any;
  canEdit: boolean;
  onSaved?: () => void;
};

export default function ApplicationFormSection({ studentId, initialForm, canEdit, onSaved }: Props) {
  const [form, setForm] = useState<any>(initialForm || emptyForm());
  const [manualSaving, setManualSaving] = useState(false);
  const [manualSaved, setManualSaved] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    personal: true,
  });

  // Подхватываем обновления извне (когда родитель reload-нул студента)
  useEffect(() => {
    if (initialForm) setForm(initialForm);
  }, [JSON.stringify(initialForm)]);

  const save = async (data: any) => {
    await updateStudentForm(studentId, data);
    onSaved?.();
  };
  const saveState = useDebouncedSave(form, save, canEdit);

  const onManualSave = async () => {
    if (!form || manualSaving) return;
    setManualSaving(true);
    setManualSaved(false);
    try {
      await updateStudentForm(studentId, form);
      setManualSaved(true);
      onSaved?.();
      setTimeout(() => setManualSaved(false), 2500);
    } catch {
      // silent
    } finally {
      setManualSaving(false);
    }
  };

  const progress = countProgress(form);
  const percent = progress.total ? Math.round((progress.filled / progress.total) * 100) : 0;

  const toggle = (key: string) =>
    setOpenSections((p) => ({ ...p, [key]: !p[key] }));

  return (
    <section className="stu-card af-card">
      <div className="af-header">
        <div>
          <h2 className="stu-section-title" style={{ margin: 0 }}>
            Application Form — Анкета студента
          </h2>
          <div className="af-sub">
            {canEdit
              ? 'Каждое изменение сохраняется автоматически'
              : 'Просмотр анкеты (редактирование недоступно)'}
          </div>
        </div>
        <div className="af-save-state">
          {canEdit && saveState === 'saving' && (
            <span className="af-save saving">
              <Icon name="progress_activity" size={16} /> Сохраняем...
            </span>
          )}
          {canEdit && saveState === 'saved' && (
            <span className="af-save saved">
              <Icon name="check_circle" size={16} /> Сохранено
            </span>
          )}
          {canEdit && saveState === 'error' && (
            <span className="af-save err">
              <Icon name="error" size={16} /> Ошибка сохранения
            </span>
          )}
        </div>
      </div>

      <div className="af-progress">
        <div className="af-progress-text">
          <span>Заполнено <b>{progress.filled}</b> из {progress.total} полей</span>
          <span className="af-progress-percent">{percent}%</span>
        </div>
        <div className="af-progress-bar">
          <motion.div
            className="af-progress-fill"
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </div>

      <div className="af-note">
        <Icon name="info" size={18} />
        <div>
          Заполняйте поля <b>на английском языке</b> (как в паспорте). Анкета войдёт в пакет документов.
        </div>
      </div>

      <div className="af-sections">
        {FORM_SECTIONS.map((section) => {
          const isOpen = openSections[section.key] ?? false;
          return (
            <div key={section.key} className={`af-section${isOpen ? ' open' : ''}`}>
              <button
                type="button"
                className="af-section-head"
                onClick={() => toggle(section.key)}
              >
                <div className="af-section-head-left">
                  <div className="af-section-icon">
                    <Icon name={section.icon} size={18} />
                  </div>
                  <div>
                    <div className="af-section-title">{section.title}</div>
                    {section.titleEn && <div className="af-section-title-en">{section.titleEn}</div>}
                  </div>
                </div>
                <Icon
                  name={isOpen ? 'expand_less' : 'expand_more'}
                  size={24}
                  style={{ color: 'var(--text-soft)' }}
                />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="body"
                    className="af-section-body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {section.fields && (
                      <SectionFields
                        section={section}
                        value={form[section.key] || {}}
                        onChange={(v) => setForm({ ...form, [section.key]: v })}
                        readOnly={!canEdit}
                      />
                    )}
                    {section.table && (
                      <TableSection
                        section={section}
                        rows={form[section.key] || []}
                        onChange={(rows) => setForm({ ...form, [section.key]: rows })}
                        readOnly={!canEdit}
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {canEdit && (
          <div className="af-save-bar af-save-bar-bottom">
            <button
              type="button"
              className="btn btn-primary af-save-btn"
              onClick={onManualSave}
              disabled={manualSaving}
            >
              <Icon name="save" size={18} />
              {manualSaving ? 'Сохраняем...' : manualSaved ? 'Сохранено ✓' : 'Сохранить анкету'}
            </button>
            <div className="af-save-hint">
              Анкета также сохраняется автоматически при каждом изменении
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
