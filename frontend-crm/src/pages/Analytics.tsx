import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { getPaymentsAnalytics } from '../api/analytics';
import type { AnalyticsPeriodPreset, PaymentsAnalytics } from '../api/types';
import { formatAmount, formatMoney } from '../utils/money';
import { useUrlFilter } from '../hooks/useUrlFilter';
import { staggerContainer } from '../motion';
import StatTile, { type StatDetail } from '../components/StatTile';
import MonthlyChart, { plural } from '../components/MonthlyChart';
import Icon from '../Icon';

/**
 * Финансовая аналитика для руководства (ТЗ 2.6). Доступна только FOUNDER/ADMIN
 * (см. ProtectedRoute в App.tsx и пункт меню в Sidebar.tsx). Контракт данных —
 * backend/src/payments/finance-analytics.service.ts (GET /payments/analytics/summary).
 *
 * Графиков в зависимостях проекта нет (см. package.json) — по правилам волны
 * новую библиотеку не добавляем, визуализация сделана на CSS (горизонтальные
 * бары процентной ширины) и inline SVG (столбцы динамики, MonthlyChart.tsx).
 *
 * Каждая из четырёх плиток сверху кликабельна и раскрывается в расшифровку
 * (StatTile): что означает цифра, за какой период, из чего складывается.
 * Это важно именно здесь: три плитки из четырёх считаются НЕ за выбранный
 * период, а на текущий момент, и раньше об этом говорила только строчка
 * «сейчас, не по периоду» — её читали не все.
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

  const periodLabel = `${range.from.toLocaleDateString('ru-RU')} — ${range.to.toLocaleDateString('ru-RU')}`;
  // Ссылка в «Финансы» повторяет ГРАНИЦЫ периода один в один: там from/to
  // фильтруют по той же дате поступления (paidAt), что и аналитика.
  const paymentsLink = `/finance?status=APPROVED&from=${toDateInputValue(range.from)}&to=${toDateInputValue(range.to)}`;

  const approvedCount = data?.totalApproved.count ?? 0;
  const approvedAmount = toNumber(data?.totalApproved.amount);
  const methodTotal = byMethod.reduce((sum, r) => sum + toNumber(r.amount), 0);

  const SNAPSHOT_PERIOD = 'Срез на текущий момент — выбранный сверху период на эту цифру не влияет.';

  /**
   * Сумма на плитке — крупным числом, «сомони» отдельной мелкой строкой.
   * Через formatMoney целиком слово переносилось на вторую строку тем же
   * 22-пиксельным цветным шрифтом, и «1 264 800,00 / СОМОНИ» читалось как
   * два разных показателя. В модалке места хватает — там сумма как обычно.
   */
  const tileAmount = (value: string) => (
    <>
      {formatAmount(value)} <span className="stat-value-cur">сомони</span>
    </>
  );

  const tiles: Array<{
    label: string;
    value: React.ReactNode;
    modalValue: string;
    hint: string;
    color: string;
    bg: string;
    icon: string;
    detail: StatDetail;
  }> = data
    ? [
        {
          label: 'Поступило за период',
          value: tileAmount(data.totalApproved.amount),
          modalValue: formatMoney(data.totalApproved.amount),
          hint: `${data.totalApproved.count} ${plural(data.totalApproved.count, 'платёж', 'платежа', 'платежей')}`,
          color: '#10b981',
          bg: '#ecfdf5',
          icon: 'payments',
          detail: {
            meaning:
              'Деньги, которые фактически поступили в кассу и на счёт за выбранный период. Единственная плитка здесь, которая считается ЗА ПЕРИОД, а не на текущий момент.',
            period: periodLabel,
            formula:
              'Берутся только платежи со статусом «Проведён» — те, что прошли двойную проверку Основателя. Черновики, платежи на одобрении, отклонённые и аннулированные не входят. Платежи удалённых студентов исключены. Дата — дата поступления денег, а не дата внесения в систему.',
            rowsTitle: 'Разбивка',
            rows: [
              {
                label: 'Платежей за период',
                value: String(approvedCount),
              },
              {
                label: 'Средний платёж',
                value: approvedCount > 0 ? formatMoney((approvedAmount / approvedCount).toFixed(2)) : '—',
              },
              ...byMethod.map((r) => ({
                label: r.label,
                value: formatMoney(r.amount),
                hint: `(${r.count})`,
                share: methodTotal > 0 ? toNumber(r.amount) / methodTotal : 0,
              })),
            ],
            link: { to: paymentsLink, label: 'Открыть платежи' },
          },
        },
        {
          label: 'Ожидает одобрения',
          value: tileAmount(data.pendingApproval.amount),
          modalValue: formatMoney(data.pendingApproval.amount),
          hint: 'сейчас, не по периоду',
          color: '#f59e0b',
          bg: '#fffbeb',
          icon: 'pending_actions',
          detail: {
            meaning:
              'Платежи, которые менеджеры уже внесли, но Основатель ещё не одобрил. Пока платёж стоит в этой очереди, он НЕ считается поступлением и не входит ни в одну сумму выше.',
            period: SNAPSHOT_PERIOD,
            formula: 'Статус «Ожидает одобрения Основателем», по всем студентам, к которым у вас есть доступ.',
            rows: [
              {
                label: 'Платежей в очереди',
                value: String(data.pendingApproval.count),
                tone: data.pendingApproval.count > 0 ? 'warning' : undefined,
              },
            ],
            link: { to: '/finance?tab=pending', label: 'Открыть очередь' },
          },
        },
        {
          label: 'Просрочено',
          value: tileAmount(data.overdue.amount),
          modalValue: formatMoney(data.overdue.amount),
          hint: 'сейчас, не по периоду',
          color: '#ef4444',
          bg: '#fef2f2',
          icon: 'error',
          detail: {
            meaning:
              'Сумма по этапам графика оплат, срок которых уже прошёл, а деньги не пришли или пришли не полностью. Это долг студентов перед компанией на сегодня.',
            period: SNAPSHOT_PERIOD,
            formula:
              'Срок считается по календарным суткам Душанбе: этап со сроком «сегодня» в просрочку не попадает. Непокрытая часть = план этапа минус проведённые по нему платежи.',
            rows: [
              {
                label: 'Просроченных этапов',
                value: String(data.overdue.count),
                tone: data.overdue.count > 0 ? 'danger' : undefined,
              },
            ],
            note:
              'Поимённого списка должников в системе пока нет: просрочка живёт в графике оплат конкретного студента. Откройте карточку студента → раздел «Оплаты» — непокрытые этапы там подсвечены.',
          },
        },
        {
          label: 'Остаток по плану',
          value: tileAmount(data.plannedRemaining.amount),
          modalValue: formatMoney(data.plannedRemaining.amount),
          hint: 'по всем студентам, не по периоду',
          color: '#3b82f6',
          bg: '#eff6ff',
          icon: 'flag',
          detail: {
            meaning:
              'Сколько денег ещё должно прийти по всем графикам оплат: весь план минус всё, что уже проведено. Верхняя граница будущей выручки по текущему портфелю студентов.',
            period: SNAPSHOT_PERIOD,
            formula:
              'Сумма всех этапов графика по всем неудалённым студентам минус уже одобренные платежи по этим этапам. Просроченное входит сюда же — это ещё не полученные деньги.',
            note:
              'Цифра меняется не только от оплат: она растёт, когда заводят нового студента с графиком, и падает, когда график правят или договор расторгают.',
          },
        },
      ]
    : [];

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
              {tiles.map((c) => (
                <StatTile
                  key={c.label}
                  label={c.label}
                  value={c.value}
                  modalValue={c.modalValue}
                  hint={c.hint}
                  color={c.color}
                  bg={c.bg}
                  icon={c.icon}
                  valueFontSize={22}
                  detail={c.detail}
                />
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
              <div className="card-header">
                <h2 className="card-title">Динамика по месяцам</h2>
                <span className="period-range-label">Проведённые поступления, по месяцу даты платежа</span>
              </div>
              <div className="card-body">
                <MonthlyChart points={monthly} />
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
