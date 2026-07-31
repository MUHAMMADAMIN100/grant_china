import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { BonusRule, BonusRuleSet } from '../api/types';
import {
  BONUS_METRIC_SCOPE_LABEL,
  BONUS_RULE_KIND_LABEL,
  BONUS_RULE_SCOPE_LABEL,
  BONUS_RULE_SET_STATUS_BADGE,
  BONUS_RULE_SET_STATUS_LABEL,
  KPI_METRIC_LABEL,
  KPI_RATE_METRICS,
  PAYMENT_STAGE_LABEL,
  isFounder,
} from '../api/types';
import type { BonusRuleSimulateResult } from '../api/types';
import {
  activateRuleSet,
  archiveRuleSet,
  createRuleSet,
  getRuleSet,
  listRuleSets,
  removeRule,
  simulateRuleSet,
  updateRuleSet,
} from '../api/payroll';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useUrlFilter } from '../hooks/useUrlFilter';
import { currentMonthKey } from '../utils/datetime';
import { formatMoney, formatPercent } from '../utils/money';
import BonusRuleFormModal from '../components/BonusRuleFormModal';
import Icon from '../Icon';

type RuleSetFormMode = { kind: 'create'; cloneFromId?: string } | { kind: 'edit'; set: BonusRuleSet };

/** Компактная модалка версии набора — только заголовок и дата, никаких формул. */
function RuleSetFormModal({ mode, onClose, onSaved }: { mode: RuleSetFormMode; onClose: () => void; onSaved: (id: string) => void }) {
  const { toast } = useUI();
  const isEdit = mode.kind === 'edit';
  const [title, setTitle] = useState(isEdit ? mode.set.title : '');
  const [effectiveFrom, setEffectiveFrom] = useState(isEdit ? mode.set.effectiveFrom.slice(0, 10) : '');
  const [saving, setSaving] = useState(false);

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom);
  const titleValid = title.trim().length > 0;

  const onSubmit = async () => {
    if (!titleValid || !dateValid) {
      toast('Укажите название и дату начала действия', 'error');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        const saved = await updateRuleSet(mode.set.id, { title: title.trim(), effectiveFrom });
        toast('Версия обновлена', 'success');
        onSaved(saved.id);
      } else {
        const saved = await createRuleSet({ title: title.trim(), effectiveFrom, cloneFromId: mode.cloneFromId });
        toast('Черновик создан', 'success');
        onSaved(saved.id);
      }
      onClose();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка сохранения версии', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="dialog-card"
        style={{ maxWidth: 440 }}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-title">{isEdit ? 'Изменить версию' : 'Новый черновик набора формул'}</div>
        {!isEdit && mode.cloneFromId && (
          <div className="receipt-dropzone-hint" style={{ marginBottom: 10 }}>Правила будут скопированы из выбранной версии — вы сможете их изменить.</div>
        )}
        <div className="form-group" style={{ textAlign: 'left' }}>
          <label>Название *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} disabled={saving} />
        </div>
        <div className="form-group" style={{ textAlign: 'left' }}>
          <label>Действует с (первое число месяца) *</label>
          <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} disabled={saving} />
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ruleValueSummary(r: BonusRule): string {
  switch (r.kind) {
    case 'PERCENT_OF_CONTRACTS':
    case 'PERCENT_OF_PAYMENTS':
      return `${r.rate ? (parseFloat(r.rate) * 100).toFixed(2) : '0'}% (потолок ${r.cap ? formatMoney(r.cap) : '—'})${r.stage ? `, ${PAYMENT_STAGE_LABEL[r.stage]}` : ''}`;
    case 'FIXED_PER_CONTRACT':
    case 'FIXED_PER_ENROLLMENT':
    case 'FIXED_PER_RELOCATION':
      return r.amount ? formatMoney(r.amount) : '—';
    case 'FIXED_PER_STAGE':
      return `${r.amount ? formatMoney(r.amount) : '—'} · ${r.stage ? PAYMENT_STAGE_LABEL[r.stage] : '—'}`;
    case 'FIXED_PER_CONSULTATION':
      return `${r.amount ? formatMoney(r.amount) : '—'} (потолок ${r.cap ? formatMoney(r.cap) : '—'})`;
    case 'KPI_THRESHOLD_BONUS': {
      const metric = r.metric ? KPI_METRIC_LABEL[r.metric] : '—';
      const isRate = r.metric ? KPI_RATE_METRICS.includes(r.metric) : false;
      const threshold = r.threshold ? (isRate ? formatPercent(r.threshold) : String(parseFloat(r.threshold))) : '—';
      const reward = r.amount ? formatMoney(r.amount) : r.rate ? `${(parseFloat(r.rate) * 100).toFixed(2)}% от оклада` : '—';
      return `${metric} ≥ ${threshold} (${BONUS_METRIC_SCOPE_LABEL[r.metricScope]}) → ${reward}`;
    }
    default:
      return '—';
  }
}

/**
 * ТЗ 5.2 «изменение формул бонусов». Формула = ВЫБОР ТИПА + ЧИСЛА, никакого
 * текстового поля для выражения нигде на этой странице. ACTIVE-версию
 * редактировать нельзя ни одной кнопкой — «изменить» технически означает
 * «клонировать в черновик» (см. formulaConfig проекта архитектора).
 */
export default function PayrollRules() {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const isFdr = isFounder(me?.role);

  const [sets, setSets] = useState<BonusRuleSet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<BonusRuleSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [setModal, setSetModal] = useState<RuleSetFormMode | null>(null);
  const [ruleModal, setRuleModal] = useState<{ kind: 'create' } | { kind: 'edit'; rule: BonusRule } | null>(null);

  const simDefaults = useMemo(() => ({ simPeriod: currentMonthKey() }), []);
  const [simFilters, setSimFilter] = useUrlFilter(simDefaults);
  const [simResult, setSimResult] = useState<BonusRuleSimulateResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  const loadSets = (keepSelection = true) => {
    setLoading(true);
    listRuleSets()
      .then((rows) => {
        setSets(rows);
        if (!keepSelection || !rows.find((r) => r.id === selectedId)) {
          const active = rows.find((r) => r.status === 'ACTIVE');
          setSelectedId(rows[0] ? (active?.id ?? rows[0].id) : null);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadSets(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    getRuleSet(selectedId).then(setSelected).catch(() => setSelected(null));
  }, [selectedId]);

  const selectAfterSave = (id: string) => {
    loadSets();
    setSelectedId(id);
  };

  const onActivate = async () => {
    if (!selected) return;
    const ok = await confirm({
      title: 'Активировать набор формул',
      message: `Версия «${selected.title}» станет действующей с ${new Date(selected.effectiveFrom).toLocaleDateString('ru-RU')}. Необратимо повлияет на ещё не утверждённые (DRAFT) расчётные листы — утверждённые и выплаченные листы не затрагиваются.`,
      confirmText: 'Активировать',
      danger: true,
    });
    if (!ok) return;
    try {
      await activateRuleSet(selected.id);
      toast('Набор формул активирован', 'success');
      loadSets();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка активации', 'error');
    }
  };

  const onArchive = async () => {
    if (!selected) return;
    const ok = await confirm({
      title: 'Архивировать набор формул',
      message: `Версия «${selected.title}» перестанет предлагаться для новых расчётов.`,
      confirmText: 'Архивировать',
    });
    if (!ok) return;
    try {
      await archiveRuleSet(selected.id);
      toast('Набор формул архивирован', 'success');
      loadSets();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка архивации', 'error');
    }
  };

  const onRemoveRule = async (r: BonusRule) => {
    const ok = await confirm({ title: 'Удалить правило', message: `«${r.label}» будет удалено из черновика.`, confirmText: 'Удалить', danger: true });
    if (!ok) return;
    try {
      await removeRule(r.id);
      toast('Правило удалено', 'success');
      if (selectedId) getRuleSet(selectedId).then(setSelected);
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка удаления правила', 'error');
    }
  };

  const onSimulate = () => {
    if (!selected) return;
    setSimLoading(true);
    simulateRuleSet(selected.id, simFilters.simPeriod)
      .then(setSimResult)
      .catch((e: any) => { setSimResult(null); toast(e?.response?.data?.message || 'Ошибка симуляции', 'error'); })
      .finally(() => setSimLoading(false));
  };

  const isDraft = selected?.status === 'DRAFT';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 18, alignItems: 'flex-start' }}>
      <motion.div className="card" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }}>
        <div className="card-header"><h2 className="card-title" style={{ fontSize: 15 }}>Версии формул</h2></div>
        <div className="card-body" style={{ padding: 10 }}>
          <button className="btn btn-sm btn-secondary" style={{ width: '100%', marginBottom: 10 }} onClick={() => setSetModal({ kind: 'create' })}>
            <Icon name="add" size={15} style={{ marginRight: 4 }} />
            Новый черновик
          </button>
          {loading ? (
            <div className="empty" style={{ padding: 12 }}>Загрузка...</div>
          ) : sets.length === 0 ? (
            <div className="empty" style={{ padding: 12 }}>Наборов формул ещё нет</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sets.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className="btn"
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                    padding: '10px 12px', border: '1px solid var(--border)',
                    background: s.id === selectedId ? 'var(--primary-soft)' : 'white',
                    borderColor: s.id === selectedId ? 'var(--primary)' : 'var(--border)',
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 13 }}>v{s.version} · {s.title}</span>
                  <span className={`badge ${BONUS_RULE_SET_STATUS_BADGE[s.status]}`}>{BONUS_RULE_SET_STATUS_LABEL[s.status]}</span>
                  <span className="mgr-you">с {new Date(s.effectiveFrom).toLocaleDateString('ru-RU')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }}>
        {!selected ? (
          <div className="card"><div className="card-body"><div className="empty">Выберите версию слева</div></div></div>
        ) : (
          <>
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">v{selected.version} · {selected.title}</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {isDraft && (
                    <button className="btn btn-sm btn-secondary" onClick={() => setSetModal({ kind: 'edit', set: selected })}>Изменить</button>
                  )}
                  {!isDraft && (
                    <button className="btn btn-sm btn-secondary" onClick={() => setSetModal({ kind: 'create', cloneFromId: selected.id })}>
                      Создать черновик на основе этой версии
                    </button>
                  )}
                  {isDraft && isFdr && (
                    <button className="btn btn-sm btn-primary" onClick={onActivate}>Активировать</button>
                  )}
                  {selected.status === 'ACTIVE' && isFdr && (
                    <button className="btn btn-sm btn-danger" onClick={onArchive}>Архивировать</button>
                  )}
                </div>
              </div>
              <div className="card-body">
                <div className="detail-row"><div className="detail-label">Статус</div><div className="detail-value"><span className={`badge ${BONUS_RULE_SET_STATUS_BADGE[selected.status]}`}>{BONUS_RULE_SET_STATUS_LABEL[selected.status]}</span></div></div>
                <div className="detail-row"><div className="detail-label">Действует с</div><div className="detail-value">{new Date(selected.effectiveFrom).toLocaleDateString('ru-RU')}</div></div>
                {!isDraft && (
                  <div className="receipt-dropzone-hint" style={{ margin: '10px 0' }}>
                    {selected.status === 'ACTIVE' ? 'Действующая версия редактированию не подлежит.' : 'Архивная версия редактированию не подлежит.'} Чтобы изменить формулы — создайте черновик на её основе.
                  </div>
                )}

                <div className="payments-section-header" style={{ marginTop: 10 }}>
                  <div className="payments-section-title">Правила</div>
                  {isDraft && (
                    <button className="btn btn-sm btn-primary" onClick={() => setRuleModal({ kind: 'create' })}>
                      <Icon name="add" size={15} style={{ marginRight: 4 }} />
                      Добавить правило
                    </button>
                  )}
                </div>

                {selected.rules.length === 0 ? (
                  <div className="empty" style={{ padding: 16 }}>Правил ещё нет</div>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Правило</th><th>Тип</th><th>Область</th><th>Параметры</th>{isDraft && <th>Действия</th>}</tr></thead>
                      <tbody>
                        {selected.rules.map((r) => (
                          <tr key={r.id} style={{ cursor: 'default', opacity: r.enabled ? 1 : 0.5 }}>
                            <td><strong>{r.label}</strong>{!r.enabled && <span className="mgr-you"> (выключено)</span>}</td>
                            <td data-label="Тип">{BONUS_RULE_KIND_LABEL[r.kind]}</td>
                            <td data-label="Область">{BONUS_RULE_SCOPE_LABEL[r.scope]}</td>
                            <td data-label="Параметры">{ruleValueSummary(r)}</td>
                            {isDraft && (
                              <td data-label="Действия">
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button className="btn btn-sm btn-secondary" onClick={() => setRuleModal({ kind: 'edit', rule: r })}>Изменить</button>
                                  <button className="btn btn-sm btn-danger" onClick={() => onRemoveRule(r)}>Удалить</button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <div className="card-header"><h2 className="card-title">Симулятор</h2></div>
              <div className="card-body">
                <div className="receipt-dropzone-hint" style={{ marginBottom: 10 }}>
                  Применяет эту версию формул к закрытому месяцу и показывает разницу по каждому сотруднику. Ничего не записывает в БД — обязательный шаг перед активацией.
                </div>
                <div className="period-controls" style={{ marginBottom: 12 }}>
                  <input type="month" value={simFilters.simPeriod} onChange={(e) => setSimFilter('simPeriod', e.target.value)} max={currentMonthKey()} />
                  <button className="btn btn-sm btn-primary" onClick={onSimulate} disabled={simLoading}>
                    {simLoading ? 'Считаем…' : 'Симулировать'}
                  </button>
                </div>
                {simResult && (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Сотрудник</th><th>Было (v{simResult.ruleSetVersion})</th><th>Стало</th><th>Разница</th></tr></thead>
                      <tbody>
                        {simResult.items.map((it) => (
                          <tr key={it.userId} style={{ cursor: 'default' }}>
                            <td>{it.fullName}</td>
                            <td data-label="Было">{formatMoney(it.before)}</td>
                            <td data-label="Стало">{formatMoney(it.after)}</td>
                            <td data-label="Разница">
                              <strong className={parseFloat(it.diff) > 0 ? 'text-success' : parseFloat(it.diff) < 0 ? 'text-danger' : undefined}>
                                {parseFloat(it.diff) > 0 ? '+' : ''}{formatMoney(it.diff)}
                              </strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </motion.div>

      <AnimatePresence>
        {setModal && (
          <RuleSetFormModal key="set" mode={setModal} onClose={() => setSetModal(null)} onSaved={selectAfterSave} />
        )}
        {ruleModal && selected && ruleModal.kind === 'create' && (
          <BonusRuleFormModal key="rule-create" setId={selected.id} onClose={() => setRuleModal(null)} onSaved={() => getRuleSet(selected.id).then(setSelected)} />
        )}
        {ruleModal && selected && ruleModal.kind === 'edit' && (
          <BonusRuleFormModal
            key="rule-edit"
            setId={selected.id}
            rule={ruleModal.rule}
            onClose={() => setRuleModal(null)}
            onSaved={() => getRuleSet(selected.id).then(setSelected)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
