import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatBytes, getStorageHealth, purgeOrphans, scanOrphans, type OrphanScan, type StorageHealth } from '../api/storage';
import { useUI } from '../ui/Dialogs';
import { fadeUp } from '../motion';
import Icon from '../Icon';

/**
 * 07.09.2026 — «Диск сервера» на дашборде руководства.
 *
 * Три дня на боевом сервере не сохранялся ни один файл, и никто в системе
 * об этом не знал: сотрудники видели «Internal server error» и решили, что
 * сломались оплаты. Карточка отвечает на вопрос «можно ли сейчас загружать
 * файлы» одной строкой (это реальная проба записи, а не догадка по цифрам)
 * и показывает, сколько места осталось.
 *
 * Основателю дополнительно доступна уборка файлов-сирот — файлов на диске,
 * на которые не ссылается ни одна строка базы (отказанные загрузки,
 * заменённые версии). Это единственное физическое удаление в системе,
 * поэтому: сначала отчёт «сколько и что», потом отдельное подтверждение.
 * Записи БД, в том числе удалённые «мягко», не трогаются — их файлы в отчёт
 * не попадают.
 */
export default function StorageCard({ canPurge }: { canPurge: boolean }) {
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orphansOpen, setOrphansOpen] = useState(false);

  const load = useCallback(() => {
    getStorageHealth()
      .then((h) => { setHealth(h); setError(null); })
      .catch((e) => setError(e?.response?.data?.message || 'Не удалось проверить диск'));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!health && !error) return null;

  const broken = health ? !health.writable : false;
  const low = health?.freePercent !== null && health?.freePercent !== undefined && health.freePercent < 10;
  const tone = broken ? 'var(--danger)' : low ? 'var(--warning)' : 'var(--success)';
  const usedShare = health?.totalBytes && health.usedBytes !== null ? Math.min(1, health.usedBytes / health.totalBytes) : null;

  return (
    <>
      <motion.div className="card" variants={fadeUp} initial="hidden" animate="show" data-testid="storage-card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="hard_drive" size={20} />
          <h2 className="card-title" style={{ margin: 0 }}>Диск сервера</h2>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: tone, fontWeight: 600, fontSize: 13 }}>
            <Icon name={broken ? 'error' : low ? 'warning' : 'check_circle'} size={18} />
            {broken ? 'Файлы не сохраняются' : low ? 'Мало места' : 'Файлы сохраняются'}
          </span>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 10 }}>
          {error && <div className="text-danger">{error}</div>}
          {health && (
            <>
              {broken && (
                <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.35)', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>
                  Проба записи в каталог загрузок провалилась (код {health.writeError}). Чеки, билеты и документы сейчас не загружаются
                  — нужно освободить или увеличить диск на сервере.
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span className="text-muted">Свободно</span>
                <strong>
                  {formatBytes(health.freeBytes)}
                  {health.totalBytes !== null && <span className="text-muted" style={{ fontWeight: 400 }}> из {formatBytes(health.totalBytes)}</span>}
                  {health.freePercent !== null && <span className="text-muted" style={{ fontWeight: 400 }}> · {health.freePercent}%</span>}
                </strong>
              </div>
              {usedShare !== null && (
                <div style={{ height: 8, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }} aria-hidden>
                  <div style={{ width: `${Math.round(usedShare * 100)}%`, height: '100%', background: tone, transition: 'width .4s' }} />
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span className="text-muted">Файлов в загрузках</span>
                <strong>{health.filesCount.toLocaleString('ru-RU')} · {formatBytes(health.filesBytes)}</strong>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn btn-secondary btn-sm" onClick={load}>
                  <Icon name="refresh" size={16} /> Проверить снова
                </button>
                {canPurge && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setOrphansOpen(true)} data-testid="storage-orphans-btn">
                    <Icon name="delete_sweep" size={16} /> Файлы-сироты
                  </button>
                )}
                <span className="text-muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
                  Проверено {new Date(health.checkedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {orphansOpen && <OrphansModal onClose={() => setOrphansOpen(false)} onPurged={load} />}
      </AnimatePresence>
    </>
  );
}

function OrphansModal({ onClose, onPurged }: { onClose: () => void; onPurged: () => void }) {
  const { confirm, toast } = useUI();
  const [scan, setScan] = useState<OrphanScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ deleted: number; freedBytes: number; skipped: number } | null>(null);

  const load = useCallback(() => {
    setScan(null);
    setError(null);
    scanOrphans()
      .then(setScan)
      .catch((e) => setError(e?.response?.data?.message || 'Не удалось построить отчёт'));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const purge = async () => {
    if (!scan || scan.orphans.length === 0) return;
    const ok = await confirm({
      title: 'Удалить файлы-сироты с диска',
      message: `Будет удалено ${scan.orphans.length} файлов (${formatBytes(scan.orphansBytes)}), на которые не ссылается ни одна запись базы — ни живая, ни удалённая. Действие необратимо. Записи в базе не затрагиваются.`,
      confirmText: `Удалить ${scan.orphans.length}`,
      cancelText: 'Отмена',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await purgeOrphans(scan.orphans.map((o) => o.name));
      setResult({ deleted: r.deleted.length, freedBytes: r.freedBytes, skipped: r.skipped.length });
      toast(`Удалено ${r.deleted.length} файлов, освобождено ${formatBytes(r.freedBytes)}`, 'success');
      onPurged();
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Не удалось удалить файлы', 'error');
    } finally {
      setBusy(false);
    }
  };

  const shown = scan?.orphans.slice(0, 100) ?? [];

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={busy ? undefined : onClose}>
      <motion.div
        className="dialog-card stat-detail-card"
        role="dialog"
        aria-modal="true"
        aria-label="Файлы-сироты"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.22 }}
        onClick={(e) => e.stopPropagation()}
        data-testid="orphans-modal"
      >
        <div className="stat-detail-head">
          <div className="stat-icon" style={{ background: 'rgba(220,38,38,0.1)', color: 'var(--danger)' }}>
            <Icon name="delete_sweep" size={24} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="stat-label">Файлы-сироты</div>
            <div className="stat-detail-value">{scan ? `${scan.orphans.length} · ${formatBytes(scan.orphansBytes)}` : '…'}</div>
          </div>
          <button className="stat-detail-close" onClick={onClose} aria-label="Закрыть" disabled={busy}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <p className="stat-detail-meaning">
          Файлы в каталоге загрузок, на которые не ссылается ни одна запись базы — ни документ, ни фото, ни картинка
          программы, включая записи, удалённые «мягко». Файлы моложе суток в отчёт не попадают: их запись может ещё
          создаваться.
        </p>

        {error && <div className="text-danger">{error}</div>}
        {!scan && !error && <div className="text-muted">Сканируем каталог и сверяем с базой…</div>}

        {scan && (
          <>
            <div className="payments-block-title">Сводка</div>
            <div className="stat-detail-rows">
              <Row label="Всего файлов на диске" value={`${scan.filesCount.toLocaleString('ru-RU')} · ${formatBytes(scan.filesBytes)}`} />
              <Row label="Нужны базе (не трогаем)" value={`${scan.referencedCount.toLocaleString('ru-RU')} · ${formatBytes(scan.referencedBytes)}`} />
              <Row label="Сироты старше суток" value={`${scan.orphans.length.toLocaleString('ru-RU')} · ${formatBytes(scan.orphansBytes)}`} tone={scan.orphans.length ? 'danger' : 'muted'} />
              {scan.recentUnreferenced > 0 && <Row label="Без ссылок, но моложе суток" value={String(scan.recentUnreferenced)} tone="muted" />}
            </div>

            {shown.length > 0 && (
              <>
                <div className="payments-block-title">
                  Список{scan.orphans.length > shown.length ? ` (первые ${shown.length} из ${scan.orphans.length}, по размеру)` : ''}
                </div>
                <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}>
                  {shown.map((o) => (
                    <div key={o.name} style={{ display: 'flex', gap: 10, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{o.name}</span>
                      <span className="text-muted">{new Date(o.modifiedAt).toLocaleDateString('ru-RU')}</span>
                      <span style={{ width: 70, textAlign: 'right' }}>{formatBytes(o.size)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {result && (
              <div className="text-success" style={{ fontSize: 13 }}>
                Удалено {result.deleted}, освобождено {formatBytes(result.freedBytes)}{result.skipped ? `, пропущено ${result.skipped}` : ''}.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn btn-secondary" onClick={load} disabled={busy}>
                <Icon name="refresh" size={16} /> Пересканировать
              </button>
              <button className="btn btn-danger" onClick={purge} disabled={busy || scan.orphans.length === 0} data-testid="orphans-purge-btn">
                <Icon name="delete" size={16} /> {busy ? 'Удаляем…' : `Удалить ${scan.orphans.length} · ${formatBytes(scan.orphansBytes)}`}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'muted' }) {
  return (
    <div className="stat-detail-row">
      <div className="stat-detail-row-line">
        <span>{label}</span>
        <strong className={tone === 'danger' ? 'text-danger' : tone === 'muted' ? 'text-muted' : undefined}>{value}</strong>
      </div>
    </div>
  );
}
