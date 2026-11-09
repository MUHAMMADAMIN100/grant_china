import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Icon from '../Icon';
import { useAuth } from '../store/auth';
import { listUsers } from '../api/users';
import { isPrivileged, type User } from '../api/types';
import { getSalesAnalytics, type SalesAnalytics, type SalesPeriodKey } from '../api/salesAnalytics';
import { formatAmount } from '../utils/money';
import { useUrlFilter } from '../hooks/useUrlFilter';

/**
 * 09.11.2026 — Аналитика → «Продажи» (образец владельца, дизайн GrantChina).
 * Графики нарисованы вручную на SVG, без библиотек: тонкие линии и столбцы,
 * подписи значений прямо на графике, подсказка при наведении; у графика по
 * месяцам есть таблица. Цвета данных — проверенная палитра (синий — одна
 * серия), красный бренда остаётся за кнопками и статусом «плохо».
 */

const PERIODS: Array<{ value: SalesPeriodKey; label: string; prev: string }> = [
  { value: 'today', label: 'Сегодня', prev: 'к вчера' },
  { value: 'week', label: 'Неделя', prev: 'к прошлой неделе' },
  { value: 'month', label: 'Месяц', prev: 'к прошлому месяцу' },
  { value: 'year', label: 'Год', prev: 'к прошлому году' },
];

const SERIES = '#2a78d6';
const SERIES_SOFT = '#cde2fb';
const SOURCE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const OTHER_COLOR = '#a3a9b6';
const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' };
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const num = (n: number) => n.toLocaleString('ru-RU');
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`);
const toNum = (s: string | null | undefined) => {
  const n = parseFloat(s ?? '0');
  return Number.isFinite(n) ? n : 0;
};
const minutesText = (m: number | null) => {
  if (m === null) return '—';
  if (m < 1) return 'меньше минуты';
  if (m < 60) return `${Math.round(m)} мин`;
  const h = m / 60;
  return h < 24 ? `${h.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ч` : `${(h / 24).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} дн`;
};
const monthTitle = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_FULL[m - 1]} ${y}`;
};

/** Изменение к прошлому периоду. up = хорошо для всех четырёх плиток. */
function Delta({ cur, prev, kind, prevLabel }: { cur: number | null; prev: number | null; kind: 'count' | 'points'; prevLabel: string }) {
  if (cur === null || prev === null) return <span className="sa-delta flat">{prevLabel}: нет данных</span>;
  let text: string;
  let dir: 'up' | 'down' | 'flat';
  if (kind === 'points') {
    const d = Math.round((cur - prev) * 10) / 10;
    dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    text = d === 0 ? 'без изменений' : `${d > 0 ? '+' : ''}${d.toLocaleString('ru-RU')} п.п.`;
  } else if (prev === 0) {
    // Процент от нуля не посчитать — показываем прирост в штуках/сомони.
    dir = cur > 0 ? 'up' : 'flat';
    text = cur > 0 ? `+${cur.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}` : 'без изменений';
  } else {
    const d = Math.round(((cur - prev) / prev) * 1000) / 10;
    dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    text = d === 0 ? 'без изменений' : `${d > 0 ? '+' : ''}${d.toLocaleString('ru-RU')}%`;
  }
  return (
    <span className={`sa-delta ${dir}`} title={`Сравнение: ${prevLabel}`}>
      <Icon name={dir === 'up' ? 'trending_up' : dir === 'down' ? 'trending_down' : 'trending_flat'} size={16} />
      <b>{text}</b> {prevLabel}
    </span>
  );
}

function Kpi({ label, icon, value, sub, delta, testId }: { label: string; icon: string; value: string; sub?: string; delta?: React.ReactNode; testId: string }) {
  return (
    <div className="sa-kpi" data-testid={testId}>
      <div className="sa-kpi-head">
        <span className="sa-kpi-label">{label}</span>
        <span className="sa-kpi-icon">
          <Icon name={icon} size={20} />
        </span>
      </div>
      <div className="sa-kpi-value">{value}</div>
      {sub && <div className="sa-kpi-sub">{sub}</div>}
      {delta}
    </div>
  );
}

function Panel({ title, hint, children, className, action, testId }: { title: string; hint?: string; children: React.ReactNode; className?: string; action?: React.ReactNode; testId?: string }) {
  return (
    <section className={`sa-panel${className ? ` ${className}` : ''}`} data-testid={testId}>
      <header className="sa-panel-head">
        <div>
          <h3>{title}</h3>
          {hint && <p>{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Линия конверсии по месяцам: перекрестие и подсказка при наведении, таблица по кнопке. */
function ConversionLine({ data }: { data: SalesAnalytics['monthly'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  // Ширина рисунка = ширине блока: на телефоне график перестраивается, а не
  // сжимается целиком (иначе подписи осей становились по 5–6 пикселей).
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const narrow = W < 480;
  const H = narrow ? 200 : 230;
  const pad = { l: 40, r: 16, t: 16, b: 28 };
  const values = data.map((d) => d.conversion);
  const maxV = Math.max(10, ...values.map((v) => v ?? 0));
  const top = maxV <= 20 ? Math.ceil(maxV / 5) * 5 : maxV <= 50 ? Math.ceil(maxV / 10) * 10 : Math.ceil(maxV / 20) * 20;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (data.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const ticks = [0, top / 2, top];
  // Месяцы без заявок — разрыв линии, а не провал в ноль.
  const segments: Array<Array<[number, number]>> = [];
  let curSeg: Array<[number, number]> = [];
  data.forEach((d, i) => {
    if (d.conversion === null) {
      if (curSeg.length) segments.push(curSeg);
      curSeg = [];
    } else curSeg.push([x(i), y(d.conversion)]);
  });
  if (curSeg.length) segments.push(curSeg);
  const lastIdx = values.map((v, i) => (v === null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="sa-chart-wrap">
      <div className="sa-chart-tools">
        <button type="button" className={`sa-link${table ? ' on' : ''}`} onClick={() => setTable((v) => !v)} data-testid="sa-line-table-toggle">
          <Icon name={table ? 'show_chart' : 'table_rows'} size={16} /> {table ? 'График' : 'Таблица'}
        </button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="table sa-table" data-testid="sa-line-table">
            <thead>
              <tr>
                <th>Месяц</th>
                <th>Заявок</th>
                <th>Из них зачислено</th>
                <th>Конверсия</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.month}>
                  <td>{monthTitle(d.month)}</td>
                  <td>{num(d.leads)}</td>
                  <td>{num(d.converted)}</td>
                  <td>{pct(d.conversion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sa-svg-box" ref={boxRef} onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="sa-svg" role="img" aria-label="Конверсия заявок по месяцам" data-testid="sa-line">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="sa-gridline" />
                <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="sa-axis">
                  {t}%
                </text>
              </g>
            ))}
            {data.map((d, i) =>
              narrow && (data.length - 1 - i) % 2 ? null : (
                <text key={d.month} x={x(i)} y={H - 8} textAnchor="middle" className="sa-axis">
                  {MONTHS[Number(d.month.slice(5)) - 1]}
                </text>
              ),
            )}
            {segments.map((seg, i) => (
              <g key={i}>
                {seg.length > 1 && (
                  <path
                    d={`M${seg[0][0]},${y(0)} ${seg.map(([a, b]) => `L${a},${b}`).join(' ')} L${seg[seg.length - 1][0]},${y(0)} Z`}
                    fill={SERIES}
                    opacity={0.1}
                  />
                )}
                <polyline points={seg.map(([a, b]) => `${a},${b}`).join(' ')} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              </g>
            ))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="sa-crosshair" />}
            {data.map((d, i) =>
              d.conversion === null ? null : (
                <circle key={d.month} cx={x(i)} cy={y(d.conversion)} r={hover === i || i === lastIdx ? 5 : 3.5} fill={SERIES} stroke="#fff" strokeWidth={2} />
              ),
            )}
            {lastIdx >= 0 && hover === null && (
              // Подпись с той стороны точки, где нет линии: пришла сверху — пишем снизу.
              <text
                x={x(lastIdx) - 10}
                y={(values[lastIdx - 1] ?? -1) > values[lastIdx]! ? y(values[lastIdx]!) + 18 : y(values[lastIdx]!) - 10}
                textAnchor="end"
                className="sa-endlabel"
              >
                {pct(values[lastIdx])}
              </text>
            )}
            {data.map((d, i) => (
              <rect
                key={`hit-${d.month}`}
                x={x(i) - (W - pad.l - pad.r) / (data.length - 1) / 2}
                y={pad.t}
                width={(W - pad.l - pad.r) / (data.length - 1)}
                height={H - pad.t - pad.b}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onTouchStart={() => setHover(i)}
                data-testid="sa-line-hit"
              />
            ))}
          </svg>
          {h && hover !== null && (
            <div
              className="sa-tip"
              // У краёв подсказка прижимается внутрь графика, а не вылезает за экран.
              style={{ left: `${(x(hover) / W) * 100}%`, transform: x(hover) / W < 0.3 ? 'translateX(-12px)' : x(hover) / W > 0.7 ? 'translateX(calc(-100% + 12px))' : 'translateX(-50%)' }}
              data-testid="sa-tip"
            >
              <b>{monthTitle(h.month)}</b>
              <span>Конверсия: {pct(h.conversion)}</span>
              <span>
                Заявок: {num(h.leads)}, зачислено: {num(h.converted)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Источники лидов: кольцо + легенда с числом и долей. Больше пяти — «Другие». */
function SourcesDonut({ data }: { data: SalesAnalytics['sources'] }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = data.reduce((s, x) => s + x.count, 0);
  const top = data.slice(0, 5);
  const rest = data.slice(5);
  // Цвет закреплён за источником, а не за местом в рейтинге: смена периода
  // не перекрашивает Instagram в цвет Сайта. Частые источники — свои цвета,
  // остальные берут свободный из той же проверенной пятёрки.
  const fixed: Record<string, string> = { INSTAGRAM: SOURCE_COLORS[0], WEBSITE: SOURCE_COLORS[1], REFERRAL: SOURCE_COLORS[2], TELEGRAM: SOURCE_COLORS[3], OFFICE_VISIT: SOURCE_COLORS[4] };
  const used = new Set(top.map((x) => fixed[x.code]).filter(Boolean));
  const free = SOURCE_COLORS.filter((c) => !used.has(c));
  const colorOf = (code: string) => (code === 'NONE' ? OTHER_COLOR : fixed[code] ?? free.shift() ?? OTHER_COLOR);
  const items = [
    ...top.map((x) => ({ ...x, color: colorOf(x.code) })),
    ...(rest.length ? [{ code: 'OTHER_GROUP', label: `Другие (${rest.length})`, count: rest.reduce((s, x) => s + x.count, 0), color: '#d1d5db' }] : []),
  ];
  // «Не указан» — серым, чтобы не выглядел настоящим источником.
  const R = 70;
  const r = 46;
  const C = 90;
  let a0 = -Math.PI / 2;
  const arcs = items.map((it) => {
    const frac = total ? it.count / total : 0;
    const a1 = a0 + frac * Math.PI * 2;
    const gap = items.length > 1 ? 0.012 : 0;
    const s = a0 + gap;
    const e = Math.max(s, a1 - gap);
    const large = e - s > Math.PI ? 1 : 0;
    const p = (rad: number, ang: number) => `${C + rad * Math.cos(ang)},${C + rad * Math.sin(ang)}`;
    const d = frac >= 0.9999
      ? `M${C},${C - R} A${R},${R} 0 1 1 ${C - 0.01},${C - R} L${C - 0.01},${C - r} A${r},${r} 0 1 0 ${C},${C - r} Z`
      : `M${p(R, s)} A${R},${R} 0 ${large} 1 ${p(R, e)} L${p(r, e)} A${r},${r} 0 ${large} 0 ${p(r, s)} Z`;
    a0 = a1;
    return { ...it, d, frac };
  });
  if (!total) return <div className="sa-empty">Заявок за период нет</div>;
  const hv = arcs.find((x) => x.code === hover);
  return (
    <div className="sa-donut">
      <svg viewBox="0 0 180 180" className="sa-donut-svg" role="img" aria-label="Источники лидов" data-testid="sa-donut">
        {arcs.map((a) => (
          <path key={a.code} d={a.d} fill={a.color} opacity={hover && hover !== a.code ? 0.35 : 1} onMouseEnter={() => setHover(a.code)} onMouseLeave={() => setHover(null)} />
        ))}
        <text x={C} y={C - 2} textAnchor="middle" className="sa-donut-total">
          {hv ? num(hv.count) : num(total)}
        </text>
        <text x={C} y={C + 16} textAnchor="middle" className="sa-axis">
          {hv ? pct(Math.round(hv.frac * 1000) / 10) : 'заявок'}
        </text>
      </svg>
      <ul className="sa-legend" data-testid="sa-sources">
        {arcs.map((a) => (
          <li key={a.code} onMouseEnter={() => setHover(a.code)} onMouseLeave={() => setHover(null)} className={hover === a.code ? 'on' : ''}>
            <span className="sa-swatch" style={{ background: a.color }} />
            <span className="sa-legend-label">{a.label}</span>
            <b>{num(a.count)}</b>
            <span className="sa-legend-pct">{pct(Math.round(a.frac * 1000) / 10)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Горизонтальные столбцы с подписью значения у конца. */
function Bars({ rows, color = SERIES, testId }: { rows: Array<{ key: string; label: string; value: number; text?: string; sub?: string; muted?: boolean }>; color?: string; testId?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="sa-bars" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${r.text ?? num(r.value)}`}>
          <div className="sa-bar-label">
            <span>{r.label}</span>
            {r.sub && <span className="sa-bar-sub">{r.sub}</span>}
          </div>
          <div className="sa-bar-line">
            <div className="sa-bar-track">
              <div className="sa-bar-fill" style={{ width: `${r.value ? Math.max(2, (r.value / max) * 100) : 0}%`, background: r.muted ? OTHER_COLOR : color }} />
            </div>
            <b className="sa-bar-value">{r.text ?? num(r.value)}</b>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Скорость ответа: полукруг-шкала до часа, цвет — состояние (со значком и словом, не только цветом). */
function ResponseGauge({ data }: { data: SalesAnalytics['response'] }) {
  const m = data.medianMinutes;
  if (!data.asks) return <div className="sa-empty">Обращений в чатах за период не было</div>;
  const state = m === null ? null : m <= 5 ? 'good' : m <= 30 ? 'warning' : 'critical';
  const word = state === 'good' ? 'Быстро' : state === 'warning' ? 'Нормально' : state === 'critical' ? 'Медленно' : 'Нет ответов';
  const icon = state === 'good' ? 'bolt' : state === 'warning' ? 'schedule' : 'hourglass_bottom';
  const frac = m === null ? 0 : Math.min(1, m / 60);
  const R = 70;
  const C = { x: 90, y: 86 };
  const pt = (f: number) => `${C.x - R * Math.cos(Math.PI * f)},${C.y - R * Math.sin(Math.PI * f)}`;
  return (
    <div className="sa-gauge" data-testid="sa-gauge">
      <svg viewBox="0 0 180 112" className="sa-gauge-svg" role="img" aria-label={`Обычное время ответа: ${minutesText(m)}`}>
        <path d={`M${pt(0)} A${R},${R} 0 0 1 ${pt(1)}`} fill="none" stroke="#e8ebf1" strokeWidth={14} strokeLinecap="round" />
        {frac > 0 && <path d={`M${pt(0)} A${R},${R} 0 0 1 ${pt(frac)}`} fill="none" stroke={state ? STATUS[state] : OTHER_COLOR} strokeWidth={14} strokeLinecap="round" />}
        <text x={20} y={108} className="sa-axis" textAnchor="middle">0</text>
        <text x={160} y={108} className="sa-axis" textAnchor="middle">60 мин</text>
      </svg>
      <div className="sa-gauge-value">{minutesText(m)}</div>
      <div className={`sa-state ${state ?? 'none'}`}>
        <Icon name={icon} size={16} /> {word}
      </div>
      <div className="sa-gauge-facts">
        <span>
          Обращений: <b>{num(data.asks)}</b>, отвечено: <b>{num(data.answered)}</b>
        </span>
        <span>
          За 15 минут: <b>{pct(data.asks ? Math.round((data.within15 / data.asks) * 1000) / 10 : null)}</b>
        </span>
      </div>
    </div>
  );
}

export default function SalesAnalyticsView() {
  const me = useAuth((s) => s.user);
  const admin = isPrivileged(me?.role);
  const defaults = useMemo(() => ({ period: 'month', employee: '' }), []);
  const [filters, setFilter] = useUrlFilter(defaults);
  const period = (PERIODS.some((p) => p.value === filters.period) ? filters.period : 'month') as SalesPeriodKey;
  const prevLabel = PERIODS.find((p) => p.value === period)!.prev;
  const [data, setData] = useState<SalesAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [showAllManagers, setShowAllManagers] = useState(false);
  const req = useRef(0);

  useEffect(() => {
    const my = ++req.current;
    setLoading(true);
    getSalesAnalytics(period, admin ? filters.employee : undefined)
      .then((d) => {
        if (my === req.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (my === req.current) setError(e?.response?.data?.message || 'Не удалось загрузить аналитику');
      })
      .finally(() => {
        if (my === req.current) setLoading(false);
      });
  }, [period, filters.employee, admin]);

  useEffect(() => {
    if (admin) listUsers().then(setUsers).catch(() => {});
  }, [admin]);

  const scopeText = !data
    ? ''
    : data.scope.kind === 'all'
      ? 'Все сотрудники'
      : data.scope.kind === 'self'
        ? 'Ваши цифры: ваши заявки, студенты и чаты'
        : `Сотрудник: ${data.scope.name}`;
  const fmtRange = (a: string, b: string) => {
    const f = new Date(a);
    const t = new Date(b);
    const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
    return `${f.toLocaleDateString('ru-RU', o)} — ${t.toLocaleDateString('ru-RU', o)}`;
  };
  const managers = data?.managers.items ?? [];
  const shownManagers = showAllManagers ? managers : managers.slice(0, 8);

  return (
    <div className="sa-page" data-testid="sa-page">
      <div className="sa-toolbar">
        <div className="fn-seg" role="group" aria-label="Период">
          {PERIODS.map((p) => (
            <button key={p.value} type="button" className={period === p.value ? 'on' : ''} onClick={() => setFilter('period', p.value)} data-testid={`sa-period-${p.value}`}>
              {p.label}
            </button>
          ))}
        </div>
        {admin ? (
          <select className="sa-select" value={filters.employee} onChange={(e) => setFilter('employee', e.target.value)} data-testid="sa-employee" aria-label="Сотрудник">
            <option value="">Все сотрудники</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </select>
        ) : null}
        {data && (
          <span className="sa-scope" data-testid="sa-scope">
            <Icon name={data.scope.kind === 'all' ? 'groups' : 'person'} size={16} /> {scopeText} · {fmtRange(data.period.from, data.period.to)}
          </span>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}
      {!data && loading && <div className="empty">Загрузка…</div>}

      {data && (
        <motion.div className={`sa-content${loading ? ' is-loading' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="sa-kpis">
            <Kpi
              testId="sa-kpi-conversion"
              label="Конверсия"
              icon="percent"
              value={pct(data.kpi.conversion.value)}
              sub={`Зачислено ${num(data.kpi.conversion.converted)} из ${num(data.kpi.conversion.leads)} заявок периода`}
              delta={<Delta cur={data.kpi.conversion.value} prev={data.kpi.conversion.prev} kind="points" prevLabel={prevLabel} />}
            />
            <Kpi
              testId="sa-kpi-revenue"
              label="Выручка"
              icon="payments"
              value={data.kpi.revenue ? `${formatAmount(data.kpi.revenue.value)} TJS` : '—'}
              sub={data.kpi.revenue ? 'Платежи за период: одобренные и на проверке' : 'Суммы по сотруднику видит только Основатель'}
              delta={data.kpi.revenue ? <Delta cur={toNum(data.kpi.revenue.value)} prev={toNum(data.kpi.revenue.prev)} kind="count" prevLabel={prevLabel} /> : undefined}
            />
            <Kpi
              testId="sa-kpi-deals"
              label="Закрытые сделки"
              icon="school"
              value={num(data.kpi.deals.value)}
              sub="Зачислено за период"
              delta={<Delta cur={data.kpi.deals.value} prev={data.kpi.deals.prev} kind="count" prevLabel={prevLabel} />}
            />
            <Kpi
              testId="sa-kpi-leads"
              label="Всего лидов"
              icon="person_add"
              value={num(data.kpi.leads.value)}
              sub="Новые заявки за период"
              delta={<Delta cur={data.kpi.leads.value} prev={data.kpi.leads.prev} kind="count" prevLabel={prevLabel} />}
            />
          </div>

          <div className="sa-grid sa-grid-2-1">
            <Panel title="Конверсия по месяцам" hint="Из заявок месяца — сколько уже зачислено. Последние 12 месяцев." testId="sa-panel-line">
              <ConversionLine data={data.monthly} />
            </Panel>
            <Panel title="Источники лидов" hint="Откуда пришли заявки периода" testId="sa-panel-sources">
              <SourcesDonut data={data.sources} />
            </Panel>
          </div>

          <div className="sa-grid sa-grid-2-1">
            <Panel
              title="Менеджеры"
              hint={data.managers.money ? 'Закрытые сделки (зачислено) и выручка их студентов за период' : 'Закрытые сделки (зачислено) за период. Суммы по сотрудникам видит Основатель.'}
              testId="sa-panel-managers"
            >
              {managers.length ? (
                <>
                  <ul className="sa-mgrs" data-testid="sa-managers">
                    {shownManagers.map((m) => {
                      const max = Math.max(1, ...managers.map((x) => x.deals));
                      return (
                        <li key={m.id} data-testid="sa-manager">
                          <span className="sa-mgr-name">{m.name}</span>
                          <div className="sa-bar-line">
                            <div className="sa-bar-track">
                              <div className="sa-bar-fill" style={{ width: `${m.deals ? Math.max(2, (m.deals / max) * 100) : 0}%`, background: SERIES }} />
                            </div>
                            <b className="sa-bar-value">{num(m.deals)}</b>
                          </div>
                          {data.managers.money && <span className="sa-mgr-money">{m.revenue !== null ? `${formatAmount(m.revenue)} TJS` : '—'}</span>}
                        </li>
                      );
                    })}
                  </ul>
                  {managers.length > 8 && (
                    <button type="button" className="sa-link" onClick={() => setShowAllManagers((v) => !v)}>
                      {showAllManagers ? 'Свернуть' : `Показать всех (${managers.length})`}
                    </button>
                  )}
                </>
              ) : (
                <div className="sa-empty">Менеджеров нет</div>
              )}
            </Panel>
            <Panel title="Скорость ответа на сообщения" hint="Обычное время (медиана) от обращения клиента до первого ответа сотрудника" testId="sa-panel-speed">
              <ResponseGauge data={data.response} />
            </Panel>
          </div>

          <div className="sa-grid sa-grid-3">
            <Panel title="Отвеченные сообщения по каналам" hint="Обращения клиентов за период и сколько из них получили ответ" testId="sa-panel-channels">
              {data.channels.length ? (
                <ul className="sa-meters" data-testid="sa-channels">
                  {data.channels.map((c) => (
                    <li key={c.channel}>
                      <div className="sa-bar-label">
                        <span>{c.label}</span>
                        <span className="sa-bar-sub">{c.medianMinutes !== null ? `обычно за ${minutesText(c.medianMinutes)}` : 'ответов нет'}</span>
                      </div>
                      <div className="sa-bar-line">
                        <div className="sa-bar-track" style={{ background: SERIES_SOFT }}>
                          <div className="sa-bar-fill" style={{ width: `${c.asks ? (c.answered / c.asks) * 100 : 0}%`, background: SERIES }} />
                        </div>
                        <b className="sa-bar-value">
                          {num(c.answered)} из {num(c.asks)}
                        </b>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="sa-empty">Обращений в чатах за период не было</div>
              )}
            </Panel>
            <Panel title="Клиенты по этапам" hint="Сейчас, как в «Воронке»" testId="sa-panel-stages">
              <Bars testId="sa-stages" rows={data.stages.map((s) => ({ key: s.key, label: s.label, value: s.count, muted: s.key === 'ARCHIVED' }))} />
            </Panel>
            <Panel title="Выручка" hint="Деньги по платежам" testId="sa-panel-revenue">
              {data.revenue ? (
                <div className="sa-money" data-testid="sa-revenue">
                  <div className="sa-money-row">
                    <span>Выручка</span>
                    <b>{formatAmount(data.revenue.revenue.amount)} TJS</b>
                    <small>все платежи за период ({num(data.revenue.revenue.count)})</small>
                  </div>
                  <div className="sa-money-split" aria-hidden="true">
                    {(() => {
                      const total = toNum(data.revenue.revenue.amount);
                      const got = toNum(data.revenue.received.amount);
                      const share = total ? Math.min(100, (got / total) * 100) : 0;
                      return total ? (
                        <>
                          <span style={{ width: `${share}%`, background: SERIES }} />
                          {share < 100 && <span style={{ width: `${100 - share}%`, background: '#eda100' }} />}
                        </>
                      ) : (
                        <span style={{ width: '100%', background: '#e8ebf1' }} />
                      );
                    })()}
                  </div>
                  <div className="sa-money-row">
                    <span>
                      <i className="sa-swatch" style={{ background: SERIES }} /> Получено
                    </span>
                    <b>{formatAmount(data.revenue.received.amount)} TJS</b>
                    <small>одобрено за период ({num(data.revenue.received.count)})</small>
                  </div>
                  <div className="sa-money-row">
                    <span>
                      <i className="sa-swatch" style={{ background: '#eda100' }} /> Ожидается
                    </span>
                    <b>{formatAmount(data.revenue.expected.amount)} TJS</b>
                    <small>
                      на сегодня: на проверке {formatAmount(data.revenue.expected.pending.amount)} ({num(data.revenue.expected.pending.count)}) + остаток по графикам{' '}
                      {formatAmount(data.revenue.expected.planned)}
                    </small>
                  </div>
                </div>
              ) : (
                <div className="sa-empty">Суммы по сотруднику видит только Основатель</div>
              )}
            </Panel>
          </div>

          <Panel
            title="Прогресс по этапам воронки"
            hint={`Из ${num(data.progress.total)} заявок периода — сколько дошли до каждого этапа. В отказе: ${num(data.progress.refused)}.`}
            testId="sa-panel-progress"
          >
            {data.progress.total ? (
              <Bars
                testId="sa-progress"
                rows={data.progress.stages.map((s) => ({ key: s.key, label: s.label, value: s.reached, text: `${pct(s.pct)} · ${num(s.reached)}` }))}
              />
            ) : (
              <div className="sa-empty">Заявок за период нет</div>
            )}
          </Panel>
        </motion.div>
      )}
    </div>
  );
}
