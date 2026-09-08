import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useLeadSources, useLeadSourcesStore } from '../store/leadSources';
import { useUI } from '../ui/Dialogs';
import Icon from '../Icon';
import { NewLeadSourceModal } from './LeadSourceSelect';

/**
 * 08.09.2026 — вкладка «Источники привлечения» в разделе «Пользователи».
 *
 * Руководство видит весь справочник с числом заявок и консультаций по
 * каждому источнику, переименовывает свои источники (заявки не трогаются:
 * в них хранится код, а не название) и скрывает лишние из выбора. Скрытый
 * источник у старых заявок остаётся и в фильтре доступен, пока по нему
 * есть записи. Встроенные источники — только для чтения.
 */
export default function LeadSourcesAdmin({ canEdit }: { canEdit: boolean }) {
  const items = useLeadSources();
  const update = useLeadSourcesStore((s) => s.update);
  const load = useLeadSourcesStore((s) => s.load);
  const { toast, confirm } = useUI();
  // Счётчики заявок/консультаций считаются на сервере — при открытии вкладки
  // берём свежие, а не те, что стор запомнил при первом заходе в CRM.
  useEffect(() => { load().catch(() => undefined); }, [load]);
  const [editing, setEditing] = useState<{ code: string; label: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const custom = items.filter((i) => !i.builtin);
  const builtin = items.filter((i) => i.builtin);

  const rename = async () => {
    if (!editing) return;
    const label = editing.label.trim();
    if (label.length < 2) return;
    setBusy(editing.code);
    try {
      const item = await update(editing.code, { label });
      toast(`Источник переименован в «${item.label}»`, 'success');
      setEditing(null);
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Не удалось переименовать', 'error');
    } finally {
      setBusy(null);
    }
  };

  const toggleHidden = async (code: string, label: string, hidden: boolean, inUse: number) => {
    if (!hidden) {
      const ok = await confirm({
        title: 'Скрыть источник из выбора',
        message: inUse > 0
          ? `«${label}» перестанет предлагаться в формах. ${inUse} записей с этим источником сохранят его и останутся в фильтре.`
          : `«${label}» перестанет предлагаться в формах. Вернуть можно в любой момент.`,
        confirmText: 'Скрыть',
      });
      if (!ok) return;
    }
    setBusy(code);
    try {
      await update(code, { hidden: !hidden });
      toast(hidden ? `«${label}» снова показывается` : `«${label}» скрыт из выбора`, 'success');
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Не удалось изменить', 'error');
    } finally {
      setBusy(null);
    }
  };

  const Row = ({ code, label, hidden, builtinRow, applications, consultations, createdByName }: { code: string; label: string; hidden: boolean; builtinRow: boolean; applications: number; consultations: number; createdByName: string | null }) => {
    const isEditing = editing?.code === code;
    return (
      <tr key={code} data-testid={`lead-source-row-${code}`} style={{ opacity: hidden ? 0.6 : 1 }}>
        <td>
          {isEditing ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                value={editing!.label}
                onChange={(e) => setEditing({ code, label: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') void rename(); if (e.key === 'Escape') setEditing(null); }}
                maxLength={60}
                autoFocus
                style={{ minWidth: 220 }}
                data-testid="lead-source-rename-input"
              />
              <button className="btn btn-sm btn-primary" onClick={rename} disabled={busy === code || editing!.label.trim().length < 2} data-testid="lead-source-rename-save">Сохранить</button>
              <button className="btn btn-sm btn-secondary" onClick={() => setEditing(null)} disabled={busy === code}>Отмена</button>
            </div>
          ) : (
            <>
              <strong>{label}</strong>
              {hidden && <span className="badge badge-gray" style={{ marginLeft: 8 }}>скрыт</span>}
            </>
          )}
        </td>
        <td data-label="Тип">{builtinRow ? <span className="badge badge-info">встроенный</span> : <span className="badge badge-success">свой</span>}</td>
        <td data-label="Заявок" style={{ textAlign: 'center' }}>{applications}</td>
        <td data-label="Консультаций" style={{ textAlign: 'center' }}>{consultations}</td>
        <td data-label="Кто добавил">{builtinRow ? '—' : createdByName || '—'}</td>
        <td data-label="Действия">
          {!builtinRow && canEdit && !isEditing && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm btn-secondary" onClick={() => setEditing({ code, label })} disabled={busy === code} title="Переименовать">
                <Icon name="edit" size={14} />
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => toggleHidden(code, label, hidden, applications + consultations)} disabled={busy === code} title={hidden ? 'Показывать в выборе' : 'Скрыть из выбора'} data-testid={`lead-source-toggle-${code}`}>
                <Icon name={hidden ? 'visibility' : 'visibility_off'} size={14} />
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="text-muted" style={{ fontSize: 13, flex: 1, minWidth: 260 }}>
          Свои источники сотрудники добавляют через пункт «Другое…» в формах. Здесь их можно переименовать или скрыть из выбора — заявки при этом не меняются.
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)} data-testid="lead-source-add-btn">
          <Icon name="add" size={16} /> Добавить источник
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Источник</th><th>Тип</th><th style={{ textAlign: 'center', width: 90 }}>Заявок</th><th style={{ textAlign: 'center', width: 120 }}>Консультаций</th><th>Кто добавил</th><th>Действия</th></tr>
          </thead>
          <tbody>
            {custom.length === 0 && (
              <tr><td colSpan={6} className="text-muted" style={{ textAlign: 'center', padding: 18 }}>Своих источников пока нет — они появятся, когда сотрудник выберет «Другое…» и введёт название.</td></tr>
            )}
            {custom.map((i) => <Row key={i.code} code={i.code} label={i.label} hidden={i.hidden} builtinRow={false} applications={i.applications} consultations={i.consultations} createdByName={i.createdByName} />)}
            {builtin.map((i) => <Row key={i.code} code={i.code} label={i.label} hidden={false} builtinRow applications={i.applications} consultations={i.consultations} createdByName={null} />)}
          </tbody>
        </table>
      </div>
      <AnimatePresence>
        {adding && <NewLeadSourceModal onClose={() => setAdding(false)} onCreated={() => setAdding(false)} />}
      </AnimatePresence>
    </div>
  );
}
