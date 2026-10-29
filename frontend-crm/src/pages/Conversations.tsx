import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  assignConversation,
  conversationPictureUrl,
  getConversation,
  linkConversation,
  listChannels,
  listConversationMessages,
  listConversations,
  markConversationRead,
  releaseConversation,
  retryChatMessage,
  sendChatFile,
  sendChatLocation,
  sendChatVoice,
  sendConversationMessage,
  takeConversation,
  type ChannelMessage,
  type ChannelOption,
  type Conversation,
  type MetaChannelStatus,
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
import { isTempId, removeById, replaceById, runOptimistic, tempId } from '../utils/optimistic';
import { FAILURE_TEXT, isMetaChannel, windowOpen } from '../utils/chatLimits';
import ChatMessageBubble from '../components/chat/ChatMessageBubble';
import ChatComposer, { type ComposerEdit } from '../components/chat/ChatComposer';
import ChatApplicationModal from '../components/chat/ChatApplicationModal';
import Icon from '../Icon';

const PAGE_SIZE = 30;
const MESSAGES_PAGE_SIZE = 100;

const errText = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m || fallback;
};

/** Сообщения по времени; временные (ещё не подтверждённые сервером) — в конце. */
function mergeMessages(...lists: ChannelMessage[][]): ChannelMessage[] {
  const byId = new Map<string, ChannelMessage>();
  for (const list of lists) for (const m of list) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => (a.sentAt === b.sentAt ? a.createdAt.localeCompare(b.createdAt) : a.sentAt.localeCompare(b.sentAt)));
}

/** Короткий сигнал о сообщении клиента (без файла-звука). */
function beep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.06;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.18);
    o.onended = () => void ctx.close();
  } catch {
    /* звук — украшение */
  }
}

const META_STATE_TEXT: Record<MetaChannelStatus['state'], string> = {
  NOT_CONFIGURED: 'не подключён',
  MISCONFIGURED: 'настроен не полностью',
  TOKEN_REFUSED: 'ключ доступа отказан — выпустите новый',
  CONNECTED: 'подключён',
};

/**
 * ТЗ 6.4 — «единое окно» переписки с клиентами: Telegram, а с 29.10.2026 —
 * Instagram Direct и WhatsApp через приложения Meta.
 *
 * Instagram / WhatsApp (решения владельца): все видят все чаты; свободный чат
 * берёт тот, кто ответил первым или нажал «Взять себе»; в занятом чате
 * отвечают ответственный и руководство; заявка — кнопкой из чата. Писать
 * можно 24 часа после последнего сообщения клиента. Telegram — как раньше.
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
  const [metaStatus, setMetaStatus] = useState<MetaChannelStatus[]>([]);
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [items, setItems] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [msgPage, setMsgPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const messagesRef = useRef<ChannelMessage[]>([]);
  const itemsRef = useRef<Conversation[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const [users, setUsers] = useState<User[]>([]);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkOptions, setLinkOptions] = useState<Application[]>([]);
  const [linking, setLinking] = useState(false);
  const [edit, setEdit] = useState<ComposerEdit | null>(null);
  const [appModal, setAppModal] = useState(false);
  const [busyHead, setBusyHead] = useState(false);
  // Окно 24 часа закрывается само — пересчитываем раз в минуту.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const threadRef = useRef<HTMLDivElement>(null);
  /** Лента следует за новыми сообщениями, только когда сотрудник внизу: читающего историю не дёргаем. */
  const stickRef = useRef(true);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const loadList = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    listConversations({ search: search || undefined, channel: channel || undefined, mine, unread, page: 1, pageSize: PAGE_SIZE })
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
    const t = setTimeout(() => loadList(), 300);
    return () => clearTimeout(t);
  }, [loadList]);

  const loadChannels = useCallback(() => {
    listChannels()
      .then((res) => {
        setChannels(res.items);
        setTelegramEnabled(res.telegramEnabled);
        setMetaStatus(res.meta ?? []);
      })
      .catch(() => setChannels([]));
  }, []);
  useEffect(loadChannels, [loadChannels]);

  useEffect(() => {
    if (!isAdmin) return;
    listUsers().then(setUsers).catch(() => {});
  }, [isAdmin]);

  /** Полная загрузка переписки (смена диалога). */
  const loadThread = useCallback((id: string) => {
    setLoadingThread(true);
    stickRef.current = true;
    Promise.all([getConversation(id), listConversationMessages(id, { page: 1, pageSize: MESSAGES_PAGE_SIZE })])
      .then(([conv, msgs]) => {
        if (activeIdRef.current !== id) return;
        setActive(conv);
        setMessages(msgs.items);
        setMsgPage(1);
        setHasMore(msgs.total > msgs.items.length);
      })
      .catch(() => {
        setActive(null);
        setMessages([]);
        toast('Диалог недоступен', 'error');
      })
      .finally(() => setLoadingThread(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Ответ сервера на наш запрос свежее любого опроса, начатого раньше него.
   * Без этого опрос, ушедший до конца отправки, возвращал старую копию
   * сообщения («отправляется» поверх «не ушло»), и «Исправить» в этот миг
   * отправляло исправление новым сообщением вместо замены неушедшего.
   */
  const touchedRef = useRef(new Map<string, number>());
  const activeTouchedRef = useRef(0);
  const refreshSeqRef = useRef(0);
  const touch = (list: ChannelMessage[]) => {
    const t = Date.now();
    list.forEach((m) => touchedRef.current.set(m.id, t));
  };

  /** Обновление открытой переписки по realtime: свежая страница вливается, подгруженная история остаётся. */
  const refreshThread = useCallback((id: string) => {
    const startedAt = Date.now();
    const seq = ++refreshSeqRef.current;
    Promise.all([getConversation(id), listConversationMessages(id, { page: 1, pageSize: MESSAGES_PAGE_SIZE })])
      .then(([conv, msgs]) => {
        // Пока шёл этот опрос, начался более новый — применится он.
        if (activeIdRef.current !== id || seq !== refreshSeqRef.current) return;
        if (activeTouchedRef.current <= startedAt) setActive(conv);
        const fresh = msgs.items.filter((m) => (touchedRef.current.get(m.id) ?? 0) <= startedAt);
        setMessages((prev) => mergeMessages(prev.filter((m) => !isTempId(m.id)), fresh, prev.filter((m) => isTempId(m.id))));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setEdit(null);
    if (!activeId) {
      setActive(null);
      setMessages([]);
      return;
    }
    loadThread(activeId);
    markConversationRead(activeId)
      .then((r) => setItems((prev) => prev.map((c) => (c.id === activeId ? { ...c, unreadCount: r.unreadCount ?? 0 } : c))))
      .catch(() => {});
  }, [activeId, loadThread]);

  useEffect(() => {
    const el = threadRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && hasMore && !loadingOlder && activeId) {
      const id = activeId;
      const next = msgPage + 1;
      const prevHeight = el.scrollHeight;
      setLoadingOlder(true);
      listConversationMessages(id, { page: next, pageSize: MESSAGES_PAGE_SIZE })
        .then((res) => {
          if (activeIdRef.current !== id) return;
          setMessages((prev) => mergeMessages(res.items, prev));
          setMsgPage(next);
          setHasMore(next * MESSAGES_PAGE_SIZE < res.total);
          requestAnimationFrame(() => {
            if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight - prevHeight;
          });
        })
        .catch(() => {})
        .finally(() => setLoadingOlder(false));
    }
  };

  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime({
    'conversation:updated': (payload: { id?: string; inbound?: boolean; assignedToId?: string | null }) => {
      // Сигнал — сообщение клиента в свободном или моём чате, который я сейчас не смотрю.
      if (payload?.inbound && (!payload.assignedToId || payload.assignedToId === me?.id) && (payload.id !== activeIdRef.current || document.hidden)) beep();
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        loadList({ silent: true });
        const id = activeIdRef.current;
        if (payload?.id && payload.id === id) {
          refreshThread(id);
          if (!document.hidden) markConversationRead(id).catch(() => {});
        }
      }, 400);
    },
  });

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
  const channelOutbound = (value: string) => channels.find((c) => c.value === value)?.outbound ?? false;
  const meta = active ? isMetaChannel(active.channel) : false;
  const takenByOther = !!active && meta && !!active.assignedToId && active.assignedToId !== me?.id;
  const canReplyMeta = !!active && meta && (!takenByOther || isAdmin);
  /** Привязать к карточке, создать заявку: в занятом чате Instagram/WhatsApp — ответственный и руководство. */
  const canChangeChat = !meta || !takenByOther || isAdmin;

  /** Почему нельзя ответить (null — можно). */
  const disabledReason = (() => {
    if (!active) return null;
    if (!channelOutbound(active.channel)) {
      return meta
        ? `${channelLabel(active.channel)} ещё не подключён к CRM — ответьте клиенту в самом приложении.`
        : `Канал «${channelLabel(active.channel)}» пока работает только на приём — ответить можно из самого мессенджера.`;
    }
    if (meta && !canReplyMeta) return `Чат ведёт ${active.assignedTo?.fullName ?? 'другой сотрудник'} — отвечать могут ответственный и руководство.`;
    if (meta && !windowOpen(active.lastIncomingAt, now)) return `${FAILURE_TEXT.WINDOW_CLOSED} Ответить можно, когда клиент напишет снова.`;
    return null;
  })();

  type ConvPair = { items: Conversation[]; total: number; active: Conversation | null };
  const commitPairFor = (conversationId: string) => (next: ConvPair) => {
    setItems(next.items);
    setTotal(next.total);
    if (activeIdRef.current === conversationId) {
      activeTouchedRef.current = Date.now();
      setActive(next.active);
    }
  };
  const patchPair = (prev: ConvPair, id: string, patch: Partial<Conversation>): ConvPair => ({
    items: replaceById(prev.items, id, patch),
    total: prev.total,
    active: prev.active && prev.active.id === id ? { ...prev.active, ...patch } : prev.active,
  });

  type SendPair = { messages: ChannelMessage[]; items: Conversation[] };
  const commitSendTo = (conversationId: string) => (next: SendPair) => {
    if (activeIdRef.current === conversationId) setMessages(next.messages);
    setItems(next.items);
  };

  /** Свободный чат Instagram/WhatsApp после ответа становится моим — показываем сразу. */
  const markTakenLocally = (id: string) => {
    if (!active || active.id !== id || !meta || active.assignedToId || !me) return;
    activeTouchedRef.current = Date.now();
    const patch = { assignedToId: me.id, assignedTo: { id: me.id, fullName: me.fullName } };
    setActive((a) => (a && a.id === id ? { ...a, ...patch } : a));
    setItems((prev) => replaceById(prev, id, patch));
  };

  const putMessage = (id: string, msg: ChannelMessage) => {
    touch([msg]);
    if (activeIdRef.current !== id) return;
    stickRef.current = true;
    setMessages((prev) => mergeMessages(prev, [msg]));
  };

  /** Текст: оптимистично в ленту, ответ сервера подменяет временное сообщение (может вернуть несколько частей). */
  const onSendText = async (text: string, editCtx: ComposerEdit | null): Promise<boolean> => {
    if (!activeId) return false;
    const id = activeId;
    if (editCtx?.retry) {
      try {
        const msg = await retryChatMessage(editCtx.messageId, text);
        setEdit(null);
        putMessage(id, msg);
        if (msg.status === 'FAILED') toast(FAILURE_TEXT[msg.error ?? ''] ?? 'Снова не ушло', 'error');
        return true;
      } catch (e) {
        toast(errText(e, 'Не удалось отправить'), 'error');
        return false;
      }
    }
    const sentAt = new Date().toISOString();
    const pending: ChannelMessage = {
      id: tempId(),
      conversationId: id,
      direction: 'OUTBOUND',
      text,
      attachments: null,
      externalId: null,
      authorId: me?.id ?? null,
      author: me ? { id: me.id, fullName: me.fullName } : null,
      sentAt,
      createdAt: sentAt,
      status: meta ? 'SENDING' : null,
    };
    stickRef.current = true;
    let ok = false;
    await runOptimistic<SendPair, ChannelMessage[]>({
      current: { messages, items },
      optimistic: (prev) => ({
        messages: [...prev.messages, pending],
        items: replaceById(prev.items, id, { lastMessageText: text, lastMessageAt: sentAt }),
      }),
      commit: commitSendTo(id),
      request: () => sendConversationMessage(id, text).then((msgs) => (touch(msgs), msgs)),
      reconcile: (_prev, msgs) => ({
        messages: mergeMessages(messagesRef.current.filter((m) => m.id !== pending.id), msgs),
        items: replaceById(itemsRef.current, id, { lastMessageText: msgs[msgs.length - 1]?.text ?? text, lastMessageAt: msgs[msgs.length - 1]?.sentAt ?? sentAt }),
      }),
      onError: (message) => toast(message, 'error'),
    }).then((r) => {
      ok = !!r;
      // Сервер принял, но Meta отказала — причина видна под сообщением, и всплывает подсказка.
      const failed = r?.find((m) => m.status === 'FAILED');
      if (failed) toast(FAILURE_TEXT[failed.error ?? ''] ?? 'Сообщение не ушло', 'error');
    });
    if (ok) {
      setEdit(null);
      markTakenLocally(id);
    }
    return ok;
  };

  const sendWith = async (request: () => Promise<ChannelMessage>, failText: string): Promise<boolean> => {
    if (!activeId) return false;
    const id = activeId;
    try {
      const msg = await request();
      putMessage(id, msg);
      markTakenLocally(id);
      if (msg.status === 'FAILED') toast(FAILURE_TEXT[msg.error ?? ''] ?? 'Сообщение не ушло', 'error');
      return true;
    } catch (e) {
      toast(errText(e, failText), 'error');
      return false;
    }
  };

  const onRetry = async (m: ChannelMessage) => {
    try {
      const msg = await retryChatMessage(m.id);
      putMessage(m.conversationId, msg);
      if (msg.status === 'FAILED') toast(FAILURE_TEXT[msg.error ?? ''] ?? 'Снова не ушло', 'error');
    } catch (e) {
      toast(errText(e, 'Не удалось повторить'), 'error');
    }
  };

  const onEdit = (m: ChannelMessage) => setEdit({ messageId: m.id, text: m.text ?? '', retry: m.status === 'FAILED' });

  /** Буфер обмена; если браузер его не дал (старый браузер, встроенное окно) — запасной способ. */
  const onCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Скопировано', 'success');
      return;
    } catch {
      /* ниже — запасной способ */
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    toast(ok ? 'Скопировано' : 'Не удалось скопировать', ok ? 'success' : 'error');
  };

  const headAction = async (fn: () => Promise<unknown>, okText: string) => {
    if (!activeId) return;
    setBusyHead(true);
    try {
      await fn();
      toast(okText, 'success');
      refreshThread(activeId);
      loadList({ silent: true });
    } catch (e) {
      toast(errText(e, 'Не получилось'), 'error');
    } finally {
      setBusyHead(false);
    }
  };

  const onLink = async (app: Application) => {
    if (!activeId) return;
    const id = activeId;
    const label = `${app.fullName} · ${app.phone}`;
    setLinking(true);
    setLinkQuery('');
    setLinkOptions([]);
    const saved = await runOptimistic<ConvPair, Conversation>({
      current: { items, total, active },
      optimistic: (prev) =>
        patchPair(prev, id, {
          applicationId: app.id,
          application: { id: app.id, fullName: app.fullName, status: app.status, managerId: app.managerId, chinaManagerId: app.chinaManagerId },
        }),
      commit: commitPairFor(id),
      request: () => linkConversation(id, { applicationId: app.id }),
      reconcile: (prev, updated) => patchPair(prev, id, updated),
      onError: (message) => {
        setLinkQuery(label);
        toast(message, 'error');
      },
    });
    setLinking(false);
    if (saved) toast('Диалог привязан к заявке', 'success');
  };

  const onUnlink = async () => {
    if (!activeId) return;
    const id = activeId;
    setLinking(true);
    const saved = await runOptimistic<ConvPair, Conversation>({
      current: { items, total, active },
      optimistic: (prev) => patchPair(prev, id, { studentId: null, student: null, applicationId: null, application: null }),
      commit: commitPairFor(id),
      request: () => linkConversation(id, { applicationId: '', studentId: '' }),
      reconcile: (prev, updated) => patchPair(prev, id, updated),
      onError: (message) => toast(message, 'error'),
    });
    setLinking(false);
    if (saved) toast('Привязка снята', 'success');
  };

  const onAssign = async (userId: string) => {
    if (!activeId) return;
    const id = activeId;
    const picked = users.find((u) => u.id === userId) ?? null;
    const patch: Partial<Conversation> = { assignedToId: userId || null, assignedTo: picked ? { id: picked.id, fullName: picked.fullName } : null };
    const dropIfNotMine = (next: ConvPair, assignedToId: string | null): ConvPair =>
      mine && assignedToId !== (me?.id ?? null) ? { ...next, items: removeById(next.items, id), total: Math.max(0, next.total - 1) } : next;
    const saved = await runOptimistic<ConvPair, Conversation>({
      current: { items, total, active },
      optimistic: (prev) => dropIfNotMine(patchPair(prev, id, patch), userId || null),
      commit: commitPairFor(id),
      request: () => assignConversation(id, userId),
      reconcile: (prev, updated) => dropIfNotMine(patchPair(prev, id, updated), updated.assignedToId),
      onError: (message) => toast(message, 'error'),
    });
    if (saved) toast(userId ? 'Ответственный назначен' : 'Ответственный снят', 'success');
  };

  const displayName = (c: Conversation) => c.title || (c.username ? `@${c.username}` : '') || (c.phone ? `+${c.phone.replace(/^\+/, '')}` : '') || 'Без имени';
  const initials = (c: Conversation) => displayName(c).replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  const metaProblems = metaStatus.filter((m) => m.state === 'MISCONFIGURED' || m.state === 'TOKEN_REFUSED');

  return (
    <motion.div className="card conv-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="card-header">
        <h2 className="card-title">Диалоги</h2>
        <div className="conv-count">{total > 0 ? `${total} диалогов` : ''}</div>
      </div>

      {isAdmin && metaStatus.length > 0 && (
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className={`chat-meta-status${metaProblems.length ? ' warn' : ''}`} data-testid="meta-status">
            {metaStatus.map((m) => (
              <span key={m.value} className={`chat-meta-chip ${m.state.toLowerCase()}`} title={m.missing.length ? `Не хватает: ${m.missing.join(', ')}` : undefined}>
                <strong>{m.value === 'INSTAGRAM' ? 'Instagram' : 'WhatsApp'}</strong>: {META_STATE_TEXT[m.state]}
                {m.account ? ` · ${m.account}` : ''}
                {m.missing.length ? ` (не хватает ${m.missing.join(', ')})` : ''}
                {m.tokenExpiresAt ? ` · ключ до ${new Date(m.tokenExpiresAt).toLocaleDateString('ru-RU')}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {!telegramEnabled && (
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="kb-hint">
            <Icon name="info" size={18} />
            <div>
              Клиентский Telegram-бот не подключён — задайте <code>TELEGRAM_CLIENT_BOT_TOKEN</code> и <code>TELEGRAM_CLIENT_WEBHOOK_SECRET</code> в
              переменных окружения бэкенда.
            </div>
          </div>
        </div>
      )}

      <div className={`conv-layout${activeId ? ' has-active' : ''}`}>
        {/* ------------------------- Список диалогов ------------------------ */}
        <div className="conv-list">
          <div className="conv-filters">
            <input placeholder="Имя, телефон, текст..." value={search} onChange={(e) => setFilters({ search: e.target.value })} />
            <select value={channel} onChange={(e) => setFilters({ channel: e.target.value })}>
              <option value="">Все каналы</option>
              {channels.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <div className="conv-chips">
              <button className={`conv-chip${mine ? ' active' : ''}`} onClick={() => setFilters({ mine: mine ? '' : '1' })}>Мои</button>
              <button className={`conv-chip${unread ? ' active' : ''}`} onClick={() => setFilters({ unread: unread ? '' : '1' })}>Непрочитанные</button>
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
                  data-testid="conv-item"
                >
                  <div className="conv-item-row">
                    <span className={`chat-avatar ch-${c.channel.toLowerCase()}`}>
                      {c.contactPicture ? <img src={conversationPictureUrl(c.id)} alt="" loading="lazy" /> : initials(c)}
                    </span>
                    <div className="conv-item-body">
                      <div className="conv-item-top">
                        <span className="conv-item-name">{displayName(c)}</span>
                        {c.unreadCount > 0 && <span className="conv-badge">{c.unreadCount}</span>}
                      </div>
                      <div className="conv-item-preview">{c.lastMessageText || '—'}</div>
                      <div className="conv-item-meta">
                        <span className={`badge chat-ch-badge ch-${c.channel.toLowerCase()}`}>{channelLabel(c.channel)}</span>
                        {isMetaChannel(c.channel) ? (
                          c.assignedTo ? <span className="chat-owner">Ведёт: {c.assignedTo.fullName}</span> : <span className="badge badge-warning">Свободный</span>
                        ) : (
                          !c.studentId && !c.applicationId && <span className="badge badge-warning" title="Диалог ещё не привязан к карточке">Не привязан</span>
                        )}
                        <span>{formatDateTimeRu(c.lastMessageAt)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
            {!loading && total > items.length && <div className="conv-more">Показаны последние {items.length} из {total} — уточните поиск</div>}
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
                <button type="button" className="conv-back" onClick={() => setActiveId(null)} aria-label="К списку диалогов">
                  <Icon name="arrow_back" size={20} />
                </button>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="conv-thread-name">{displayName(active)}</div>
                  <div className="conv-thread-sub">
                    {channelLabel(active.channel)}
                    {active.username && ` · @${active.username}`}
                    {active.phone && ` · +${active.phone.replace(/^\+/, '')}`}
                    {meta && (active.assignedTo ? ` · ведёт ${active.assignedTo.fullName}` : ' · свободный чат')}
                  </div>
                </div>
                <div className="conv-thread-links">
                  {meta && !active.assignedToId && (
                    <button className="btn btn-sm btn-primary" disabled={busyHead} onClick={() => headAction(() => takeConversation(active.id), 'Чат теперь ваш')} data-testid="take-btn">
                      Взять себе
                    </button>
                  )}
                  {meta && active.assignedToId && (active.assignedToId === me?.id || isAdmin) && (
                    <button className="btn btn-sm btn-secondary" disabled={busyHead} onClick={() => headAction(() => releaseConversation(active.id), 'Чат снова свободен')} data-testid="release-btn">
                      Отпустить
                    </button>
                  )}
                  {meta && canChangeChat && !active.student && !active.application && (
                    <button className="btn btn-sm btn-secondary" onClick={() => setAppModal(true)} data-testid="create-app-btn">
                      <Icon name="note_add" size={16} /> Создать заявку
                    </button>
                  )}
                  {active.student && (
                    <Link to={`/students/${active.student.id}`} className="btn btn-sm btn-secondary">
                      <Icon name="person" size={16} />
                      {active.student.fullName}
                    </Link>
                  )}
                  {!active.student && active.application && (
                    <Link to={`/applications/${active.application.id}`} className="btn btn-sm btn-secondary" data-testid="app-link">
                      <Icon name="description" size={16} />
                      {active.application.fullName}
                    </Link>
                  )}
                  {canChangeChat && (active.student || active.application) && (
                    <button className="btn btn-sm btn-secondary" onClick={onUnlink} disabled={linking} title="Снять привязку">
                      <Icon name="link_off" size={16} />
                    </button>
                  )}
                </div>
              </div>

              {canChangeChat && !active.student && !active.application && (
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
                      if (found) onLink(found);
                    }}
                  >
                    Привязать
                  </button>
                </div>
              )}

              {isAdmin && (
                <div className="conv-assign-bar">
                  <label>Ответственный</label>
                  <select value={active.assignedToId ?? ''} onChange={(e) => onAssign(e.target.value)} data-testid="assign-select">
                    <option value="">Не назначен</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.fullName}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="conv-messages" ref={threadRef} onScroll={onThreadScroll} data-testid="thread">
                {loadingOlder && <div className="conv-more">Загружаем ранние сообщения…</div>}
                {messages.map((m) => (
                  <ChatMessageBubble key={m.id} m={m} canAct={canReplyMeta && !disabledReason} onRetry={onRetry} onEdit={onEdit} onCopy={onCopy} />
                ))}
                {messages.length === 0 && !loadingThread && <div className="empty">Сообщений пока нет</div>}
              </div>

              <ChatComposer
                key={active.id}
                channel={active.channel}
                disabledReason={disabledReason}
                edit={edit}
                onCancelEdit={() => setEdit(null)}
                onSendText={onSendText}
                onSendFile={(file) => sendWith(() => sendChatFile(active.id, file), 'Файл не отправлен')}
                onSendVoice={(blob) => sendWith(() => sendChatVoice(active.id, blob), 'Голосовое не отправлено')}
                onSendLocation={(loc) => sendWith(() => sendChatLocation(active.id, loc), 'Место не отправлено')}
              />
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {appModal && active && (
          <ChatApplicationModal
            key="chat-app"
            conversation={active}
            onClose={() => setAppModal(false)}
            onCreated={() => {
              setAppModal(false);
              toast('Заявка создана и привязана к чату', 'success');
              refreshThread(active.id);
              loadList({ silent: true });
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

