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
import { getStudentForm, saveStudentForm } from '../studentApi';
import Icon from '../Icon';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function useDebouncedSave(form: any, onSave: (form: any) => Promise<void>) {
  const [state, setState] = useState<SaveState>('idle');
  const firstRun = useRef(true);
  const timer = useRef<number | null>(null);

  useEffect(() => {
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
  }, [JSON.stringify(form)]);

  return state;
}

const CURRENT_YEAR = new Date().getFullYear();

function Field({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const isInvalidLatin = def.latin && value && !LATIN_RE.test(value);

  const common = {
    value: value ?? '',
    onChange: (e: any) => onChange(e.target.value),
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
              className={`af-chip${value === o.value ? ' active' : ''}`}
              onClick={() => onChange(value === o.value ? '' : o.value)}
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

  return (
    <div className="af-field">
      <label className="af-label">
        {def.label} <span className="af-label-en">{def.labelEn}</span>
        {def.optional && <span className="af-optional">— необязательно</span>}
      </label>
      <input
        type={def.kind || 'text'}
        {...common}
        className={isInvalidLatin ? 'af-input-error' : ''}
      />
      {isInvalidLatin && <div className="af-field-error">Только латиница</div>}
    </div>
  );
}

function SectionFields({
  section,
  value,
  onChange,
}: {
  section: SectionDef;
  value: any;
  onChange: (v: any) => void;
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
}: {
  section: SectionDef;
  rows: any[];
  onChange: (rows: any[]) => void;
}) {
  if (!section.table) return null;
  const { columns, rowLabels, fixedRows, minRows } = section.table;

  const updateCell = (ri: number, key: string, v: string) => {
    const next = [...rows];
    next[ri] = { ...next[ri], [key]: v };
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
                />
              ))}
            </div>
            {!fixedRows && rows.length > (minRows || 1) && (
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
      {!fixedRows && (
        <button type="button" className="af-add-row" onClick={addRow}>
          <Icon name="add" size={16} /> Добавить ещё
        </button>
      )}
    </div>
  );
}

export default function ApplicationFormSection() {
  const [form, setForm] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualSaved, setManualSaved] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    personal: true,
  });

  const save = async (data: any) => {
    await saveStudentForm(data);
  };
  const saveState = useDebouncedSave(form, save);

  const onManualSave = async () => {
    if (!form || manualSaving) return;
    setManualSaving(true);
    setManualSaved(false);
    try {
      await saveStudentForm(form);
      setManualSaved(true);
      setTimeout(() => setManualSaved(false), 2500);
    } catch {
      // silent
    } finally {
      setManualSaving(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const f = await getStudentForm();
        if (!mounted) return;
        setForm(f || emptyForm());
      } catch {
        if (!mounted) return;
        setForm(emptyForm());
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading || !form) {
    return (
      <div className="stu-card">
        <h2 className="stu-section-title">Анкета для поступления</h2>
        <div className="af-loading">Загружаем анкету...</div>
      </div>
    );
  }

  const progress = countProgress(form);
  const percent = progress.total ? Math.round((progress.filled / progress.total) * 100) : 0;

  const toggle = (key: string) =>
    setOpenSections((p) => ({ ...p, [key]: !p[key] }));

  return (
    <section className="stu-card af-card">
      <div className="af-header">
        <div>
          <h2 className="stu-section-title" style={{ margin: 0 }}>
            Application Form — Анкета для поступления
          </h2>
          <div className="af-sub">Заполняется постепенно — каждое изменение сохраняется автоматически</div>
        </div>
        <div className="af-save-state">
          {saveState === 'saving' && (
            <span className="af-save saving">
              <Icon name="progress_activity" size={16} /> Сохраняем...
            </span>
          )}
          {saveState === 'saved' && (
            <span className="af-save saved">
              <Icon name="check_circle" size={16} /> Сохранено
            </span>
          )}
          {saveState === 'error' && (
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
        {/* Большая кнопка Сохранить — на случай, если автосохранение тревожит */}
        <div className="af-save-bar">
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
                      />
                    )}
                    {section.table && (
                      <TableSection
                        section={section}
                        rows={form[section.key] || []}
                        onChange={(rows) => setForm({ ...form, [section.key]: rows })}
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

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
        </div>
      </div>
    </section>
  );
}
