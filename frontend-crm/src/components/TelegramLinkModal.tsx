import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getTelegramStatus, linkTelegram, unlinkTelegram, type TelegramStatus } from '../api/telegram';
import { useUI } from '../ui/Dialogs';
import Icon from '../Icon';

/**
 * Подключение личного Telegram сотрудника (12.08.2026).
 *
 * Привязка в один клик: кнопка открывает бота со ссылкой, внутри которой
 * одноразовый код. Кода на экране НЕТ намеренно — вводить его руками не нужно,
 * а показанный код кто-нибудь непременно перешлёт коллеге, и тот привяжет
 * чужие уведомления к себе.
 */
export default function TelegramLinkModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useUI();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    getTelegramStatus()
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, linked: false, username: null }));
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  // Пока окно открыто, подтягиваем состояние: сотрудник нажимает «Старт» в
  // Telegram в другом окне, и экран должен сам показать «подключено», а не
  // требовать закрыть и открыть окно заново.
  useEffect(() => {
    if (!open || status?.linked) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [open, status?.linked]);

  if (!open) return null;

  const onConnect = async () => {
    setBusy(true);
    try {
      const { url } = await linkTelegram();
      if (!url) {
        toast('Бот уведомлений не настроен — обратитесь к Основателю', 'error');
        return;
      }
      window.open(url, '_blank', 'noopener');
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Не удалось получить ссылку', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    setBusy(true);
    try {
      await unlinkTelegram();
      toast('Telegram отключён', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Не удалось отключить', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose}>
      <motion.div
        className="dialog-card"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 460 }}
      >
        <div className="dialog-title">Уведомления в Telegram</div>

        {status === null && <div className="dialog-message">Загрузка…</div>}

        {status && !status.enabled && (
          <div className="dialog-message">
            Бот уведомлений пока не настроен. Обратитесь к Основателю — подключение занимает пару минут.
          </div>
        )}

        {status?.enabled && !status.linked && (
          <>
            <div className="dialog-message">
              Задачи, новые консультации и заявки будут приходить вам в Telegram.
              <br />
              Нажмите кнопку — откроется бот, там нажмите «Старт».
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={onClose}>Закрыть</button>
              <button className="btn btn-primary" onClick={onConnect} disabled={busy}>
                <Icon name="send" size={15} style={{ marginRight: 6 }} />
                {busy ? 'Открываю…' : 'Подключить Telegram'}
              </button>
            </div>
          </>
        )}

        {status?.linked && (
          <>
            <div
              className="dialog-message"
              style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--success)' }}
            >
              <Icon name="check_circle" size={20} />
              <span>
                Подключено{status.username ? `: ${status.username}` : ''}. Уведомления приходят в Telegram.
              </span>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={onClose}>Закрыть</button>
              <button className="btn btn-danger" onClick={onDisconnect} disabled={busy}>
                {busy ? 'Отключаю…' : 'Отключить'}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
