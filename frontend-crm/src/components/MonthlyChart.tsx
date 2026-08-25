import { useMemo, useState } from 'react';
import type { AnalyticsMonthPoint } from '../api/types';
import { formatMoney } from '../utils/money';
import Icon from '../Icon';

/**
 * «Динамика по месяцам» в финансовой аналитике.
 *
 * Раньше здесь была голая ломаная: линия и точки, без осей, без подписей
 * месяцев, без единой цифры. По ней нельзя было сказать ни КОГДА был пик,
 * ни СКОЛЬКО это в деньгах — только «где-то посередине повыше». А при
 * пресете «Месяц» период умещается в один месяц, точек становится ровно
 * одна, линия не рисуется вовсе — и на экране оставался одинокий кружок
 * посреди пустого прямоугольника. Именно это и выглядело как поломка.
 *
 * Теперь это столбчатая диаграмма: одна точка данных — один столбец,
 * который читается сам по себе и не зависит от наличия соседей. Есть ось
 * сумм с делениями, подписи месяцев, подсказка по наведению и итоги под
 * графиком.
 *
 * Библиотеки графиков в проект по-прежнему не добавляются (правило волны) —
 * всё на inline SVG и CSS.
 */

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** "2026-03" -> "мар 2026". Нераспознанное значение возвращаем как есть, а не «NaN». */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map((v) => parseInt(v, 10));
  if (!y || !m || m < 1 || m > 12) return ym;
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

function monthShort(ym: string): string {
  const [, m] = ym.split('-').map((v) => parseInt(v, 10));
  if (!m || m < 1 || m > 12) return ym;
  return MONTH_SHORT[m - 1];
}

function yearOf(ym: string): string {
  const [y] = ym.split('-');
  return y || '';
}

function toNumber(value: string | null | undefined): number {
  const n = parseFloat(value ?? '0');
  return Number.isFinite(n) ? n : 0;
}

/**
 * Верх шкалы и число делений.
 *
 * Верх округляем вверх до «круглого» (1/2/5 × 10^n), иначе подписи выглядят
 * как 47 218,33. Но одного округления мало: у шкалы с верхом 50 000 деления
 * по четвертям дают 12 500 и 37 500, а компактный формат печатает их как
 * «13 тыс» и «38 тыс» — подпись перестаёт быть точной. Поэтому для верха на
 * пятёрку берём ПЯТЬ интервалов (0-10-20-30-40-50), для остальных — четыре.
 * При таком делении каждая подпись оси — точное круглое число.
 */
function niceScale(value: number): { top: number; intervals: number } {
  if (value <= 0) return { top: 1, intervals: 4 };
  const exp = Math.floor(Math.log10(value));
  const pow = Math.pow(10, exp);
  const norm = value / pow;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return { top: step * pow, intervals: step === 5 ? 5 : 4 };
}

/** Короткая сумма для оси: 1 250 000 -> «1,3 млн», 47 000 -> «47 тыс». */
function compactAmount(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`;
  if (v >= 10_000) return `${Math.round(v / 1000).toLocaleString('ru-RU')} тыс`;
  if (v >= 1_000) return `${(v / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} тыс`;
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

const W = 760;
const H = 250;
const PAD_LEFT = 78;
const PAD_RIGHT = 14;
const PAD_TOP = 22;
const PAD_BOTTOM = 46;
const PLOT_W = W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;

export default function MonthlyChart({ points }: { points: AnalyticsMonthPoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const model = useMemo(() => {
    const values = points.map((p) => toNumber(p.amount));
    const total = values.reduce((s, v) => s + v, 0);
    const peakIndex = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
    const { top, intervals } = niceScale(Math.max(...values, 0));
    const slot = points.length > 0 ? PLOT_W / points.length : PLOT_W;
    const barW = Math.min(56, Math.max(10, slot * 0.56));
    const bars = values.map((v, i) => {
      const cx = PAD_LEFT + slot * i + slot / 2;
      const h = top > 0 ? (v / top) * PLOT_H : 0;
      return { x: cx - barW / 2, cx, w: barW, h, y: PAD_TOP + PLOT_H - h, value: v };
    });
    // Подписи месяцев прореживаем, когда их больше 12 — иначе «янв фев мар…»
    // за три года сливаются в серую кашу.
    const labelEvery = points.length > 24 ? 6 : points.length > 12 ? 2 : 1;
    const ticks = Array.from({ length: intervals + 1 }, (_, i) => i / intervals);
    return { values, total, peakIndex, top, bars, labelEvery, ticks, hasMoney: total > 0 };
  }, [points]);

  if (points.length === 0) return <div className="empty">Нет данных</div>;

  const ticks = model.ticks;
  const active = hovered !== null && points[hovered] ? hovered : null;

  return (
    <div className="chart-block">
      {/* Два слоя не для красоты: на телефоне 760×250 ужимается до ширины
          экрана, высота падает до ~120px, и подписи месяцев с осью становятся
          нечитаемым мелким шрифтом. Внешний слой скроллится по горизонтали,
          внутренний держит минимальную ширину — график остаётся в масштабе, а
          подсказка позиционируется внутри него, а не относительно видимой
          части (иначе после прокрутки она уезжала бы от своего столбца). */}
      <div className="chart-canvas" onMouseLeave={() => setHovered(null)}>
        <div className="chart-inner">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Динамика поступлений по месяцам">
          <defs>
            <linearGradient id="chart-bar-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.95" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.55" />
            </linearGradient>
          </defs>

          {ticks.map((t) => {
            const y = PAD_TOP + PLOT_H - t * PLOT_H;
            return (
              <g key={t}>
                <line
                  x1={PAD_LEFT}
                  y1={y}
                  x2={W - PAD_RIGHT}
                  y2={y}
                  className={t === 0 ? 'chart-axis-line' : 'chart-grid-line'}
                />
                <text x={PAD_LEFT - 10} y={y + 4} textAnchor="end" className="chart-tick-label">
                  {compactAmount(model.top * t)}
                </text>
              </g>
            );
          })}

          {model.bars.map((b, i) => (
            <g
              key={points[i].month}
              tabIndex={0}
              role="button"
              aria-label={`${monthLabel(points[i].month)}: ${formatMoney(points[i].amount)}, платежей ${points[i].count}`}
              className={`chart-bar-group${active === i ? ' active' : ''}`}
              onMouseEnter={() => setHovered(i)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
            >
              {/* Прозрачная колонка во всю высоту — чтобы подсказка ловилась
                  наведением на любую точку столбца, а не только на его
                  залитую часть (у месяца с нулём залитой части нет вовсе). */}
              <rect
                x={b.cx - Math.max(b.w, PLOT_W / points.length) / 2}
                y={PAD_TOP}
                width={Math.max(b.w, PLOT_W / points.length)}
                height={PLOT_H}
                className="chart-bar-hit"
              />
              {b.h > 0 ? (
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} className="chart-bar" />
              ) : (
                // Нулевой месяц: тонкая планка на оси. Пустое место читалось бы
                // как «месяца нет в периоде», а он есть — просто без денег.
                <rect x={b.x} y={PAD_TOP + PLOT_H - 2} width={b.w} height={2} rx={1} className="chart-bar-zero" />
              )}
              <title>{`${monthLabel(points[i].month)} — ${formatMoney(points[i].amount)}`}</title>
            </g>
          ))}

          {model.bars.map((b, i) =>
            i % model.labelEvery === 0 || active === i ? (
              <text
                key={`x-${points[i].month}`}
                x={b.cx}
                y={PAD_TOP + PLOT_H + 20}
                textAnchor="middle"
                className={`chart-x-label${active === i ? ' active' : ''}`}
              >
                {monthShort(points[i].month)}
              </text>
            ) : null,
          )}

          {/* Год подписываем один раз — под первым месяцем и под каждой сменой года. */}
          {model.bars.map((b, i) =>
            i === 0 || yearOf(points[i].month) !== yearOf(points[i - 1].month) ? (
              <text
                key={`y-${points[i].month}`}
                x={b.cx}
                y={PAD_TOP + PLOT_H + 36}
                textAnchor="middle"
                className="chart-year-label"
              >
                {yearOf(points[i].month)}
              </text>
            ) : null,
          )}
        </svg>

        {active !== null && (
          <div
            className="chart-tooltip"
            style={{
              left: `${(model.bars[active].cx / W) * 100}%`,
              // Подсказку прижимаем к верху столбца, но не выше самого графика.
              top: `${(Math.max(PAD_TOP, model.bars[active].y - 8) / H) * 100}%`,
            }}
          >
            <div className="chart-tooltip-title">{monthLabel(points[active].month)}</div>
            <div className="chart-tooltip-value">{formatMoney(points[active].amount)}</div>
            <div className="chart-tooltip-sub">
              {points[active].count} {plural(points[active].count, 'платёж', 'платежа', 'платежей')}
            </div>
          </div>
        )}
        </div>
      </div>

      {points.length > 5 && (
        <div className="chart-swipe-hint">
          <Icon name="swipe" size={14} style={{ marginRight: 4, verticalAlign: '-2px' }} />
          Проведите пальцем вбок, чтобы увидеть остальные месяцы.
        </div>
      )}

      {!model.hasMoney && (
        <div className="receipt-dropzone-hint" style={{ marginTop: 8 }}>
          За выбранный период одобренных поступлений нет — все месяцы по нулям.
        </div>
      )}

      {points.length === 1 && (
        <div className="receipt-dropzone-hint" style={{ marginTop: 8 }}>
          <Icon name="info" size={14} style={{ marginRight: 4, verticalAlign: '-2px' }} />
          В периоде один месяц, сравнивать не с чем. Выберите квартал или год — появится динамика.
        </div>
      )}

      <div className="chart-summary">
        <div>
          <span>Итого за период</span>
          <strong>{formatMoney(model.total.toFixed(2))}</strong>
        </div>
        <div>
          <span>В среднем в месяц</span>
          <strong>{formatMoney((model.total / points.length).toFixed(2))}</strong>
        </div>
        <div>
          <span>Лучший месяц</span>
          <strong>
            {monthLabel(points[model.peakIndex].month)} · {formatMoney(points[model.peakIndex].amount)}
          </strong>
        </div>
      </div>

      <div className="analytics-month-list">
        {points.map((p, i) => (
          <button
            type="button"
            className={`analytics-month-item${active === i ? ' active' : ''}`}
            key={p.month}
            onMouseEnter={() => setHovered(i)}
            onFocus={() => setHovered(i)}
            onBlur={() => setHovered(null)}
          >
            <span>{monthLabel(p.month)}</span>
            <strong>{formatMoney(p.amount)}</strong>
            <span>{p.count} {plural(p.count, 'платёж', 'платежа', 'платежей')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Русские числительные: 1 платёж, 2 платежа, 5 платежей. */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}
