import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  assignConversation,
  getConversation,
  linkConversation,
  listChannels,
  listConversationMessages,
  listConversations,
  markConversationRead,
  sendConversationMessage,
  type ChannelMessage,
  type ChannelOption,
  type Conversation,
} from '../api/messaging';
import { listApplications } from '../api/applications';
import { listUsers } from '../api/users';
import type { Application, User } from '../api/types';
import { isPrivileged } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { useUrlFilter } from '../hooks/useUrlFilter';
import { formatDateTimeRu } from '../utils/datetime';
import Icon from '../Icon';

const PAGE_SIZE = 30;
const MESSAGES_PAGE_SIZE = 100;

/**
 * ТЗ 6.4 — «единое окно» переписки с клиентами из мессенджеров.
 *
 * Двухпанельный интерфейс (список слева, переписка справа), а не отдельная
 * страница на диалог: менеджер здесь работает потоком — просмотрел, ответил,
 * перешёл к следующему, — и перезагрузка страницы на каждый диалог убила бы
 * этот сценарий.
 *
 * Непривязанные диалоги видны всем сотрудникам (как свободные заявки): пока
 * неизвестно, чей это клиент, ответить должен тот, кто первым увидел.
 */
export default function Conversations() {
  const me = useAuth((s) => s.user);
  const { toast } = useUI();
  const isAdmin = isPrivileged(me?.role);

  const defaults = useMemo(() => ({ search: '', channel: '', mine: '', unread: '' }), []);
  const [filters, , setFilters] = useUrlFilter(defaults);
  const search = filters.search;
  const channel = filters.channel;
  const mine = filters.mine === '1';
  const unread = filters.unread === '1';

  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [items, setItems] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkOptions, setLinkOptions] = useState<Application[]>([]);
  const [linking, setLinking] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(() => {
    setLoading(true);
    listConversations({
      search: search || undefined,
      channel: channel || undefined,
      mine,
      unread,
      page: 1,
      pageSize: PAGE_SIZE,
    })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [search, channel, mine, unread]);

  useEffect(() => {
    const t = setTimeout(loadList, 300);
    return () => clearTimeout(t);
  }, [loadList]);

  useEffect(() => {
    listChannels()
      .then((res) => {
        setChannels(res.items);
        setTelegramEnabled(res.telegramEnabled);
      })
      .catch(() => setChannels([]));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    listUsers().then(setUsers).catch(() => {});
  }, [isAdmin]);

  const loadThread = useCallback((id: string) => {
    setLoadingThread(true);
    Promise.all([
      getConversation(id),
      listConversationMessages(id, { page: 1, pageSize: MESSAGES_PAGE_SIZE }),
    ])
      .then(([conv, msgs]) => {
        setActive(conv);
        // Страница 1 — последние сообщения диалога, уже в хронологическом
        // порядке (разворот делает бэкенд, см. messaging.service.ts).
        setMessages(msgs.items);
      })
      .catch(() => {
        setActive(null);
        setMessages([]);
        toast('Диалог недоступен', 'error');
      })
      .finally(() => setLoadingThread(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeId) {
      setActive(null);
      setMessages([]);
      return;
    }
    loadThread(activeId);
    // Отметка «прочитано» отправляется сразу при открытии: счётчик в меню
    // должен отражать реальное состояние, а не «сколько я собирался прочесть».
    markConversationRead(activeId)
      .then(() => {
        setItems((prev) => prev.map((c) => (c.id === activeId ? { ...c, unreadCount: 0 } : c)));
      })
      .catch(() => {});
  }, [activeId, loadThread]);

  // Лента всегда проматывается к последнему сообщению.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Входящее сообщение — обновляем и список, и открытую переписку.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime({
    'conversation:updated': (payload: { id?: string }) => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        loadList();
        if (payload?.id && payload.id === activeId) loadThread(activeId);
      }, 500);
    },
  });

  // Автокомплит заявок для ручной привязки диалога к карточке.
  useEffect(() => {
    const q = linkQuery.trim();
    if (q.length < 2) {
      setLinkOptions([]);
      return;
    }
    const t = setTimeout(() => {
      listApplications({ search: q })
        .then((res) => setLinkOptions(res.slice(0, 10)))
        .catch(() => setLinkOptions([]));
    }, 300);
    return () => clearTimeout(t);
  }, [linkQuery]);

  const channelLabel = (value: string) => channels.find((c) => c.value === value)?.label ?? value;
  const canSend = active ? (channels.find((c) => c.value === active.channel)?.outbound ?? false) : false;

  const onSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !activeId || sending) return;
    setSending(true);
    try {
      const msg = await sendConversationMessage(activeId, text);
      setMessages((prev) => [...prev, msg]);
      setDraft('');
      loadList();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Сообщение не отправлено', 'error');
    } finally {
      setSending(false);
    }
  };

  const onLink = async (applicationId: string) => {
    if (!activeId) return;
    setLinking(true);
    try {
      const updated = await linkConversation(activeId, { applicationId });
      setActive(updated);
      setLinkQuery('');
      setLinkOptions([]);
      toast('Диалог привязан к заявке', 'success');
      loadList();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Не удалось привязать диалог', 'error');
    } finally {
      setLinking(false);
    }
  };

  const onUnlink = async () => {
    if (!activeId) return;
    setLinking(true);
    try {
      const updated = await linkConversation(activeId, { applicationId: '', studentId: '' });
      setActive(updated);
      toast('Привязка снята', 'success');
      loadList();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Не удалось снять привязку', 'error');
    } finally {
      setLinking(false);
    }
  };

  const onAssign = async (userId: string) => {
    if (!activeId) return;
    try {
      const updated = await assignConversation(activeId, userId);
      setActive(updated);
      toast(userId ? 'Ответственный назначен' : 'Ответственный снят', 'success');
      loadList();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Не удалось назначить ответственного', 'error');
    }
  };

  return (
    <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="card-header">
        <h2 className="card-title">Диалоги</h2>
        <div className="conv-count">{total > 0 ? `${total} диалогов` : ''}</div>
      </div>

      {!telegramEnabled && (
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="kb-hint">
            <Icon name="info" size={18} />
            <div>
              Клиентский Telegram-бот не подключён — задайте <code>TELEGRAM_CLIENT_BOT_TOKEN</code> и{' '}
              <code>TELEGRAM_CLIENT_WEBHOOK_SECRET</code> в переменных окружения бэкенда. Раздел уже работает:
              переписка появится сразу после подключения.
            </div>
          </div>
        </div>
      )}

      <div className="conv-layout">
        {/* ------------------------- Список диалогов ------------------------ */}
        <div className="conv-list">
          <div className="conv-filters">
            <input
              placeholder="Имя, телефон, текст..."
              value={search}
              onChange={(e) => setFilters({ search: e.target.value })}
            />
            <select value={channel} onChange={(e) => setFilters({ channel: e.target.value })}>
              <option value="">Все каналы</option>
              {channels.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <div className="conv-chips">
              <button
                className={`conv-chip${mine ? ' active' : ''}`}
                onClick={() => setFilters({ mine: mine ? '' : '1' })}
              >
                Мои
              </button>
              <button
                className={`conv-chip${unread ? ' active' : ''}`}
                onClick={() => setFilters({ unread: unread ? '' : '1' })}
              >
                Непрочитанные
              </button>
            </div>
          </div>

          <div className="conv-items">
            {loading ? (
              <div className="empty">Загрузка...</div>
            ) : items.length === 0 ? (
              <div className="empty">
                <div className="empty-icon"><Icon name="forum" size={40} /></div>
                Диалогов нет
              </div>
            ) : (
              items.map((c) => (
                <button
                  key={c.id}
                  className={`conv-item${c.id === activeId ? ' active' : ''}${c.unreadCount > 0 ? ' unread' : ''}`}
                  onClick={() => setActiveId(c.id)}
                >
                  <div className="conv-item-top">
                    <span className="conv-item-name">
                      {c.title || c.username || c.phone || 'Без имени'}
                    </span>
                    {c.unreadCount > 0 && <span className="conv-badge">{c.unreadCount}</span>}
                  </div>
                  <div className="conv-item-preview">{c.lastMessageText || '—'}</div>
                  <div className="conv-item-meta">
                    <span className="badge badge-info">{channelLabel(c.channel)}</span>
                    {!c.studentId && !c.applicationId && (
                      <span className="badge badge-warning" title="Диалог ещё не привязан к карточке">Не привязан</span>
                    )}
                    <span>{formatDateTimeRu(c.lastMessageAt)}</span>
                  </div>
                </button>
              ))
            )}
            {!loading && total > items.length && (
              <div className="conv-more">
                Показаны последние {items.length} из {total} — уточните поиск
              </div>
            )}
          </div>
        </div>

        {/* --------------------------- Переписка ---------------------------- */}
        <div className="conv-thread">
          {!activeId ? (
            <div className="empty">
              <div className="empty-icon"><Icon name="chat" size={48} /></div>
              Выберите диалог слева
            </div>
          ) : loadingThread && !active ? (
            <div className="empty">Загрузка...</div>
          ) : !active ? (
            <div className="empty">Диалог недоступен</div>
          ) : (
            <>
              <div className="conv-thread-head">
                <div>
                  <div className="conv-thread-name">{active.title || active.username || active.phone || 'Без имени'}</div>
                  <div className="conv-thread-sub">
                    {channelLabel(active.channel)}
                    {active.username && ` · @${active.username}`}
                    {active.phone && ` · ${active.phone}`}
                  </div>
                </div>
                <div className="conv-thread-links">
                  {active.student && (
                    <Link to={`/students/${active.student.id}`} className="btn btn-sm btn-secondary">
                      <Icon name="person" size={16} />
                      {active.student.fullName}
                    </Link>
                  )}
                  {!active.student && active.application && (
                    <Link to={`/applications/${active.application.id}`} className="btn btn-sm btn-secondary">
                      <Icon name="description" size={16} />
                      {active.application.fullName}
                    </Link>
                  )}
                  {(active.student || active.application) && (
                    <button className="btn btn-sm btn-secondary" onClick={onUnlink} disabled={linking} title="Снять привязку">
                      <Icon name="link_off" size={16} />
                    </button>
                  )}
                </div>
              </div>

              {!active.student && !active.application && (
                <div className="conv-link-bar">
                  <Icon name="link" size={16} />
                  <input
                    list="conv-link-options"
                    value={linkQuery}
                    onChange={(e) => setLinkQuery(e.target.value)}
                    placeholder="Привязать к заявке: начните вводить ФИО..."
                    disabled={linking}
                  />
                  <datalist id="conv-link-options">
                    {linkOptions.map((a) => (
                      <option key={a.id} value={`${a.fullName} · ${a.phone}`} />
                    ))}
                  </datalist>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={linking || !linkOptions.some((a) => `${a.fullName} · ${a.phone}` === linkQuery.trim())}
                    onClick={() => {
                      const found = linkOptions.find((a) => `${a.fullName} · ${a.phone}` === linkQuery.trim());
                      if (found) onLink(found.id);
                    }}
                  >
                    Привязать
                  </button>
                </div>
              )}

              {isAdmin && (
                <div className="conv-assign-bar">
                  <label>Ответственный</label>
                  <select value={active.assignedToId ?? ''} onChange={(e) => onAssign(e.target.value)}>
                    <option value="">Не назначен</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.fullName}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="conv-messages" ref={threadRef}>
                <AnimatePresence initial={false}>
                  {messages.map((m) => (
                    <motion.div
                      key={m.id}
                      className={`conv-msg ${m.direction === 'OUTBOUND' ? 'out' : 'in'}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      {m.text && <div className="conv-msg-text">{m.text}</div>}
                      {m.attachments?.map((a, i) => (
                        <div key={i} className="conv-msg-attach">
                          <Icon name="attach_file" size={14} />
                          {a.name || (a.type === 'photo' ? 'Фото' : a.type === 'voice' ? 'Голосовое' : a.type === 'video' ? 'Видео' : 'Файл')}
                        </div>
                      ))}
                      <div className="conv-msg-meta">
                        {m.direction === 'OUTBOUND' && m.author ? `${m.author.fullName} · ` : ''}
                        {formatDateTimeRu(m.sentAt)}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {messages.length === 0 && !loadingThread && <div className="empty">Сообщений пока нет</div>}
              </div>

              {canSend ? (
                <form className="conv-composer" onSubmit={onSend}>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Напишите ответ..."
                    rows={2}
                    maxLength={4000}
                    onKeyDown={(e) => {
                      // Enter отправляет, Shift+Enter — перенос строки:
                      // привычка из любого мессенджера.
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        onSend(e as unknown as React.FormEvent);
                      }
                    }}
                  />
                  <button type="submit" className="btn btn-primary" disabled={!draft.trim() || sending}>
                    <Icon name="send" size={18} />
                    {sending ? '...' : 'Отправить'}
                  </button>
                </form>
              ) : (
                <div className="conv-composer-disabled">
                  <Icon name="info" size={16} />
                  Канал «{channelLabel(active.channel)}» пока работает только на приём — ответить можно из самого мессенджера.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
