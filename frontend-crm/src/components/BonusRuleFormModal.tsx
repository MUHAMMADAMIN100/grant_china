import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { BonusMetricScope, BonusRule, BonusRuleKind, BonusRuleScope, KpiMetric, PaymentStage, User } from '../api/types';
import {
  BONUS_METRIC_SCOPE_LABEL,
  BONUS_RULE_KIND_LABEL,
  BONUS_RULE_SCOPE_LABEL,
  KPI_METRIC_LABEL,
  KPI_RATE_METRICS,
  PAYMENT_STAGE_LABEL,
  SCHEDULE_PAYMENT_STAGES,
  canManageFinance,
} from '../api/types';
import { addRule, updateRule } from '../api/payroll';
import { listUsers } from '../api/users';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import Icon from '../Icon';

type Props = {
  setId: string;
  rule?: BonusRule | null;
  onClose: () => void;
  onSaved: () => void;
};

const KINDS: BonusRuleKind[] = [
  'PERCENT_OF_CONTRACTS',
  'PERCENT_OF_PAYMENTS',
  'FIXED_PER_CONTRACT',
  'FIXED_PER_STAGE',
  'FIXED_PER_ENROLLMENT',
  'FIXED_PER_RELOCATION',
  'FIXED_PER_CONSULTATION',
  'FIXED_PER_DOCUMENT',
  'KPI_THRESHOLD_BONUS',
];

const METRICS: KpiMetric[] = [
  'LEADS_PROCESSED',
  'CONSULTATIONS_HELD',
  'CONTRACTS_SIGNED',
  'CONVERSION_RATE',
  'PAYMENT_TIMELINESS',
  'DELIVERY_RATE',
  'ENROLLED_COUNT',
  'RELOCATED_COUNT',
];

function fractionToPercentInput(raw: string | null): string {
  if (!raw) return '';
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 100 * 10000) / 10000);
}

function percentInputToFraction(percent: string): string {
  const n = parseFloat(percent);
  if (!Number.isFinite(n)) return '';
  return (n / 100).toFixed(4);
}

function initialThresholdInput(r: BonusRule | null | undefined): string {
  if (!r || !r.threshold) return '';
  if (r.metric && KPI_RATE_METRICS.includes(r.metric)) return fractionToPercentInput(r.threshold);
  const n = parseFloat(r.threshold);
  return Number.isFinite(n) ? String(n) : '';
}

/**
 * Раздел 5 ТЗ (волна 6) — ОДНО правило бонуса. КЛЮЧЕВОЕ ограничение всего
 * модуля: ни здесь, ни где-либо ещё НЕТ поля для ввода текста формулы —
 * только выбор типа из закрытого списка (BonusRuleKind) и числовые поля.
 * Расчёт — обычный switch в bonus-engine.ts, никакого eval/new Function/vm
 * (см. formulaConfig проекта архитектора). Форма показывает ТОЛЬКО поля,
 * относящиеся к выбранному типу.
 */
export default function BonusRuleFormModal({ setId, rule, onClose, onSaved }: Props) {
  const me = useAuth((s) => s.user);
  const { toast } = useUI();
  const isEdit = !!rule;
  // ТЗ v3 раздел 4: Администратору финансы доступны только на чтение.
  // POST sets/:id/rules и PATCH rules/:ruleId помечены @Roles(FOUNDER), поэтому
  // кнопка сохранения существует только у Основателя. Открыть форму
  // Администратор уже не может (кнопки на /payroll/rules от него скрыты) —
  // это вторая линия защиты, чтобы ни один путь к форме не привёл в 403.
  const canManage = canManageFinance(me?.role);

  const [kind, setKind] = useState<BonusRuleKind>(rule?.kind ?? 'FIXED_PER_CONTRACT');
  const [label, setLabel] = useState(rule?.label ?? '');
  const [scope, setScope] = useState<BonusRuleScope>(rule?.scope ?? 'ALL');
  const [userId, setUserId] = useState(rule?.userId ?? '');
  const [ratePercent, setRatePercent] = useState(fractionToPercentInput(rule?.rate ?? null));
  const [amount, setAmount] = useState(rule?.amount ?? '');
  const [cap, setCap] = useState(rule?.cap ?? '');
  const [stage, setStage] = useState<PaymentStage | ''>(rule?.stage ?? '');
  const [metric, setMetric] = useState<KpiMetric | ''>(rule?.metric ?? '');
  const [metricScope, setMetricScope] = useState<BonusMetricScope>(rule?.metricScope ?? 'PERSONAL');
  const isRateMetric = metric ? KPI_RATE_METRICS.includes(metric) : false;
  const [thresholdInput, setThresholdInput] = useState(initialThresholdInput(rule));
  const [rewardKind, setRewardKind] = useState<'amount' | 'rate'>(rule?.rate ? 'rate' : 'amount');
  const [tierGroup, setTierGroup] = useState(rule?.tierGroup ?? '');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [sortOrder, setSortOrder] = useState(String(rule?.sortOrder ?? 0));
  const [note, setNote] = useState(rule?.note ?? '');
  const [users, setUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    listUsers().then((all) => setUsers(all.filter((u) => u.role === 'EMPLOYEE' || u.role === 'ADMIN'))).catch(() => {});
  }, []);

  const needsRate = kind === 'PERCENT_OF_CONTRACTS' || kind === 'PERCENT_OF_PAYMENTS';
  const needsAmount = kind !== 'PERCENT_OF_CONTRACTS' && kind !== 'PERCENT_OF_PAYMENTS' && kind !== 'KPI_THRESHOLD_BONUS';
  // Потолок обязателен у ВСЕХ счётных правил — ровно как в validateFields
  // (rules.service.ts). Пока условие было уже, для FIXED_PER_CONTRACT /
  // _ENROLLMENT / _RELOCATION / _STAGE поле не рендерилось вовсе: форма
  // отправляла запрос без cap и получала 400 на поле, которого в ней нет.
  const needsCap = kind !== 'KPI_THRESHOLD_BONUS';
  const needsStage = kind === 'FIXED_PER_STAGE' || kind === 'PERCENT_OF_PAYMENTS';
  const stageRequired = kind === 'FIXED_PER_STAGE';
  const isThreshold = kind === 'KPI_THRESHOLD_BONUS';

  const rateValid = !needsRate || (ratePercent !== '' && Number(ratePercent) >= 0 && Number(ratePercent) <= 100);
  const amountValid = !needsAmount || (amount !== '' && Number(amount) > 0);
  const capValid = !needsCap || (cap !== '' && Number(cap) > 0);
  const stageValid = !stageRequired || !!stage;
  const thresholdValid = !isThreshold || (thresholdInput !== '' && Number(thresholdInput) >= 0);
  const metricValid = !isThreshold || !!metric;
  const rewardValid = !isThreshold || (rewardKind === 'amount' ? amount !== '' && Number(amount) > 0 : ratePercent !== '' && Number(ratePercent) > 0 && Number(ratePercent) <= 100);
  const userValid = scope === 'ALL' || !!userId;
  const labelValid = label.trim().length > 0;

  const formInvalid = !labelValid || !rateValid || !amountValid || !capValid || !stageValid || !thresholdValid || !metricValid || !rewardValid || !userValid;

  const onSubmit = async () => {
    setTouched(true);
    if (formInvalid) {
      toast('Проверьте поля формы — для выбранного типа правила заполнены не все обязательные значения', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        kind,
        label: label.trim(),
        scope,
        userId: scope === 'USER' ? userId : undefined,
        rate: (needsRate || (isThreshold && rewardKind === 'rate')) && ratePercent !== '' ? percentInputToFraction(ratePercent) : undefined,
        amount: (needsAmount || (isThreshold && rewardKind === 'amount')) && amount !== '' ? amount : undefined,
        threshold: isThreshold && thresholdInput !== '' ? (isRateMetric ? percentInputToFraction(thresholdInput) : Number(thresholdInput).toFixed(4)) : undefined,
        cap: needsCap && cap !== '' ? cap : undefined,
        stage: needsStage && stage ? stage : undefined,
        metric: isThreshold && metric ? metric : undefined,
        metricScope: isThreshold ? metricScope : undefined,
        tierGroup: isThreshold && tierGroup.trim() ? tierGroup.trim() : undefined,
        enabled,
        sortOrder: Number(sortOrder) || 0,
        note: note.trim() || undefined,
      };
      if (isEdit && rule) {
        await updateRule(rule.id, payload);
        toast('Правило обновлено', 'success');
      } else {
        await addRule(setId, payload);
        toast('Правило добавлено', 'success');
      }
      onSaved();
      onClose();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка сохранения правила', 'error');
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
        <div className="dialog-title" style={{ marginBottom: 12 }}>{isEdit ? 'Изменить правило' : 'Новое правило бонуса'}</div>

        <div className="form-group">
          <label>Тип правила *</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as BonusRuleKind)} disabled={saving}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{BONUS_RULE_KIND_LABEL[k]}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Подпись в расшифровке *</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => setTouched(true)}
            className={touched && !labelValid ? 'input-error' : ''}
            maxLength={200}
            placeholder="Например, «3% от суммы договоров»"
            disabled={saving}
          />
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label>Область действия</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as BonusRuleScope)} disabled={saving}>
              {(['ALL', 'USER'] as BonusRuleScope[]).map((s) => (
                <option key={s} value={s}>{BONUS_RULE_SCOPE_LABEL[s]}</option>
              ))}
            </select>
          </div>
          {scope === 'USER' && (
            <div className="form-group">
              <label>Сотрудник *</label>
              <select value={userId} onChange={(e) => setUserId(e.target.value)} className={touched && !userValid ? 'input-error' : ''} disabled={saving}>
                <option value="">Выберите...</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {needsRate && (
          <div className="form-group">
            <label>Процент (%) *</label>
            <input
              value={ratePercent}
              onChange={(e) => setRatePercent(e.target.value.replace(/[^\d.]/g, ''))}
              onBlur={() => setTouched(true)}
              className={touched && !rateValid ? 'input-error' : ''}
              placeholder="3"
              disabled={saving}
            />
          </div>
        )}

        {needsAmount && !isThreshold && (
          <div className="form-group">
            <label>Фиксированная сумма, сомони *</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              onBlur={() => setTouched(true)}
              className={touched && !amountValid ? 'input-error' : ''}
              placeholder="200"
              disabled={saving}
            />
          </div>
        )}

        {needsCap && (
          <div className="form-group">
            <label>Потолок вклада правила, сомони *</label>
            <input
              value={cap}
              onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ''))}
              onBlur={() => setTouched(true)}
              className={touched && !capValid ? 'input-error' : ''}
              placeholder="1000"
              disabled={saving}
            />
            <div className="receipt-dropzone-hint">Предохранитель от опечатки в ставке или всплеска количества — обязателен для всех счётных правил.</div>
          </div>
        )}

        {needsStage && (
          <div className="form-group">
            <label>Этап{stageRequired ? ' *' : ' (необязательный фильтр)'}</label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as PaymentStage | '')}
              className={touched && stageRequired && !stageValid ? 'input-error' : ''}
              disabled={saving}
            >
              <option value="">{stageRequired ? 'Выберите этап' : 'Все этапы'}</option>
              {SCHEDULE_PAYMENT_STAGES.map((s) => (
                <option key={s} value={s}>{PAYMENT_STAGE_LABEL[s]}</option>
              ))}
            </select>
          </div>
        )}

        {isThreshold && (
          <>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Метрика KPI *</label>
                <select value={metric} onChange={(e) => setMetric(e.target.value as KpiMetric | '')} className={touched && !metricValid ? 'input-error' : ''} disabled={saving}>
                  <option value="">Выберите...</option>
                  {METRICS.map((m) => (
                    <option key={m} value={m}>{KPI_METRIC_LABEL[m]}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Область показателя</label>
                <select value={metricScope} onChange={(e) => setMetricScope(e.target.value as BonusMetricScope)} disabled={saving}>
                  {(['PERSONAL', 'TEAM'] as BonusMetricScope[]).map((s) => (
                    <option key={s} value={s}>{BONUS_METRIC_SCOPE_LABEL[s]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Порог{isRateMetric ? ' (%)' : ' (количество)'} *</label>
              <input
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value.replace(/[^\d.]/g, ''))}
                onBlur={() => setTouched(true)}
                className={touched && !thresholdValid ? 'input-error' : ''}
                placeholder={isRateMetric ? '25' : '10'}
                disabled={saving}
              />
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Вознаграждение</label>
                <select value={rewardKind} onChange={(e) => setRewardKind(e.target.value as 'amount' | 'rate')} disabled={saving}>
                  <option value="amount">Фиксированная сумма</option>
                  <option value="rate">Процент от оклада</option>
                </select>
              </div>
              {rewardKind === 'amount' ? (
                <div className="form-group">
                  <label>Сумма, сомони *</label>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                    onBlur={() => setTouched(true)}
                    className={touched && !rewardValid ? 'input-error' : ''}
                    disabled={saving}
                  />
                </div>
              ) : (
                <div className="form-group">
                  <label>Процент от оклада, % *</label>
                  <input
                    value={ratePercent}
                    onChange={(e) => setRatePercent(e.target.value.replace(/[^\d.]/g, ''))}
                    onBlur={() => setTouched(true)}
                    className={touched && !rewardValid ? 'input-error' : ''}
                    disabled={saving}
                  />
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Группа ступенчатой шкалы (необязательно)</label>
              <input value={tierGroup} onChange={(e) => setTierGroup(e.target.value)} maxLength={100} placeholder="cr" disabled={saving} />
              <div className="receipt-dropzone-hint">Правила с одинаковой группой конкурируют — применяется одно, с наибольшим пройденным порогом.</div>
            </div>
          </>
        )}

        <div className="form-grid-2">
          <div className="form-group">
            <label>Порядок отображения</label>
            <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value.replace(/[^\d-]/g, ''))} disabled={saving} />
          </div>
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22 }}>
            <input type="checkbox" id="rule-enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 16, height: 16 }} disabled={saving} />
            <label htmlFor="rule-enabled" style={{ margin: 0 }}>Правило активно</label>
          </div>
        </div>

        <div className="form-group">
          <label>Заметка</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} disabled={saving} />
        </div>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>{canManage ? 'Отмена' : 'Закрыть'}</button>
          {canManage && (
            <button className="btn btn-primary" onClick={onSubmit} disabled={saving}>
              {saving ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Добавить'}
              {!saving && <Icon name="check" size={16} style={{ marginLeft: 4 }} />}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
