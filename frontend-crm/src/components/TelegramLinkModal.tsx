import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  getTelegramStatus,
  linkTelegram,
  unlinkTelegram,
  type TelegramLinkTargets,
  type TelegramStatus,
} from '../api/telegram';
import { useUI } from '../ui/Dialogs';
import Icon from '../Icon';

/**
 * Подключение личного Telegram сотрудника (12.08.2026).
 *
 * Привязка в один клик: кнопка открывает бота со ссылкой, внутри которой
 * одноразовый код. Кода на экране НЕТ намеренно — вводить его руками не нужно,
 * а показанный код кто-нибудь непременно перешлёт коллеге, и тот привяжет
 * чужие уведомления к себе.
 *
 * ПОЧЕМУ ЗДЕСЬ ТРИ ПУТИ, А НЕ ОДНА КНОПКА (26.08.2026).
 *
 * Кнопка открывала `https://t.me/<бот>?start=<код>` в новой вкладке, и в
 * Душанбе вкладка показывала «Не удаётся получить доступ к сайту»:
 * домен t.me у провайдера не резолвится — NXDOMAIN даже через 8.8.8.8, при
 * том что telegram.org резолвится нормально. Подключить уведомления было
 * нельзя вообще.
 *
 * Теперь основное действие — `tg://`, то есть открытие УСТАНОВЛЕННОГО
 * приложения: DNS в этом не участвует, блокировка домена не мешает. Но у
 * схемы `tg://` нет способа узнать, сработала она или нет — браузер молча
 * ничего не делает, если Telegram не установлен. Поэтому запасные пути
 * показаны СРАЗУ и всегда, а не «если не получилось»: ссылка через
 * telegram.me (официальный алиас t.me, у провайдера открывается) и имя бота
 * для поиска внутри приложения.
 */
export default function TelegramLinkModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useUI();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<TelegramLinkTargets | null>(null);
  const [copied, setCopied] = useState(false);

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

  /**
   * Выпускает код и открывает приложение. Каждый вызов выпускает НОВЫЙ код и
   * гасит предыдущий — поэтому запасные ссылки ниже показывают именно тот
   * набор, что вернул последний запрос, а не собранный когда-то раньше.
   */
  const onConnect = async () => {
    setBusy(true);
    setCopied(false);
    try {
      const link = await linkTelegram();
      const appUrl = link.appUrl;
      const webUrl = link.webUrl ?? link.url;
      if (!appUrl && !webUrl) {
        toast('Бот уведомлений не настроен — обратитесь к Основателю', 'error');
        return;
      }
      setTargets(link);
      if (appUrl) {
        // Именно location.href, а не window.open: открытая вкладка с
        // неизвестной схемой остаётся висеть пустой, а присвоение href лишь
        // передаёт ссылку системе — CRM при этом никуда не уходит.
        window.location.href = appUrl;
      } else if (webUrl) {
        window.open(webUrl, '_blank', 'noopener');
      }
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Не удалось получить ссылку', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onCopyLink = async () => {
    const webUrl = targets?.webUrl ?? targets?.url;
    if (!webUrl) return;
    try {
      await navigator.clipboard.writeText(webUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Браузер не дал скопировать — откройте ссылку вручную', 'error');
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
              Нажмите кнопку — откроется приложение Telegram, там нажмите «Старт».
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={onClose}>Закрыть</button>
              <button className="btn btn-primary" onClick={onConnect} disabled={busy}>
                <Icon name="send" size={15} style={{ marginRight: 6 }} />
                {busy ? 'Открываю…' : 'Подключить Telegram'}
              </button>
            </div>

            {targets && (
              <div className="tg-fallback">
                <div className="tg-fallback-title">
                  <Icon name="help" size={15} />
                  Telegram не открылся?
                </div>
                <div className="tg-fallback-row">
                  {/* Та же ссылка, что открылась по кнопке, но обычным
                      якорем. Нужна, если человек закрыл системный вопрос
                      «Открыть Telegram?» — повторное нажатие кнопки выпустило
                      бы НОВЫЙ код и погасило этот, а ссылка переиспользует
                      уже выданный. */}
                  {targets.appUrl && (
                    <a className="btn btn-sm btn-secondary" href={targets.appUrl}>
                      <Icon name="open_in_new" size={15} style={{ marginRight: 6 }} />
                      Открыть в приложении
                    </a>
                  )}
                  {(targets.webUrl || targets.url) && (
                    <>
                      <a
                        className="btn btn-sm btn-secondary"
                        href={(targets.webUrl ?? targets.url) as string}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Icon name="language" size={15} style={{ marginRight: 6 }} />
                        Открыть в браузере
                      </a>
                      <button className="btn btn-sm btn-secondary" onClick={onCopyLink}>
                        <Icon name={copied ? 'check' : 'content_copy'} size={15} style={{ marginRight: 6 }} />
                        {copied ? 'Скопировано' : 'Скопировать ссылку'}
                      </button>
                    </>
                  )}
                </div>
                {/* Просто «найдите бота и нажмите Старт» тут НЕ РАБОТАЕТ:
                    /start без кода бот отвечает отказом и сам просит прийти
                    по ссылке из CRM (staff-bot.service.ts). Поэтому запасной
                    путь — открыть ссылку С КОДОМ внутри самого приложения:
                    Telegram обрабатывает её сам, к домену не обращаясь. */}
                <div className="tg-fallback-hint">
                  Совсем ничего не открылось — скопируйте ссылку кнопкой выше, вставьте её в Telegram
                  в чат «Избранное» и нажмите на неё там. Бот откроется внутри приложения.
                  {targets.botUsername && (
                    <>
                      {' '}Бот называется <strong>@{targets.botUsername}</strong> — но одного «Старта»
                      мало, нужна именно ссылка с кодом.
                    </>
                  )}
                </div>
              </div>
            )}
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
