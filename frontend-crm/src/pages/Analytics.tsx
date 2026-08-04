import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { getPaymentsAnalytics } from '../api/analytics';
import type { AnalyticsPeriodPreset, PaymentsAnalytics } from '../api/types';
import { formatMoney } from '../utils/money';
import { useUrlFilter } from '../hooks/useUrlFilter';
import { fadeUp, staggerContainer } from '../motion';
import Icon from '../Icon';

/**
 * Финансовая аналитика для руководства (ТЗ 2.6). Доступна только FOUNDER/ADMIN
 * (см. ProtectedRoute в App.tsx и пункт меню в Sidebar.tsx). Контракт данных —
 * backend/src/payments/finance-analytics.service.ts (GET /payments/analytics/summary).
 *
 * Графиков в зависимостях проекта нет (см. package.json) — по правилам волны
 * новую библиотеку не добавляем, визуализация сделана на CSS (горизонтальные
 * бары процентной ширины) и inline SVG (спарклайн динамики по месяцам).
 */

const PRESET_OPTIONS: { value: AnalyticsPeriodPreset; label: string; icon: string }[] = [
  { value: 'month', label: 'Месяц', icon: 'calendar_view_month' },
  { value: 'quarter', label: 'Квартал', icon: 'calendar_view_week' },
  { value: 'year', label: 'Год', icon: 'calendar_today' },
  { value: 'custom', label: 'Произвольный', icon: 'date_range' },
];

const QUARTER_OPTIONS = [
  { value: '1', label: 'I квартал (янв–мар)' },
  { value: '2', label: 'II квартал (апр–июн)' },
  { value: '3', label: 'III квартал (июл–сен)' },
  { value: '4', label: 'IV квартал (окт–дек)' },
];

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthRange(ym: string): { from: Date; to: Date } {
  const [y, m] = ym.split('-').map((v) => parseInt(v, 10));
  const year = Number.isFinite(y) ? y : new Date().getFullYear();
  const month = Number.isFinite(m) && m >= 1 && m <= 12 ? m : new Date().getMonth() + 1;
  return { from: new Date(year, month - 1, 1), to: new Date(year, month, 0, 23, 59, 59, 999) };
}

function quarterRange(year: number, quarter: number): { from: Date; to: Date } {
  const q = Math.min(4, Math.max(1, quarter || 1));
  const startMonth = (q - 1) * 3;
  return { from: new Date(year, startMonth, 1), to: new Date(year, startMonth + 3, 0, 23, 59, 59, 999) };
}

function yearRange(year: number): { from: Date; to: Date } {
  return { from: new Date(year, 0, 1), to: new Date(year, 11, 31, 23, 59, 59, 999) };
}

function currentYm(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

type Filters = {
  preset: string;
  ym: string;
  quarter: string;
  year: string;
  from: string;
  to: string;
};

/** Границы периода из URL-фильтров. custom с пустыми датами откатывается на текущий месяц. */
function resolvePeriod(filters: Filters): { from: Date; to: Date } {
  const preset = filters.preset as AnalyticsPeriodPreset;
  if (preset === 'quarter') {
    return quarterRange(parseInt(filters.year, 10) || new Date().getFullYear(), parseInt(filters.quarter, 10) || 1);
  }
  if (preset === 'year') {
    return yearRange(parseInt(filters.year, 10) || new Date().getFullYear());
  }
  if (preset === 'custom') {
    const fallback = monthRange(currentYm());
    const from = filters.from ? new Date(filters.from) : fallback.from;
    const to = filters.to ? new Date(`${filters.to}T23:59:59.999`) : fallback.to;
    return { from, to };
  }
  return monthRange(filters.ym || currentYm());
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map((v) => parseInt(v, 10));
  if (!y || !m || m < 1 || m > 12) return ym;
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

function toNumber(value: string | null | undefined): number {
  const n = parseFloat(value ?? '0');
  return Number.isFinite(n) ? n : 0;
}

function maxOf(values: number[]): number {
  return values.reduce((max, v) => (v > max ? v : max), 0);
}

/** Горизонтальный бар: ширина в % от максимума в своей группе (не от 100%, чтобы отличия были заметны). */
function BarRow({ label, sub, amount, max }: { label: string; sub?: string; amount: string; max: number }) {
  const value = toNumber(amount);
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="analytics-bar-row">
      <div className="analytics-bar-label">
        <span>
          {label}
          {sub && <span className="analytics-bar-sub"> {sub}</span>}
        </span>
        <strong>{formatMoney(amount)}</strong>
      </div>
      <div className="analytics-bar-track">
        <div className="analytics-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: { month: string; amount: string }[] }) {
  const values = points.map((p) => toNumber(p.amount));
  const max = Math.max(1, ...values);
  const width = 600;
  const height = 120;
  const padding = 12;
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const coords = values.map((v, i) => {
    const x = points.length > 1 ? padding + i * stepX : width / 2;
    const y = height - padding - (v / max) * (height - padding * 2);
    return { x, y };
  });
  const polyline = coords.map((c) => `${c.x},${c.y}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="analytics-sparkline" preserveAspectRatio="none">
      {coords.length > 1 && (
        <polyline points={polyline} fill="none" stroke="var(--primary)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
      )}
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={3.5} fill="var(--primary)" />
      ))}
    </svg>
  );
}

export default function Analytics() {
  const defaults = useMemo(
    () => ({
      preset: 'month',
      ym: currentYm(),
      quarter: String(Math.floor(new Date().getMonth() / 3) + 1),
      year: String(new Date().getFullYear()),
      from: '',
      to: '',
    }),
    [],
  );
  const [filters, setFilter, setFilters] = useUrlFilter(defaults);
  const preset = filters.preset as AnalyticsPeriodPreset;

  const [data, setData] = useState<PaymentsAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = resolvePeriod(filters);

  const load = () => {
    setLoading(true);
    setError(null);
    getPaymentsAnalytics({ from: range.from.toISOString(), to: range.to.toISOString() })
      .then(setData)
      .catch((e: any) => {
        setData(null);
        setError(e?.response?.data?.message || 'Не удалось загрузить аналитику');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.preset, filters.ym, filters.quarter, filters.year, filters.from, filters.to]);

  const onPresetChange = (p: AnalyticsPeriodPreset) => {
    if (p === 'custom' && !filters.from && !filters.to) {
      // При первом переключении на «произвольный» подставляем текущий месяц,
      // чтобы поля дат не были пустыми и запрос сразу ушёл с валидным диапазоном.
      setFilters({ preset: p, from: toDateInputValue(range.from), to: toDateInputValue(range.to) });
      return;
    }
    setFilter('preset', p);
  };

  /**
   * Массивы читаем ЧЕРЕЗ ФОЛБЭК, а не напрямую.
   *
   * Прямое `data.byManager.map(...)` роняло весь экран аналитики у каждого
   * Администратора: бэкенд намеренно не отдаёт ему поимённый срез сборов
   * (кадровые данные, см. finance-analytics.controller.ts), а страница считала
   * поле обязательным. Одно отсутствующее поле не должно стоить пользователю
   * всей страницы — тем более что остальные пять блоков он видеть вправе.
   */
  const byStage = data?.byStage ?? [];
  const byPurpose = data?.byPurpose ?? [];
  const byMethod = data?.byMethod ?? [];
  const byManager = data?.byManager ?? null;
  const monthly = data?.monthly ?? [];

  const stageMax = maxOf(byStage.map((r) => toNumber(r.amount)));
  const purposeMax = maxOf(byPurpose.map((r) => toNumber(r.amount)));
  const methodMax = maxOf(byMethod.map((r) => toNumber(r.amount)));
  const managerMax = maxOf((byManager ?? []).map((r) => toNumber(r.amount)));

  return (
    <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="card-header">
        <h2 className="card-title">Финансовая аналитика</h2>
      </div>
      <div className="card-body">
        <div className="period-picker">
          <div className="scope-switch">
            {PRESET_OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`scope-btn${preset === o.value ? ' active' : ''}`}
                onClick={() => onPresetChange(o.value)}
              >
                <Icon name={o.icon} size={16} />
                {o.label}
              </button>
            ))}
          </div>

          <div className="period-controls">
            {preset === 'month' && (
              <input type="month" value={filters.ym} onChange={(e) => setFilter('ym', e.target.value)} />
            )}
            {preset === 'quarter' && (
              <>
                <select value={filters.quarter} onChange={(e) => setFilter('quarter', e.target.value)}>
                  {QUARTER_OPTIONS.map((q) => (
                    <option key={q.value} value={q.value}>{q.label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  value={filters.year}
                  onChange={(e) => setFilter('year', e.target.value)}
                  min={2000}
                  max={2100}
                  style={{ width: 100 }}
                />
              </>
            )}
            {preset === 'year' && (
              <input
                type="number"
                value={filters.year}
                onChange={(e) => setFilter('year', e.target.value)}
                min={2000}
                max={2100}
                style={{ width: 100 }}
              />
            )}
            {preset === 'custom' && (
              <>
                <input
                  type="date"
                  value={filters.from || toDateInputValue(range.from)}
                  onChange={(e) => setFilter('from', e.target.value)}
                  title="Начало периода"
                />
                <input
                  type="date"
                  value={filters.to || toDateInputValue(range.to)}
                  onChange={(e) => setFilter('to', e.target.value)}
                  title="Конец периода"
                />
              </>
            )}
          </div>

          <div className="period-range-label">
            {range.from.toLocaleDateString('ru-RU')} — {range.to.toLocaleDateString('ru-RU')}
          </div>
        </div>

        {error && (
          <div className="error-banner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span>{error}</span>
            <button className="btn btn-sm btn-secondary" onClick={load}>Повторить</button>
          </div>
        )}

        {loading ? (
          <div className="empty">Загрузка...</div>
        ) : !data ? (
          !error ? (
            <div className="empty">
              <div className="empty-icon"><Icon name="query_stats" size={48} /></div>
              Нет данных за период
            </div>
          ) : null
        ) : (
          <>
            <motion.div className="stats-grid" variants={staggerContainer} initial="hidden" animate="show">
              {[
                {
                  label: 'Поступило за период',
                  value: data.totalApproved.amount,
                  hint: `${data.totalApproved.count} ${data.totalApproved.count === 1 ? 'платёж' : 'платежей'}`,
                  color: '#10b981',
                  bg: '#ecfdf5',
                  icon: 'payments',
                },
                {
                  label: 'Ожидает одобрения',
                  value: data.pendingApproval.amount,
                  hint: 'сейчас, не по периоду',
                  color: '#f59e0b',
                  bg: '#fffbeb',
                  icon: 'pending_actions',
                },
                {
                  label: 'Просрочено',
                  value: data.overdue.amount,
                  hint: 'сейчас, не по периоду',
                  color: '#ef4444',
                  bg: '#fef2f2',
                  icon: 'error',
                },
                {
                  label: 'Остаток по плану',
                  value: data.plannedRemaining.amount,
                  hint: 'по всем студентам, не по периоду',
                  color: '#3b82f6',
                  bg: '#eff6ff',
                  icon: 'flag',
                },
              ].map((c) => (
                <motion.div key={c.label} className="stat-card" variants={fadeUp} whileHover={{ y: -4, transition: { duration: 0.2 } }}>
                  <div className="stat-icon-row">
                    <div>
                      <div className="stat-label">{c.label}</div>
                      <div className="stat-value" style={{ color: c.color, fontSize: 22 }}>{formatMoney(c.value)}</div>
                      <div className="analytics-bar-sub" style={{ marginTop: 4 }}>{c.hint}</div>
                    </div>
                    <div className="stat-icon" style={{ background: c.bg, color: c.color }}>
                      <Icon name={c.icon} size={24} />
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 18, marginTop: 4 }}>
              <div className="card" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
                <div className="card-header"><h2 className="card-title">Разбивка по этапам оплаты</h2></div>
                <div className="card-body">
                  {byStage.length === 0 ? (
                    <div className="empty">Нет данных</div>
                  ) : (
                    byStage.map((r) => (
                      <BarRow
                        key={r.stage}
                        label={r.label}
                        sub={`(${r.count})`}
                        amount={r.amount}
                        max={stageMax}
                      />
                    ))
                  )}
                </div>
              </div>

              <div className="card" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
                <div className="card-header"><h2 className="card-title">Разбивка по назначению</h2></div>
                <div className="card-body">
                  {byPurpose.length === 0 ? (
                    <div className="empty">Нет данных</div>
                  ) : (
                    byPurpose.map((r) => (
                      <BarRow
                        key={r.purpose}
                        label={r.label}
                        sub={`(${r.count})`}
                        amount={r.amount}
                        max={purposeMax}
                      />
                    ))
                  )}
                </div>
              </div>

              <div className="card" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
                <div className="card-header"><h2 className="card-title">Наличные против безнала</h2></div>
                <div className="card-body">
                  {byMethod.length === 0 ? (
                    <div className="empty">Нет данных</div>
                  ) : (
                    byMethod.map((r) => (
                      <BarRow
                        key={r.method}
                        label={r.label}
                        sub={`(${r.count})`}
                        amount={r.amount}
                        max={methodMax}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Блока нет вовсе, если сервер не отдал срез: поимённые сборы
                  видит только Основатель. Показывать Администратору пустую
                  карточку с надписью «Нет данных» было бы враньём — данные
                  есть, просто не для него. */}
              {byManager && (
                <div className="card" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
                  <div className="card-header"><h2 className="card-title">Топ менеджеров по собранным суммам</h2></div>
                  <div className="card-body">
                    {byManager.length === 0 ? (
                      <div className="empty">Нет данных</div>
                    ) : (
                      byManager.map((r) => (
                        <BarRow
                          key={r.managerId ?? 'none'}
                          label={r.managerName}
                          sub={`(${r.count} ${r.count === 1 ? 'платёж' : 'платежей'})`}
                          amount={r.amount}
                          max={managerMax}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="card" style={{ boxShadow: 'none', border: '1px solid var(--border)', marginTop: 18 }}>
              <div className="card-header"><h2 className="card-title">Динамика по месяцам</h2></div>
              <div className="card-body">
                {monthly.length === 0 ? (
                  <div className="empty">Нет данных</div>
                ) : (
                  <>
                    <Sparkline points={monthly} />
                    <div className="analytics-month-list">
                      {monthly.map((p) => (
                        <div className="analytics-month-item" key={p.month}>
                          <span>{monthLabel(p.month)}</span>
                          <strong>{formatMoney(p.amount)}</strong>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
