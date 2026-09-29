import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

/**
 * 29.09.2026 — выбор нескольких строк в таблицах «Студенты» и «Архив».
 *
 * Галочки и панель вынесены сюда, чтобы оба экрана вели себя одинаково:
 * одна и та же колонка, одна и та же панель «Выбрано: N», один и тот же
 * способ не открыть карточку кликом по галочке.
 *
 * Строка таблицы целиком — ссылка в карточку студента, поэтому клик по
 * галочке обязан остановиться на ней: иначе вместо выбора человек уходил бы
 * со страницы и терял всё выделенное.
 */

export function HeaderCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // indeterminate есть только у DOM-элемента, атрибутом в JSX его не задать.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="row-check" title="Выбрать всех на этой странице">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label="Выбрать всех на этой странице"
        data-testid="select-all"
      />
    </label>
  );
}

export function RowCheckbox({
  checked,
  onChange,
  name,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  name: string;
}) {
  return (
    <label className="row-check" onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={`Выбрать: ${name}`}
        data-testid="row-select"
      />
    </label>
  );
}

/** Панель действий над выбранными: «Выбрано: N · <кнопки> · Снять выделение». */
export function BulkBar({
  count,
  offPage,
  onClear,
  children,
}: {
  count: number;
  /** Сколько выбранных сейчас на других страницах — чтобы не удивляться числу. */
  offPage: number;
  onClear: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="bulk-bar"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      data-testid="bulk-bar"
    >
      <span className="bulk-bar-count">
        Выбрано: {count}
        {offPage > 0 && <span className="bulk-bar-hint"> · на других страницах: {offPage}</span>}
      </span>
      <div className="bulk-bar-actions">
        {children}
        <button className="btn btn-sm btn-secondary" onClick={onClear} data-testid="bulk-clear">
          Снять выделение
        </button>
      </div>
    </motion.div>
  );
}
