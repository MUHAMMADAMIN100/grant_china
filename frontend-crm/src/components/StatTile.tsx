import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { fadeUp } from '../motion';
import Icon from '../Icon';

/**
 * Плитка-показатель и её расшифровка.
 *
 * До этого плитки были мёртвыми: большая цифра без единого способа узнать,
 * что именно в неё попало. «Просрочено 12 400 сомони» — по каким студентам?
 * «В работе 37» — это какие статусы? Ответы были только в коде сервисов, и
 * пользователь либо верил цифре на слово, либо не верил вовсе.
 *
 * Теперь у каждой плитки есть `detail`, и она открывает модалку с тремя
 * вещами: что означает цифра, за какой период она посчитана и из чего
 * складывается — плюс ссылка в список, где лежат сами записи.
 *
 * Плитка БЕЗ `detail` рисуется ровно как раньше и ничего не открывает:
 * лучше некликабельная плитка, чем кликабельная, за которой пустая модалка.
 */

export type StatDetailRow = {
  label: string;
  value: string;
  /** Мелкая приписка справа от подписи — например, «(14 платежей)». */
  hint?: string;
  tone?: 'success' | 'warning' | 'danger' | 'muted';
  /** Доля 0..1 — рисуется полоской под строкой. Не задана — полоски нет. */
  share?: number;
  /**
   * Строка сама ведёт в список. Нужно там, где плитка складывается из
   * нескольких статусов: фильтр списка выбирает статус по одному, и из
   * модалки видно, куда именно кликать за каждой частью суммы.
   */
  to?: string;
};

export type StatDetail = {
  /** Что означает цифра, человеческим языком. Ради этого модалка и открывается. */
  meaning: string;
  /** За какой период посчитано или на какой момент снят срез. */
  period?: string;
  /** Что именно попадает в цифру, а что нет — чтобы к ней было доверие. */
  formula?: string;
  /** Заголовок над разбивкой. */
  rowsTitle?: string;
  /** Из чего складывается. Пусто — блока разбивки не будет вовсе. */
  rows?: StatDetailRow[];
  /** Куда пойти, чтобы увидеть сами записи, а не агрегат. */
  link?: { to: string; label: string };
  /**
   * Оговорка внизу. Нужна там, где фильтр списка ШИРЕ цифры на плитке —
   * молча увести пользователя в список с другим числом строк хуже, чем
   * честно предупредить.
   */
  note?: string;
};

type Props = {
  label: string;
  value: React.ReactNode;
  /**
   * Значение для шапки модалки, если на плитке оно показано сокращённо.
   * В аналитике на плитке стоит «795 350,00 сомони» с мелкой валютой (иначе
   * слово уезжает на вторую строку), а в модалке места хватает на полную
   * форму. Не задано — берётся `value`.
   */
  modalValue?: React.ReactNode;
  icon: string;
  color: string;
  bg: string;
  /** Мелкая подпись под значением прямо на плитке. */
  hint?: string;
  /** Крупные суммы не влезают в дефолтные 32px — Аналитика ставит 22. */
  valueFontSize?: number;
  detail?: StatDetail;
};

const TONE_CLASS: Record<NonNullable<StatDetailRow['tone']>, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-muted',
};

export default function StatTile({ label, value, modalValue, icon, color, bg, hint, valueFontSize, detail }: Props) {
  const [open, setOpen] = useState(false);
  const clickable = !!detail;

  return (
    <>
      <motion.div
        className={`stat-card${clickable ? ' stat-card-clickable' : ''}`}
        variants={fadeUp}
        whileHover={clickable ? { y: -4, transition: { duration: 0.2 } } : undefined}
        whileTap={clickable ? { scale: 0.985 } : undefined}
        onClick={clickable ? () => setOpen(true) : undefined}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpen(true);
                }
              }
            : undefined
        }
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-haspopup={clickable ? 'dialog' : undefined}
        aria-label={clickable ? `${label} — открыть подробности` : undefined}
      >
        <div className="stat-icon-row">
          <div>
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color, fontSize: valueFontSize }}>{value}</div>
            {hint && <div className="stat-card-hint">{hint}</div>}
          </div>
          <div className="stat-icon" style={{ background: bg, color }}>
            <Icon name={icon} size={24} />
          </div>
        </div>
        {clickable && (
          <div className="stat-card-more">
            <Icon name="info" size={14} />
            Подробнее
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {open && detail && (
          <StatDetailModal
            label={label}
            value={modalValue ?? value}
            icon={icon}
            color={color}
            bg={bg}
            detail={detail}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function StatDetailModal({
  label,
  value,
  icon,
  color,
  bg,
  detail,
  onClose,
}: {
  label: string;
  value: React.ReactNode;
  icon: string;
  color: string;
  bg: string;
  detail: StatDetail;
  onClose: () => void;
}) {
  // Escape закрывает. Остальные модалки проекта этого не умеют, но здесь
  // окно чисто справочное — ничего не вводится и терять нечего.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = detail.rows ?? [];

  return (
    <motion.div
      className="dialog-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="dialog-card stat-detail-card"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="stat-detail-head">
          <div className="stat-icon" style={{ background: bg, color }}>
            <Icon name={icon} size={24} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="stat-label">{label}</div>
            <div className="stat-detail-value" style={{ color }}>{value}</div>
          </div>
          <button className="stat-detail-close" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" size={20} />
          </button>
        </div>

        <p className="stat-detail-meaning">{detail.meaning}</p>

        {detail.period && (
          <div className="stat-detail-chip">
            <Icon name="event" size={15} />
            <span>{detail.period}</span>
          </div>
        )}

        {detail.formula && (
          <div className="stat-detail-formula">
            <Icon name="calculate" size={15} />
            <span>{detail.formula}</span>
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="payments-block-title">{detail.rowsTitle || 'Из чего складывается'}</div>
            <div className="stat-detail-rows">
              {rows.map((r) => {
                const line = (
                  <>
                    <div className="stat-detail-row-line">
                      <span>
                        {r.label}
                        {r.hint && <span className="stat-detail-row-hint"> {r.hint}</span>}
                        {r.to && <Icon name="chevron_right" size={16} className="stat-detail-row-go" />}
                      </span>
                      <strong className={r.tone ? TONE_CLASS[r.tone] : undefined}>{r.value}</strong>
                    </div>
                    {r.share !== undefined && (
                      <div className="analytics-bar-track" style={{ height: 6 }}>
                        <div
                          className="analytics-bar-fill"
                          style={{ width: `${Math.max(0, Math.min(100, Math.round(r.share * 100)))}%` }}
                        />
                      </div>
                    )}
                  </>
                );
                return r.to ? (
                  <Link className="stat-detail-row stat-detail-row-link" key={r.label} to={r.to} onClick={onClose}>
                    {line}
                  </Link>
                ) : (
                  <div className="stat-detail-row" key={r.label}>{line}</div>
                );
              })}
            </div>
          </>
        )}

        {detail.note && (
          <div className="receipt-dropzone-hint" style={{ marginTop: 14 }}>{detail.note}</div>
        )}

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>Закрыть</button>
          {detail.link && (
            <Link className="btn btn-primary" to={detail.link.to} onClick={onClose}>
              <Icon name="list_alt" size={16} />
              {detail.link.label}
            </Link>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
