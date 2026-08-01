import { motion } from 'framer-motion';
import type { Payslip } from '../api/types';
import { formatMoney, formatPercent } from '../utils/money';
import { formatDateTimeRu } from '../utils/datetime';
import PayslipStatusBadge from './PayslipStatusBadge';
import Icon from '../Icon';

type Props = {
  payslip: Payslip;
  onClose: () => void;
};

/**
 * Полная расшифровка расчётного листа — общая для кабинета сотрудника
 * (свои APPROVED/PAID/VOID листы) и ведомости руководства. Показывает
 * СНИМОК: версию формул на момент расчёта, а не текущие правила — иначе
 * пересчёт задним числом молча подменил бы уже выплаченную сумму (см.
 * immutability проекта архитектора).
 */
export default function PayslipDetailModal({ payslip, onClose }: Props) {
  const bonusLines = payslip.breakdown.filter((l) => l.bucket === 'bonus');
  const kpiLines = payslip.breakdown.filter((l) => l.bucket === 'kpi');

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="dialog-card payroll-detail-card"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="payment-form-header">
          <div>
            <div className="dialog-title" style={{ marginBottom: 4 }}>
              {payslip.user.fullName} · {payslip.periodKey}
              {/* «ред. N» — только номер версии: revision растёт и когда ошибочный
                  черновик просто удалили и сгенерировали заново, аннулирования при
                  этом не было. Факт сторно-цепочки — отдельная метка по
                  replacedById (то же разделение в ведомости, pages/Payroll.tsx). */}
              {payslip.revision > 1 && <span className="mgr-you" title="Номер версии листа за период"> · ред. {payslip.revision}</span>}
              {payslip.replacedById && <span className="mgr-you" title="Взамен этого листа выпущен новый"> · переиздан</span>}
            </div>
            <PayslipStatusBadge status={payslip.status} />
          </div>
        </div>

        {payslip.needsReview && (
          <div className="error-banner" style={{ marginBottom: 14 }}>
            <Icon name="warning" size={18} style={{ marginRight: 6 }} />
            Итог вышел за обычные пределы (отрицательный или больше 3× оклада) — требует проверки Основателя.
          </div>
        )}

        <div className="payments-totals" style={{ marginBottom: 16 }}>
          {/* «Оклад (реестр)» — договорная сумма, «Оклад (замена)» — ручная
              подмена, от которой и посчитан «Итого». Подпись именно
              «(реестр)», а не просто «Оклад»: в списке листов под «Окладом»
              стоит сумма к расчёту (baseOverride ?? baseAmount), и одинаковая
              подпись при разных числах читалась как ошибка начисления.
              Те же три смысла разведены в CSV (utils/payrollReport.ts). */}
          <div><span>Оклад (реестр)</span><strong>{formatMoney(payslip.baseAmount)}</strong></div>
          {payslip.baseOverride && <div><span>Оклад (замена)</span><strong className="text-warning">{formatMoney(payslip.baseOverride)}</strong></div>}
          <div><span>Бонус</span><strong className="text-success">{formatMoney(payslip.bonusAmount)}</strong></div>
          <div><span>Премия KPI</span><strong className="text-success">{formatMoney(payslip.kpiBonusAmount)}</strong></div>
          {parseFloat(payslip.adjustmentAmount) !== 0 && (
            <div><span>Корректировка</span><strong className={parseFloat(payslip.adjustmentAmount) < 0 ? 'text-danger' : 'text-success'}>{formatMoney(payslip.adjustmentAmount)}</strong></div>
          )}
          <div><span>Итого</span><strong style={{ fontSize: 18 }}>{formatMoney(payslip.totalAmount)}</strong></div>
        </div>

        {payslip.adjustmentReason && (
          <div className="receipt-dropzone-hint" style={{ marginBottom: 14 }}>Причина корректировки: {payslip.adjustmentReason}</div>
        )}

        <div className="payments-block-title">Метрики периода</div>
        <div className="payment-stage-figures" style={{ marginBottom: 16 }}>
          <div><span>Обработано лидов</span><strong>{payslip.leadsProcessed}</strong></div>
          <div><span>Консультаций</span><strong>{payslip.consultationsHeld}</strong></div>
          <div><span>Договоров подписано</span><strong>{payslip.contractsSigned}</strong></div>
          <div><span>Зачислено</span><strong>{payslip.enrolledCount}</strong></div>
          <div><span>Переехало</span><strong>{payslip.relocatedCount}</strong></div>
          <div><span>Конверсия в договор</span><strong>{formatPercent(payslip.conversionRate)}</strong></div>
          <div><span>Своевременность оплат</span><strong>{formatPercent(payslip.timelinessRate)}</strong></div>
          <div><span>Доведение до зачисления</span><strong>{formatPercent(payslip.deliveryRate)}</strong></div>
        </div>

        <div className="payments-block-title">Бонусная часть</div>
        {bonusLines.length === 0 ? (
          <div className="empty" style={{ padding: 12 }}>Правил бонуса не применено</div>
        ) : (
          <div className="table-wrap" style={{ marginBottom: 16 }}>
            <table className="table">
              <thead><tr><th>Правило</th><th>База</th><th>Сумма</th></tr></thead>
              <tbody>
                {bonusLines.map((l) => (
                  <tr key={l.ruleId} style={{ cursor: 'default' }}>
                    <td>{l.label}</td>
                    <td data-label="База">{l.base}</td>
                    <td data-label="Сумма">{formatMoney(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="payments-block-title">Премия за KPI</div>
        {kpiLines.length === 0 ? (
          <div className="empty" style={{ padding: 12 }}>Порогов KPI не достигнуто</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Правило</th><th>База</th><th>Сумма</th></tr></thead>
              <tbody>
                {kpiLines.map((l) => (
                  <tr key={l.ruleId} style={{ cursor: 'default' }}>
                    <td>{l.label}</td>
                    <td data-label="База">{l.base}</td>
                    <td data-label="Сумма">{formatMoney(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="receipt-dropzone-hint" style={{ marginTop: 16 }}>
          Посчитано по формулам {payslip.ruleSetVersion ? `v${payslip.ruleSetVersion}` : '— набор не назначен'}, {formatDateTimeRu(payslip.calculatedAt)}
          {payslip.calculatedBy ? ` · ${payslip.calculatedBy.fullName}` : ''}.
        </div>
        {payslip.approvedAt && (
          <div className="receipt-dropzone-hint">Утверждено {formatDateTimeRu(payslip.approvedAt)}{payslip.approvedBy ? ` · ${payslip.approvedBy.fullName}` : ''}.</div>
        )}
        {payslip.paidAt && (
          <div className="receipt-dropzone-hint">
            Выплачено {formatDateTimeRu(payslip.paidAt)}{payslip.paidBy ? ` · ${payslip.paidBy.fullName}` : ''}{payslip.paidReference ? ` · ${payslip.paidReference}` : ''}.
          </div>
        )}
        {payslip.status === 'VOID' && (
          <div className="payment-row-reason danger">
            <Icon name="report" size={14} /> Аннулирован {formatDateTimeRu(payslip.voidedAt)}{payslip.voidedBy ? ` · ${payslip.voidedBy.fullName}` : ''}: {payslip.voidReason}
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>Закрыть</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
