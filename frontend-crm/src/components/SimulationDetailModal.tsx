import { useEffect } from 'react';
import { motion } from 'framer-motion';
import type { BonusLine, BonusRuleSimulateItem } from '../api/types';
import { formatMoney, formatPercent } from '../utils/money';
import Icon from '../Icon';

type Props = {
  item: BonusRuleSimulateItem;
  period: string;
  /** Версия черновика («стало»). */
  draftVersion: number;
  /** Версия действующего набора («было»); null — активного набора нет. */
  currentVersion: number | null;
  onClose: () => void;
};

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
function periodLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : key;
}

const num = (v: string) => parseFloat(v) || 0;

/**
 * 03.09.2026 — расшифровка строки симулятора формул бонусов.
 *
 * До этого строка «Navruzbekova Soro — 800,00 → 800,00 — 0,00» ничего не
 * объясняла: откуда 800, по какому правилу, что изменится. Здесь обе стороны
 * разложены до строк «правило → база → сумма» и положены рядом, чтобы
 * разница была видна по каждому правилу, а не только в итоге.
 *
 * Метрики периода одни на обе стороны: правила меняют цену, а не факты.
 */
export default function SimulationDetailModal({ item, period, draftVersion, currentVersion, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const before = item.beforeDetail;
  const after = item.afterDetail;
  const diff = num(item.diff);
  const m = item.metrics;

  // Правила двух наборов сливаем по подписи: у черновика могут быть новые
  // правила, у действующего — удалённые, и обе стороны должны быть видны.
  const byLabel = new Map<string, { label: string; before?: BonusLine; after?: BonusLine }>();
  for (const l of before.breakdown) byLabel.set(l.label, { label: l.label, before: l });
  for (const l of after.breakdown) {
    const row = byLabel.get(l.label) ?? { label: l.label };
    row.after = l;
    byLabel.set(l.label, row);
  }
  const lines = Array.from(byLabel.values());

  const nothingAtAll = num(before.total) === 0 && num(after.total) === 0;

  const Money = ({ v, tone }: { v: string; tone?: 'success' | 'danger' | 'warning' }) => (
    <strong className={tone ? `text-${tone}` : undefined}>{formatMoney(v)}</strong>
  );

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="dialog-card sim-detail-card"
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="stat-detail-head">
          <div className="stat-icon" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>
            <Icon name="calculate" size={24} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="stat-label">{periodLabel(period)} · симуляция</div>
            <div className="stat-detail-value" style={{ fontSize: 20 }}>{item.fullName}</div>
          </div>
          <button className="stat-detail-close" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="stat-detail-formula" style={{ marginBottom: 14 }}>
          <Icon name="info" size={15} />
          <span>
            «Было» — по {currentVersion ? `действующему набору v${currentVersion}` : 'действующим правилам (активного набора нет)'}, «стало» — по этому
            черновику v{draftVersion}. Ничего не записано: это расчёт «что если».
          </span>
        </div>

        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <table className="table sim-compare">
            <thead>
              <tr>
                <th></th>
                <th>Было{currentVersion ? ` (v${currentVersion})` : ''}</th>
                <th>Стало (v{draftVersion})</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ cursor: 'default' }}>
                <td>Оклад</td>
                <td data-label="Было"><Money v={before.baseAmount} /></td>
                <td data-label="Стало"><Money v={after.baseAmount} /></td>
              </tr>
              <tr style={{ cursor: 'default' }}>
                <td>Бонусы</td>
                <td data-label="Было"><Money v={before.bonusAmount} tone="success" /></td>
                <td data-label="Стало"><Money v={after.bonusAmount} tone="success" /></td>
              </tr>
              <tr style={{ cursor: 'default' }}>
                <td>Премия KPI</td>
                <td data-label="Было"><Money v={before.kpiBonusAmount} tone="success" /></td>
                <td data-label="Стало"><Money v={after.kpiBonusAmount} tone="success" /></td>
              </tr>
              <tr style={{ cursor: 'default' }} className="sim-total-row">
                <td>Итого</td>
                <td data-label="Было"><strong style={{ fontSize: 16 }}>{formatMoney(before.total)}</strong></td>
                <td data-label="Стало">
                  <strong style={{ fontSize: 16 }}>{formatMoney(after.total)}</strong>
                  {diff !== 0 && (
                    <span className={`badge ${diff > 0 ? 'badge-success' : 'badge-danger'}`} style={{ marginLeft: 8 }}>
                      {diff > 0 ? '+' : ''}{formatMoney(item.diff)}
                    </span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {num(before.baseAmount) === 0 && (
          <div className="receipt-dropzone-hint" style={{ marginBottom: 14 }}>
            Оклад 0 — в реестре окладов у сотрудника нет записи на этот период. Бонусы и премии считаются и без него, но итог
            не станет зарплатой, пока оклад не заведён.
          </div>
        )}

        <div className="payments-block-title">Факты месяца</div>
        <div className="payment-stage-figures" style={{ marginBottom: 16 }}>
          <div><span>Обработано лидов</span><strong>{m.leadsProcessed}</strong></div>
          <div><span>Консультаций</span><strong>{m.consultationsHeld}</strong></div>
          <div><span>Договоров подписано</span><strong>{m.contractsSigned}</strong></div>
          <div><span>Сумма договоров</span><strong>{formatMoney(m.contractsAmount)}</strong></div>
          <div><span>Зачислено</span><strong>{m.enrolledCount}</strong></div>
          <div><span>Переехало</span><strong>{m.relocatedCount}</strong></div>
          <div><span>Документов (типов)</span><strong>{m.documentTypesAdded}</strong></div>
          <div><span>Конверсия в договор</span><strong>{formatPercent(m.conversionRate)}</strong></div>
          <div><span>Своевременность оплат</span><strong>{formatPercent(m.timelinessRate)}</strong></div>
          <div><span>Доведение</span><strong>{formatPercent(m.deliveryRate)}</strong></div>
        </div>

        <div className="payments-block-title">По правилам</div>
        {lines.length === 0 ? (
          <div className="empty" style={{ padding: 12 }}>
            {nothingAtAll
              ? 'Ни одно правило не сработало ни по одному набору: за месяц нет фактов, к которым они применяются.'
              : 'Правил бонуса не применено'}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Правило</th><th>База</th><th>Было</th><th>Стало</th></tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const b = l.before ? num(l.before.amount) : 0;
                  const a = l.after ? num(l.after.amount) : 0;
                  const d = a - b;
                  return (
                    <tr key={l.label} style={{ cursor: 'default' }}>
                      <td>
                        {l.label}
                        {(l.after ?? l.before)?.bucket === 'kpi' && (
                          <span className="badge badge-info" style={{ marginLeft: 6 }}>KPI</span>
                        )}
                      </td>
                      <td data-label="База" style={{ color: 'var(--text-soft)' }}>{(l.after ?? l.before)?.base}</td>
                      <td data-label="Было">{l.before ? formatMoney(l.before.amount) : <span style={{ color: 'var(--text-light)' }}>правила не было</span>}</td>
                      <td data-label="Стало">
                        {l.after ? formatMoney(l.after.amount) : <span style={{ color: 'var(--text-light)' }}>правило убрано</span>}
                        {d !== 0 && (
                          <span className={d > 0 ? 'text-success' : 'text-danger'} style={{ marginLeft: 6, fontSize: 12 }}>
                            {d > 0 ? '+' : ''}{formatMoney(d.toFixed(2))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>Закрыть</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
