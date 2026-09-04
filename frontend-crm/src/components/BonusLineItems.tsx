import { Link } from 'react-router-dom';
import type { BonusLine } from '../api/types';
import { formatMoney } from '../utils/money';
import Icon from '../Icon';

/**
 * 03.09.2026 — расшифровка строки бонуса до конкретных студентов.
 *
 * Строка «За зачисление студента — 4 × 200,00» раскрывается по клику в четыре
 * имени с датами. Один компонент на три экрана — симулятор формул, расчётный
 * лист в «Зарплатах» и «Моя зарплата» сотрудника, — чтобы список выглядел и
 * вёл себя одинаково везде, где начисление можно проверить.
 *
 * `LineLabel` — подпись правила со стрелкой и счётчиком, кликабельная, если
 * список есть. `LineItemsRow` — строка таблицы на всю ширину со списком.
 * Раскрытие хранит родитель (Set из ruleId): у симулятора и листа таблицы
 * разной ширины, а состояние одно и то же.
 */

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '');

export function hasItems(line: BonusLine): boolean {
  return Array.isArray(line.items);
}

export function LineLabel({
  line,
  expanded,
  onToggle,
  children,
}: {
  line: BonusLine;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  if (!hasItems(line)) {
    return (
      <span>
        {line.label}
        {children}
      </span>
    );
  }
  const n = line.items!.length;
  return (
    <button
      type="button"
      className={`bonus-line-toggle${expanded ? ' open' : ''}`}
      onClick={onToggle}
      aria-expanded={expanded}
      title={expanded ? 'Свернуть список' : 'Показать, из кого сложилась база'}
    >
      <Icon name={expanded ? 'expand_more' : 'chevron_right'} size={18} />
      <span>{line.label}</span>
      <span className="bonus-line-count">{n}</span>
      {children}
    </button>
  );
}

export function LineItemsRow({ line, colSpan }: { line: BonusLine; colSpan: number }) {
  const items = line.items ?? [];
  const withAmount = items.some((i) => i.amount);
  return (
    <tr className="bonus-line-items-row" style={{ cursor: 'default' }}>
      <td colSpan={colSpan}>
        {items.length === 0 ? (
          <div className="bonus-line-empty">За месяц ни одного факта по этому правилу.</div>
        ) : (
          <ol className="bonus-line-items">
            {items.map((it, i) => (
              <li key={`${it.studentId ?? 'x'}-${i}`}>
                <span className="bonus-line-item-name">
                  {it.studentId ? (
                    <Link to={`/students/${it.studentId}`} className="link-cell" title="Открыть карточку студента">
                      {it.studentName}
                    </Link>
                  ) : (
                    it.studentName
                  )}
                </span>
                {it.note && <span className="bonus-line-item-note">{it.note}</span>}
                {it.date && <span className="bonus-line-item-date">{fmtDate(it.date)}</span>}
                {withAmount && (
                  <span className="bonus-line-item-amount">{it.amount ? formatMoney(it.amount) : ''}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </td>
    </tr>
  );
}
