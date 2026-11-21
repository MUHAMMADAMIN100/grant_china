import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { createQuickReply, deleteQuickReply, updateQuickReply, type QuickReply } from '../../api/messaging';
import { useUI } from '../../ui/Dialogs';
import Icon from '../../Icon';

const errText = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m || fallback;
};

/**
 * 21.11.2026 — быстрые ответы (руководство): короткое имя для поиска после «/»
 * и текст, который подставится в поле ответа. Удалённый ответ пропадает из
 * списка, в базе остаётся с отметкой времени (правило проекта).
 */
export default function QuickRepliesModal({ items, onClose, onChanged }: { items: QuickReply[]; onClose: () => void; onChanged: (list: QuickReply[]) => void }) {
  const { toast, confirm } = useUI();
  const [list, setList] = useState(items);
  const [editId, setEditId] = useState<string | 'new' | null>(items.length ? null : 'new');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setList(items), [items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const startEdit = (q: QuickReply | null) => {
    setEditId(q ? q.id : 'new');
    setTitle(q?.title ?? '');
    setText(q?.text ?? '');
  };

  const commit = (next: QuickReply[]) => {
    setList(next);
    onChanged(next);
  };

  const save = async () => {
    const t = title.trim().replace(/^\/+/, '');
    if (!t || !text.trim()) return;
    setBusy(true);
    try {
      if (editId === 'new') {
        const row = await createQuickReply({ title: t, text: text.trim() });
        commit([...list, row]);
      } else if (editId) {
        const row = await updateQuickReply(editId, { title: t, text: text.trim() });
        commit(list.map((q) => (q.id === row.id ? row : q)));
      }
      setEditId(null);
      setTitle('');
      setText('');
      toast('Сохранено', 'success');
    } catch (e) {
      toast(errText(e, 'Не удалось сохранить'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (q: QuickReply) => {
    if (!(await confirm({ title: 'Удалить быстрый ответ?', message: `«/${q.title}» пропадёт из списка у всех сотрудников.`, confirmText: 'Удалить', danger: true }))) return;
    setBusy(true);
    try {
      await deleteQuickReply(q.id);
      commit(list.filter((x) => x.id !== q.id));
      if (editId === q.id) setEditId(null);
    } catch (e) {
      toast(errText(e, 'Не удалось удалить'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <div className="dm-qr-form" data-testid="qr-form">
      <label>
        <span>Имя для поиска</span>
        <div className="dm-qr-title-input">
          <span>/</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder="адрес" autoFocus data-testid="qr-title" />
        </div>
      </label>
      <label>
        <span>Текст</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={4} placeholder="Наш офис: …" data-testid="qr-text" />
      </label>
      <div className="dm-qr-form-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditId(null)} disabled={busy}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || !title.trim() || !text.trim()} data-testid="qr-save">
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !busy && onClose()}>
      <motion.div
        className="dialog-card dm-qr-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Быстрые ответы"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
        data-testid="qr-modal"
      >
        <div className="dm-ai-modal-head">
          <div>
            <div className="dialog-title">
              <Icon name="bolt" size={22} /> Быстрые ответы
            </div>
            <div className="dm-ai-modal-sub">В поле ответа наберите «/» и начало имени — выберите ответ стрелками и Enter.</div>
          </div>
          <button type="button" className="dm-icon-btn" onClick={onClose} aria-label="Закрыть" disabled={busy}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className="dm-qr-list">
          {list.length === 0 && editId !== 'new' && <div className="dm-info-hint">Пока пусто.</div>}
          {list.map((q) =>
            editId === q.id ? (
              <div key={q.id}>{form}</div>
            ) : (
              <div key={q.id} className="dm-qr-item" data-testid="qr-item">
                <div className="dm-qr-item-body">
                  <strong>/{q.title}</strong>
                  <span>{q.text}</span>
                </div>
                <button type="button" className="dm-icon-btn" onClick={() => startEdit(q)} aria-label="Изменить" disabled={busy}>
                  <Icon name="edit" size={18} />
                </button>
                <button type="button" className="dm-icon-btn" onClick={() => remove(q)} aria-label="Удалить" disabled={busy} data-testid="qr-delete">
                  <Icon name="delete" size={18} />
                </button>
              </div>
            ),
          )}
          {editId === 'new' && form}
        </div>
        <div className="dialog-actions">
          {editId === null && (
            <button type="button" className="btn btn-secondary" onClick={() => startEdit(null)} disabled={busy} data-testid="qr-add">
              <Icon name="add" size={18} /> Добавить
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose} disabled={busy}>
            Готово
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
