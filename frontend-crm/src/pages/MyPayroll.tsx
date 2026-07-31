import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { KpiMetric, Payslip, PayrollMyKpi, PayrollPreview } from '../api/types';
import { KPI_METRIC_LABEL, KPI_RATE_METRICS } from '../api/types';
import { getMyKpi, getMyPreview, listMyPayslips } from '../api/payroll';
import { useRealtime } from '../realtime';
import { useUrlFilter } from '../hooks/useUrlFilter';
import { currentMonthKey } from '../utils/datetime';
import { formatMoney, formatPercent } from '../utils/money';
import Pagination from '../components/Pagination';
import PayslipStatusBadge from '../components/PayslipStatusBadge';
import PayslipDetailModal from '../components/PayslipDetailModal';
import Icon from '../Icon';
import { fadeUp, staggerContainer } from '../motion';

const PAGE_SIZE = 12;
// Не чаще раза в 30 секунд — «в реальном времени» не значит «пересчитывать
// на каждое событие»: KPI за текущий (незакрытый) месяц не обязаны быть
// точны до секунды (тот же приём, что TTL-кэш на бэкенде).
const REALTIME_THROTTLE_MS = 30_000;

function monthInputLabel(period: string): string {
  const [y, m] = period.split('-').map((v) => parseInt(v, 10));
  if (!y || !m) return period;
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${MONTHS[m - 1]} ${y}`;
}

/** metric-специфичное форматирование «сырого» значения из /payroll/me/kpi: доли -> проценты, счётчики -> число без хвоста нулей. */
function formatMetricRaw(metric: KpiMetric, raw: string | null): string {
  if (raw === null) return '—';
  if (KPI_RATE_METRICS.includes(metric)) return formatPercent(raw);
  const n = parseFloat(raw);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : raw;
}

function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map((v) => parseInt(v, 10));
  if (!y || !m) return currentMonthKey();
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Полоса прогресса к порогу премии. value/threshold — в одинаковых единицах (обе доли либо оба счётчика). */
function ProgressBar({ value, threshold, reached }: { value: string | null; threshold: string; reached: boolean }) {
  if (value === null) {
    return <div className="receipt-dropzone-hint" style={{ margin: 0 }}>Нет данных для расчёта в этом периоде</div>;
  }
  const v = parseFloat(value);
  const t = parseFloat(threshold);
  const pct = t > 0 ? Math.min(100, Math.max(v > 0 ? 3 : 0, Math.round((v / t) * 100))) : 0;
  return (
    <div className="payment-stage-progress" style={{ height: 8 }}>
      <div
        className="payment-stage-progress-fill"
        style={{ width: `${pct}%`, background: reached ? 'linear-gradient(90deg, var(--success), #34d399)' : 'linear-gradient(90deg, var(--info), #60a5fa)' }}
      />
    </div>
  );
}

/**
 * ТЗ 5.2 «интерфейс сотрудника» — своя страница с прогрессом по 4 KPI (ТЗ
 * 5.1) за расчётный период и предварительным расчётом зарплаты за текущий
 * месяц. Доступна всем ролям — каждый видит СТРОГО свои данные (userId
 * берётся на бэкенде из JWT, эта страница ни разу не запрашивает чужой id).
 */
export default function MyPayroll() {
  const defaults = useMemo(() => ({ period: currentMonthKey() }), []);
  const [filters, setFilter] = useUrlFilter(defaults);
  const period = filters.period || currentMonthKey();
  const isCurrentPeriod = period === currentMonthKey();

  const [kpi, setKpi] = useState<PayrollMyKpi | null>(null);
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<Payslip[]>([]);
  const [detail, setDetail] = useState<Payslip | null>(null);

  const loadPeriodData = () => {
    setLoading(true);
    Promise.all([getMyKpi(period), getMyPreview(period)])
      .then(([k, p]) => { setKpi(k); setPreview(p); setUpdatedAt(new Date()); })
      .catch(() => { setKpi(null); setPreview(null); })
      .finally(() => setLoading(false));
  };

  useEffect(loadPeriodData, [period]);

  const loadPayslips = () => {
    listMyPayslips({ page, pageSize: PAGE_SIZE }).then((res) => { setPayslips(res.items); setTotal(res.total); }).catch(() => {});
  };
  useEffect(loadPayslips, [page]);

  // Собственная динамика итога за последние месяцы — только свои данные,
  // никаких рейтингов и чужих сумм (см. accessModel проекта архитектора).
  useEffect(() => {
    listMyPayslips({ page: 1, pageSize: 6 })
      .then((res) => setHistory([...res.items].reverse()))
      .catch(() => setHistory([]));
  }, []);

  const lastLoadRef = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = () => {
    const now = Date.now();
    const elapsed = now - lastLoadRef.current;
    if (elapsed >= REALTIME_THROTTLE_MS) {
      lastLoadRef.current = now;
      loadPeriodData();
    } else if (!pendingRef.current) {
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        lastLoadRef.current = Date.now();
        loadPeriodData();
      }, REALTIME_THROTTLE_MS - elapsed);
    }
  };
  useRealtime({
    'payment:approved': scheduleReload,
    'payment:voided': scheduleReload,
    'contract:updated': scheduleReload,
    'consultation:new': scheduleReload,
    'consultation:updated': scheduleReload,
    'application:updated': scheduleReload,
    'payslip:updated': () => { loadPayslips(); scheduleReload(); },
  });

  const statCards = kpi
    ? [
        {
          label: 'Обработано лидов / консультаций',
          value: `${kpi.leadsProcessed} / ${kpi.consultationsHeld}`,
          icon: 'record_voice_over',
          color: '#3b82f6',
          bg: '#eff6ff',
        },
        {
          label: 'Конверсия в договор',
          value: formatPercent(kpi.conversionRate),
          icon: 'handshake',
          color: '#10b981',
          bg: '#ecfdf5',
        },
        {
          label: 'Своевременность оплат',
          value: formatPercent(kpi.timelinessRate),
          icon: 'schedule',
          color: '#f59e0b',
          bg: '#fffbeb',
        },
        {
          label: 'Доведение: зачисление / переезд',
          value: `${kpi.enrolledCount} / ${kpi.relocatedCount} (${formatPercent(kpi.deliveryRate)})`,
          icon: 'flight_takeoff',
          color: '#d52b2b',
          bg: '#fff0f0',
        },
      ]
    : [];

  const historyMax = Math.max(1, ...history.map((p) => parseFloat(p.totalAmount) || 0));

  return (
    <div>
      <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="card-header">
          <h2 className="card-title">Моя зарплата</h2>
          <div className="period-controls">
            <button className="btn btn-sm btn-secondary" onClick={() => setFilter('period', shiftPeriod(period, -1))}>
              <Icon name="chevron_left" size={16} />
            </button>
            <input type="month" value={period} onChange={(e) => setFilter('period', e.target.value)} max={currentMonthKey()} />
            <button className="btn btn-sm btn-secondary" disabled={isCurrentPeriod} onClick={() => setFilter('period', shiftPeriod(period, 1))}>
              <Icon name="chevron_right" size={16} />
            </button>
          </div>
        </div>

        <div className="card-body">
          {kpi && (
            <div className="receipt-dropzone-hint" style={{ marginBottom: 14 }}>
              Метрики раздела «Зарплата» ведутся с {new Date(kpi.metricsSince).toLocaleDateString('ru-RU')} — до этой даты показателей в системе нет.
              {updatedAt && ` Обновлено в ${updatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`}
            </div>
          )}

          {loading ? (
            <div className="empty">Загрузка...</div>
          ) : !kpi || !preview ? (
            <div className="empty">Нет данных за выбранный период</div>
          ) : (
            <>
              <motion.div className="stats-grid" variants={staggerContainer} initial="hidden" animate="show">
                {statCards.map((c) => (
                  <motion.div key={c.label} className="stat-card" variants={fadeUp}>
                    <div className="stat-icon-row">
                      <div>
                        <div className="stat-label">{c.label}</div>
                        <div className="stat-value" style={{ color: c.color, fontSize: 22 }}>{c.value}</div>
                      </div>
                      <div className="stat-icon" style={{ background: c.bg, color: c.color }}>
                        <Icon name={c.icon} size={24} />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </motion.div>

              {kpi.team && (
                <div className="receipt-dropzone-hint" style={{ marginTop: 8 }}>
                  Командный показатель «{KPI_METRIC_LABEL[kpi.team.metric]}» за период: <strong>{formatMetricRaw(kpi.team.metric, kpi.team.value)}</strong>
                  {' '}(порог премии — {formatMetricRaw(kpi.team.metric, kpi.team.threshold)}).
                </div>
              )}

              {kpi.progress.length > 0 && (
                <>
                  <div className="payments-block-title">Прогресс к премиям</div>
                  <div className="payment-stage-grid">
                    {kpi.progress.map((p) => (
                      <div key={p.ruleId} className="payment-stage-card">
                        <div className="payment-stage-card-head">
                          <div className="payment-stage-card-title">{p.label}</div>
                          {p.reached ? (
                            <span className="badge badge-success">Достигнуто</span>
                          ) : (
                            <span className="badge badge-gray">В процессе</span>
                          )}
                        </div>
                        <ProgressBar value={p.value} threshold={p.threshold} reached={p.reached} />
                        <div className="receipt-dropzone-hint" style={{ margin: 0 }}>
                          {p.reached
                            ? `Премия ${p.reward ?? ''} начислится в расчёте`
                            : p.value !== null
                              ? `Сейчас: ${formatMetricRaw(p.metric, p.value)} из ${formatMetricRaw(p.metric, p.threshold)} — осталось ${formatMetricRaw(p.metric, p.remaining)} до премии ${p.reward ?? ''}`
                              : `Метрика «${KPI_METRIC_LABEL[p.metric]}» пока не набрала данных`}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="payments-block-title">Предварительный расчёт за {monthInputLabel(period)}</div>
              <div className="payroll-preview-banner">
                <Icon name="info" size={20} />
                <div>
                  <strong>ПРЕДВАРИТЕЛЬНО.</strong> Итог может измениться до утверждения руководством — это не обещанная сумма.
                </div>
              </div>

              {preview.breakdown.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table className="table">
                    <thead><tr><th>Правило</th><th>База</th><th>Сумма</th></tr></thead>
                    <tbody>
                      {preview.breakdown.map((l) => (
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

              <div className="payments-totals" style={{ marginTop: 12 }}>
                <div><span>Оклад</span><strong>{formatMoney(preview.baseAmount)}</strong></div>
                <div><span>Бонус</span><strong className="text-success">{formatMoney(preview.bonusAmount)}</strong></div>
                <div><span>Премия KPI</span><strong className="text-success">{formatMoney(preview.kpiBonusAmount)}</strong></div>
                <div><span>Итого (предварительно)</span><strong style={{ fontSize: 18 }}>{formatMoney(preview.totalAmount)}</strong></div>
              </div>
            </>
          )}

          {history.length > 1 && (
            <>
              <div className="payments-block-title">Динамика итога за последние месяцы</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {history.map((p) => (
                  <div key={p.id} className="analytics-bar-row">
                    <div className="analytics-bar-label">
                      <span>{p.periodKey}{p.status === 'VOID' ? ' (аннулирован)' : ''}</span>
                      <strong>{formatMoney(p.totalAmount)}</strong>
                    </div>
                    <div className="analytics-bar-track">
                      <div
                        className="analytics-bar-fill"
                        style={{ width: `${Math.max(2, Math.round((parseFloat(p.totalAmount) / historyMax) * 100))}%`, opacity: p.status === 'VOID' ? 0.35 : 1 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </motion.div>

      <motion.div className="card" style={{ marginTop: 18 }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}>
        <div className="card-header"><h2 className="card-title">Мои расчётные листы</h2></div>
        <div className="card-body">
          {payslips.length === 0 ? (
            <div className="empty">
              <div className="empty-icon"><Icon name="receipt_long" size={48} /></div>
              Утверждённых листов пока нет
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Период</th><th>Оклад</th><th>Бонус</th><th>Премия KPI</th><th>Итого</th><th>Статус</th></tr></thead>
                <tbody>
                  {payslips.map((p) => (
                    <tr key={p.id} onClick={() => setDetail(p)} style={{ cursor: 'pointer', opacity: p.status === 'VOID' ? 0.6 : 1 }}>
                      <td>{p.periodKey}</td>
                      <td data-label="Оклад" style={p.status === 'VOID' ? { textDecoration: 'line-through' } : undefined}>{formatMoney(p.baseAmount)}</td>
                      <td data-label="Бонус" style={p.status === 'VOID' ? { textDecoration: 'line-through' } : undefined}>{formatMoney(p.bonusAmount)}</td>
                      <td data-label="Премия KPI" style={p.status === 'VOID' ? { textDecoration: 'line-through' } : undefined}>{formatMoney(p.kpiBonusAmount)}</td>
                      <td data-label="Итого" style={p.status === 'VOID' ? { textDecoration: 'line-through' } : undefined}><strong>{formatMoney(p.totalAmount)}</strong></td>
                      <td data-label="Статус"><PayslipStatusBadge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
        </div>
      </motion.div>

      <AnimatePresence>
        {detail && <PayslipDetailModal key="detail" payslip={detail} onClose={() => setDetail(null)} />}
      </AnimatePresence>
    </div>
  );
}
