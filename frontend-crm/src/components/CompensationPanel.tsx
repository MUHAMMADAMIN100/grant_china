import { Fragment, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ROLE_LABEL } from '../api/types';
import type { CompensationCurrent, CompensationRow } from '../api/payroll';
import { deleteCompensation, getCompensationCurrent, getCompensationHistory, setCompensation } from '../api/payroll';
import { useUI } from '../ui/Dialogs';
import { formatMoney } from '../utils/money';
import Icon from '../Icon';

type Props = { onClose: () => void };

const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ТЗ 2.8 — «кадровые ведомости»: реестр окладов сотрудников с историей.
 * Целиком доступен ТОЛЬКО FOUNDER (см. accessModel проекта архитектора:
 * ADMIN видит начисленное в сводной ведомости, но не управляет ставками) —
 * этот компонент подключается только со страницы /payroll под проверкой роли.
 */
export default function CompensationPanel({ onClose }: Props) {
  const { toast } = useUI();
  const [current, setCurrent] = useState<CompensationCurrent | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [history, setHistory] = useState<CompensationRow[]>([]);

  const [formUserId, setFormUserId] = useState<string | null>(null);
  const [baseSalary, setBaseSalary] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    getCompensationCurrent().then(setCurrent).catch(() => setCurrent(null)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const toggleHistory = (userId: string) => {
    if (expandedUserId === userId) { setExpandedUserId(null); return; }
    setExpandedUserId(userId);
    getCompensationHistory(userId).then(setHistory).catch(() => setHistory([]));
  };

  const openForm = (userId: string) => {
    setFormUserId(userId);
    setBaseSalary('');
    setEffectiveFrom('');
    setNote('');
  };

  const amountValid = MONEY_RE.test(baseSalary);
  const dateValid = DATE_RE.test(effectiveFrom);

  const onSubmit = async () => {
    if (!formUserId || !amountValid || !dateValid) {
      toast('Укажите корректные оклад и дату начала действия', 'error');
      return;
    }
    setSaving(true);
    try {
      await setCompensation({ userId: formUserId, baseSalary, effectiveFrom, note: note.trim() || undefined });
      toast('Ставка сохранена', 'success');
      setFormUserId(null);
      load();
      if (expandedUserId === formUserId) toggleHistory(formUserId);
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка сохранения ставки', 'error');
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async (id: string, userId: string) => {
    try {
      await deleteCompensation(id);
      toast('Ставка удалена из истории', 'success');
      getCompensationHistory(userId).then(setHistory).catch(() => {});
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка удаления ставки', 'error');
    }
  };

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="dialog-card payroll-detail-card"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-title">Оклады сотрудников</div>
        <div className="receipt-dropzone-hint" style={{ marginBottom: 14 }}>
          Кадровая ведомость (ТЗ 2.8). Повышение «с середины месяца» оформляйте первым числом следующего — пропорционального расчёта система не делает.
        </div>

        {loading ? (
          <div className="empty" style={{ padding: 16 }}>Загрузка...</div>
        ) : !current ? (
          <div className="empty" style={{ padding: 16 }}>Нет данных</div>
        ) : (
          <>
            <div className="payments-totals" style={{ marginBottom: 14 }}>
              <div><span>Фонд окладов (текущий)</span><strong>{formatMoney(current.fundTotal)}</strong></div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Сотрудник</th><th>Роль</th><th>Оклад</th><th /></tr></thead>
                <tbody>
                  {current.items.map((u) => (
                    <Fragment key={u.id}>
                      <tr onClick={() => toggleHistory(u.id)} style={{ cursor: 'pointer' }}>
                        <td><strong>{u.fullName}</strong></td>
                        <td data-label="Роль">{ROLE_LABEL[u.role as 'FOUNDER' | 'ADMIN' | 'EMPLOYEE'] ?? u.role}</td>
                        <td data-label="Оклад">{u.baseSalary ? formatMoney(u.baseSalary) : <span className="mgr-none">Не назначен</span>}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn-sm btn-secondary" onClick={() => openForm(u.id)}>
                            <Icon name="add" size={14} style={{ marginRight: 4 }} />
                            Новая ставка
                          </button>
                        </td>
                      </tr>
                      {expandedUserId === u.id && (
                        <tr key={`${u.id}-history`} style={{ cursor: 'default' }}>
                          <td colSpan={4} style={{ background: 'var(--bg)' }}>
                            {history.length === 0 ? (
                              <div className="empty" style={{ padding: 10 }}>История пуста</div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 4px' }}>
                                {history.map((h) => (
                                  <div key={h.id} className="creds-row" style={{ padding: '6px 0' }}>
                                    <span className="creds-label">{new Date(h.effectiveFrom).toLocaleDateString('ru-RU')}:</span>
                                    <code className="creds-value">{formatMoney(h.baseSalary)}</code>
                                    {h.note && <span className="mgr-you">{h.note}</span>}
                                    <button className="btn btn-sm btn-danger" style={{ marginLeft: 'auto' }} onClick={() => onRemove(h.id, u.id)}>
                                      Удалить
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                      {formUserId === u.id && (
                        <tr key={`${u.id}-form`} style={{ cursor: 'default' }}>
                          <td colSpan={4} style={{ background: 'var(--bg)' }}>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', padding: '10px 4px' }}>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label>Оклад (сомони) *</label>
                                <input value={baseSalary} onChange={(e) => setBaseSalary(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: 140 }} disabled={saving} />
                              </div>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label>Действует с *</label>
                                <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} disabled={saving} />
                              </div>
                              <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 160 }}>
                                <label>Примечание</label>
                                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} disabled={saving} />
                              </div>
                              <button className="btn btn-sm btn-secondary" onClick={() => setFormUserId(null)} disabled={saving}>Отмена</button>
                              <button className="btn btn-sm btn-primary" onClick={onSubmit} disabled={saving || !amountValid || !dateValid}>
                                {saving ? 'Сохранение…' : 'Сохранить'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>Закрыть</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
