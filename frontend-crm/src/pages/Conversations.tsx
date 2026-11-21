import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  assignConversation,
  attachmentUrl,
  conversationPictureUrl,
  getAiSettings,
  getConversation,
  linkConversation,
  listChannels,
  listConversationMessages,
  listConversations,
  listQuickReplies,
  markConversationRead,
  reactToMessage,
  releaseConversation,
  retryChatMessage,
  sendChatFile,
  sendChatLocation,
  sendChatVoice,
  sendConversationMessage,
  sendTyping,
  setConversationAi,
  takeConversation,
  type AiChatSettings,
  type ChannelMessage,
  type ChannelOption,
  type Conversation,
  type ConversationUpdatedEvent,
  type MetaChannelStatus,
  type QuickReply,
} from '../api/messaging';
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
import ChatMessageList from '../components/chat/ChatMessageList';
import { isViewable, isVideoAtt } from '../components/chat/ChatMessageBubble';
import ChatComposer, { type ComposerEdit } from '../components/chat/ChatComposer';
import ChatApplicationModal from '../components/chat/ChatApplicationModal';
import ChatInfoPanel from '../components/chat/ChatInfoPanel';
import ChatLightbox, { type LightboxItem } from '../components/chat/ChatLightbox';
import AiSettingsModal from '../components/chat/AiSettingsModal';
import QuickRepliesModal from '../components/chat/QuickRepliesModal';
import Icon from '../Icon';
import '../chat-dm.css';

const PAGE_SIZE = 30;
const MESSAGES_PAGE_SIZE = 100;
/** Панель «Сведения» открыта или нет — помнит браузер сотрудника. */
const INFO_KEY = 'gc.chat.info';

const errText = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m || fallback;
};

/** Сообщения по времени; временные (ещё не подтверждённые сервером) — в конце. */
const STATUS_RANK: Record<string, number> = { SENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 };

/** Статус исходящего назад не идёт: запоздавшее «отправляется» не перетрёт «прочитано». */
function newerOf(prev: ChannelMessage, next: ChannelMessage): ChannelMessage {
  const a = prev.status;
  const b = next.status;
  let out = next;
  if (a && b && a !== 'FAILED' && b !== 'FAILED' && (STATUS_RANK[b] ?? 0) < (STATUS_RANK[a] ?? 0)) out = { ...next, status: a };
  // Событие без превью цитаты (старая копия) не стирает уже известное.
  if (out.replyTo === undefined && prev.replyTo !== undefined) out = { ...out, replyTo: prev.replyTo };
  return out;
}

/**
 * Слияние лент по id: более поздний список побеждает (кроме отката статуса).
 * 09.11.2026 — временное сообщение (temp-…) убирается, как только пришло
 * настоящее с той же clientId: так сообщение не задваивается, в каком бы
 * порядке ни пришли ответ на отправку и событие вебсокета.
 */
function mergeMessages(...lists: ChannelMessage[][]): ChannelMessage[] {
  const byId = new Map<string, ChannelMessage>();
  for (const list of lists) {
    for (const m of list) {
      const prev = byId.get(m.id);
      byId.set(m.id, prev ? newerOf(prev, m) : m);
    }
  }
  const confirmed = new Set<string>();
  byId.forEach((m) => {
    if (!isTempId(m.id) && m.clientId) confirmed.add(m.clientId);
  });
  return [...byId.values()]
    .filter((m) => !(isTempId(m.id) && m.clientId && confirmed.has(m.clientId)))
    .sort((a, b) => (a.sentAt === b.sentAt ? a.createdAt.localeCompare(b.createdAt) : a.sentAt.localeCompare(b.sentAt)));
}

/** Список диалогов — свежие сверху, как отдаёт сервер. */
const byLastMessage = (list: Conversation[]) => [...list].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));

/** Метка временного сообщения (ChannelMessage.clientId). */
const newClientId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** «сейчас», «5 мин», «3 ч», «2 дн», «4 нед» — как в списке чатов Instagram. */
function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'сейчас';
  if (s < 3600) return `${Math.floor(s / 60)} мин`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} дн`;
  if (s < 365 * 86400) return `${Math.floor(s / (7 * 86400))} нед`;
  return `${Math.floor(s / (365 * 86400))} г`;
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

const readInfoOpen = () => {
  try {
    return localStorage.getItem(INFO_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * ТЗ 6.4 — «единое окно» переписки с клиентами: Telegram, а с 29.10.2026 —
 * Instagram Direct и WhatsApp через приложения Meta.
 *
 * 21.11.2026 — по виду и удобству как Instagram Direct: список чатов с
 * аватарками слева, переписка с пузырями посередине, «Сведения» о чате
 * справа по кнопке ⓘ (туда переехали ответственный, привязка, «Создать
 * заявку», «Отпустить»); ответ цитатой, ❤️, фото на весь экран, смайлы,
 * быстрые ответы, «Просмотрено» и «печатает…». Плюс ИИ-помощник в Instagram.
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
  // 09.11.2026 — плашка про клиентского Telegram-бота только при неполной настройке.
  const [telegramMisconfigured, setTelegramMisconfigured] = useState(false);
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
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const [users, setUsers] = useState<User[]>([]);
  const [edit, setEdit] = useState<ComposerEdit | null>(null);
  const [replyTo, setReplyTo] = useState<ChannelMessage | null>(null);
  const [appModal, setAppModal] = useState(false);
  const [aiModal, setAiModal] = useState(false);
  const [qrModal, setQrModal] = useState(false);
  const [busyHead, setBusyHead] = useState(false);
  const [infoOpen, setInfoOpen] = useState(readInfoOpen);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<Pick<AiChatSettings, 'enabled' | 'available'> | null>(null);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  /** Чаты, где ИИ сейчас готовит ответ («ИИ печатает…»). */
  const [aiTyping, setAiTyping] = useState<Set<string>>(() => new Set());
  // Окно 24 часа закрывается само, «5 мин» в списке растут — пересчитываем раз в минуту.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(INFO_KEY, infoOpen ? '1' : '0');
    } catch {
      /* не запоминаем — не страшно */
    }
  }, [infoOpen]);

  const threadRef = useRef<HTMLDivElement>(null);
  /** Лента следует за новыми сообщениями, только когда сотрудник внизу: читающего историю не дёргаем. */
  const stickRef = useRef(true);
  const pageRef = useRef<HTMLDivElement>(null);

  // Планшет и телефон: «Диалоги» ровно до низа экрана. Высота меню и шапки
  // там разная (меню сверху с подписями), поэтому меряем, а не угадываем
  // в CSS — иначе поле ответа уезжало под край экрана.
  useLayoutEffect(() => {
    const fit = () => {
      const el = pageRef.current;
      if (!el) return;
      if (window.innerWidth > 900) {
        el.style.height = '';
        return;
      }
      const top = el.getBoundingClientRect().top + window.scrollY;
      // Нижние отступы области раздела и основной колонки — из их стилей.
      const pad = (node: Element | null) => (node ? parseFloat(getComputedStyle(node).paddingBottom) || 0 : 0);
      const gap = pad(el.closest('.content')) + pad(el.closest('.main'));
      el.style.height = `${Math.max(420, Math.floor(window.innerHeight - top - gap))}px`;
    };
    fit();
    // Ещё раз — когда закончится входная анимация страницы (она сдвигает её на 10px).
    const t = setTimeout(fit, 400);
    window.addEventListener('resize', fit);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', fit);
    };
  }, []);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  // 09.11.2026 — ссылка «открыть переписку» из воронки и из уведомлений: /conversations?c=<id>.
  // Открываем один раз и убираем параметр, чтобы «назад» к списку не открывал чат снова.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const c = searchParams.get('c');
    if (!c) return;
    setActiveId(c);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('c');
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadList = useCallback(
    (opts?: { silent?: boolean }) => {
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
    },
    [search, channel, mine, unread],
  );

  useEffect(() => {
    const t = setTimeout(() => loadList(), 300);
    return () => clearTimeout(t);
  }, [loadList]);

  const loadChannels = useCallback(() => {
    listChannels()
      .then((res) => {
        setChannels(res.items);
        setTelegramMisconfigured(!!res.telegramMisconfigured);
        setMetaStatus(res.meta ?? []);
      })
      .catch(() => setChannels([]));
  }, []);
  useEffect(loadChannels, [loadChannels]);

  const loadAi = useCallback(() => {
    getAiSettings()
      .then((r) => setAiSettings({ enabled: r.enabled, available: r.available }))
      .catch(() => setAiSettings(null));
  }, []);
  useEffect(loadAi, [loadAi]);

  const loadQuick = useCallback(() => {
    listQuickReplies()
      .then(setQuickReplies)
      .catch(() => {});
  }, []);
  useEffect(loadQuick, [loadQuick]);

  useEffect(() => {
    if (!isAdmin) return;
    listUsers()
      .then(setUsers)
      .catch(() => {});
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

  /** Когда открыли чат: касание по строке списка не должно «доходить» до шапки переписки. */
  const openedAtRef = useRef(0);
  useEffect(() => {
    openedAtRef.current = Date.now();
    setEdit(null);
    setReplyTo(null);
    setLightbox(null);
    setHighlightId(null);
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
  }, [messages, aiTyping]);

  // Фото и видео догружаются после прокрутки вниз и раздвигают ленту —
  // если сотрудник был внизу, остаёмся внизу.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const onLoad = () => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    };
    el.addEventListener('load', onLoad, true);
    el.addEventListener('loadedmetadata', onLoad, true);
    return () => {
      el.removeEventListener('load', onLoad, true);
      el.removeEventListener('loadedmetadata', onLoad, true);
    };
  }, [active?.id]);

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
  const threadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime({
    'conversation:updated': (payload: ConversationUpdatedEvent) => {
      // Сигнал — сообщение клиента в свободном или моём чате, который я сейчас не смотрю.
      if (payload?.inbound && (!payload.assignedToId || payload.assignedToId === me?.id) && (payload.id !== activeIdRef.current || document.hidden)) beep();
      const activeNow = activeIdRef.current;
      const isActive = !!payload?.id && payload.id === activeNow;

      // 09.11.2026 — Instagram/WhatsApp: строка диалога и сообщения уже в событии —
      // показываем сразу, без пауз и повторных запросов.
      const conv = payload?.conversation;
      if (conv) {
        setItems((prev) => (prev.some((c) => c.id === conv.id) ? byLastMessage(replaceById(prev, conv.id, conv)) : prev));
        if (isActive && activeTouchedRef.current < Date.now() - 1500) setActive(conv);
      }
      if (isActive && payload.messages?.length) {
        // ❤️ в очереди на отправку — на экране остаётся последнее желание сотрудника,
        // промежуточные события сервера его не перещёлкивают.
        const incoming = payload.messages.map((pm) => {
          const w = reactWanted(pm.id);
          return w === null ? pm : { ...pm, ourReaction: w ? '❤️' : null };
        });
        touch(incoming);
        setMessages((prev) => mergeMessages(prev, incoming));
        if (payload.inbound && !document.hidden) {
          markConversationRead(activeNow!)
            .then((r) => setItems((prev) => prev.map((c) => (c.id === activeNow ? { ...c, unreadCount: r.unreadCount ?? 0 } : c))))
            .catch(() => {});
        }
      }

      // Список сверяем с сервером фоном: новый диалог, фильтры, счётчик.
      // Строку, которая уже на экране, событие обновило выше — это не мигнёт.
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(
        () => {
          reloadTimerRef.current = null;
          loadList({ silent: true });
        },
        conv ? 1200 : 400,
      );

      // Событие без сообщений (Telegram, назначение, «взять себе») — ленту перезапрашиваем.
      if (isActive && !payload.messages) {
        if (threadTimerRef.current) clearTimeout(threadTimerRef.current);
        threadTimerRef.current = setTimeout(
          () => {
            threadTimerRef.current = null;
            const id = activeIdRef.current;
            if (!id || id !== payload.id) return;
            refreshThread(id);
            if (!document.hidden) markConversationRead(id).catch(() => {});
          },
          conv ? 0 : 300,
        );
      }
    },
    // 21.11.2026 — «ИИ печатает…».
    'conversation:typing': (p: { id?: string; ai?: boolean; on?: boolean }) => {
      if (!p?.id) return;
      setAiTyping((prev) => {
        const next = new Set(prev);
        if (p.on) next.add(p.id!);
        else next.delete(p.id!);
        return next;
      });
    },
    'ai-chat:settings': () => loadAi(),
    'quick-replies:updated': () => loadQuick(),
  });
  useEffect(
    () => () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      if (threadTimerRef.current) clearTimeout(threadTimerRef.current);
    },
    [],
  );

  const channelLabel = (value: string) => channels.find((c) => c.value === value)?.label ?? (value === 'INSTAGRAM' ? 'Instagram' : value === 'WHATSAPP' ? 'WhatsApp' : value);
  const channelOutbound = (value: string) => channels.find((c) => c.value === value)?.outbound ?? false;
  const meta = active ? isMetaChannel(active.channel) : false;
  const takenByOther = !!active && meta && !!active.assignedToId && active.assignedToId !== me?.id;
  const canReplyMeta = !!active && meta && (!takenByOther || isAdmin);
  /** Привязать к карточке, создать заявку, ИИ в чате: в занятом чате Instagram/WhatsApp — ответственный и руководство. */
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

  /** ИИ сейчас отвечает в этом чате сам. */
  const aiActive = (c: Conversation) =>
    c.channel === 'INSTAGRAM' && !!aiSettings?.enabled && !!aiSettings.available && !c.aiOff && !c.assignedToId && windowOpen(c.lastIncomingAt, now);

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

  /** Свободный чат Instagram/WhatsApp после ответа становится моим — показываем сразу. */
  const markTakenLocally = (id: string) => {
    if (!active || active.id !== id || !meta || active.assignedToId || !me) return;
    activeTouchedRef.current = Date.now();
    const patch = { assignedToId: me.id, assignedTo: { id: me.id, fullName: me.fullName }, aiHandoffAt: null, aiHandoffReason: null };
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
  const onSendText = async (text: string, editCtx: ComposerEdit | null, replyCtx: ChannelMessage | null): Promise<boolean> => {
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
    // 09.11.2026 — у временного сообщения метка clientId: настоящее приходит с
    // ней же (в ответе или раньше — событием вебсокета) и встаёт на его место.
    const clientId = newClientId();
    const quote = replyCtx && !editCtx ? replyCtx : null;
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
      clientId,
      ...(quote
        ? {
            replyToExternalId: quote.externalId,
            replyTo: {
              id: quote.id,
              direction: quote.direction,
              byAi: !!quote.byAi,
              text: quote.text,
              kind: quote.chatAttachments?.[0]?.kind ?? null,
              deleted: !!quote.deletedByContactAt,
            },
          }
        : {}),
    };
    stickRef.current = true;
    if (activeIdRef.current === id) setMessages((prev) => [...prev, pending]);
    setItems((prev) => byLastMessage(replaceById(prev, id, { lastMessageText: text, lastMessageAt: sentAt })));
    setReplyTo(null);
    try {
      const msgs = await sendConversationMessage(id, text, clientId, quote?.id);
      touch(msgs);
      if (activeIdRef.current === id) setMessages((prev) => mergeMessages(prev.filter((m) => m.id !== pending.id), msgs));
      const last = msgs[msgs.length - 1];
      setItems((prev) => replaceById(prev, id, { lastMessageText: last?.text ?? text, lastMessageAt: last?.sentAt ?? sentAt }));
      // Сервер принял, но Meta отказала — причина видна под сообщением, и всплывает подсказка.
      const failed = msgs.find((m) => m.status === 'FAILED');
      if (failed) toast(FAILURE_TEXT[failed.error ?? ''] ?? 'Сообщение не ушло', 'error');
      setEdit(null);
      markTakenLocally(id);
      return true;
    } catch (e) {
      // Убираем только своё временное сообщение: всё, что за это время пришло
      // по вебсокету, остаётся на месте (раньше лента откатывалась к снимку).
      if (activeIdRef.current === id) setMessages((prev) => prev.filter((m) => m.id !== pending.id));
      if (quote && activeIdRef.current === id) setReplyTo(quote);
      loadList({ silent: true });
      toast(errText(e, 'Не удалось отправить'), 'error');
      return false;
    }
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

  const onEdit = (m: ChannelMessage) => {
    setReplyTo(null);
    setEdit({ messageId: m.id, text: m.text ?? '', retry: m.status === 'FAILED' });
  };

  const onReply = (m: ChannelMessage) => {
    setEdit(null);
    setReplyTo(m);
  };

  /**
   * ❤️ — сразу на экране, сервер подтверждает; не вышло — откат и причина.
   * Щелчки по одному сообщению уходят СТРОГО по очереди: при быстром «поставил —
   * снял» ответ на первый запрос приходил после второго щелчка и возвращал
   * сердечко обратно (а у Meta порядок react/unreact мог перепутаться). Пока
   * очередь не пуста, на экране — последнее желание сотрудника.
   */
  const reactQueueRef = useRef(new Map<string, { busy: boolean; want: boolean }>());
  const reactWanted = (id: string): boolean | null => {
    const st = reactQueueRef.current.get(id);
    return st ? st.want : null;
  };
  const onReact = async (m: ChannelMessage, on: boolean) => {
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ourReaction: on ? '❤️' : null } : x)));
    const queue = reactQueueRef.current;
    const st = queue.get(m.id) ?? { busy: false, want: on };
    st.want = on;
    queue.set(m.id, st);
    if (st.busy) return;
    st.busy = true;
    let confirmed: boolean = !!m.ourReaction;
    let last: ChannelMessage | null = null;
    try {
      while (confirmed !== st.want) {
        const want = st.want;
        last = await reactToMessage(m.id, want ? '❤️' : null);
        confirmed = want;
      }
    } catch (e) {
      toast(errText(e, 'Реакция не ушла'), 'error');
    } finally {
      queue.delete(m.id);
      const final = last ? { ...last, ourReaction: confirmed ? '❤️' : null } : null;
      if (final) touch([final]);
      setMessages((prev) => prev.map((x) => (x.id === m.id ? (final ? { ...x, ...final } : { ...x, ourReaction: confirmed ? '❤️' : null }) : x)));
    }
  };

  /** Щелчок по цитате — к исходному сообщению с подсветкой. */
  const onJump = (messageId: string) => {
    const el = threadRef.current?.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
    if (!el) {
      toast('Это сообщение выше — пролистайте переписку вверх', 'info');
      return;
    }
    stickRef.current = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(messageId);
    setTimeout(() => setHighlightId((h) => (h === messageId ? null : h)), 1600);
  };

  const typingRef = useRef(0);
  const onTyping = () => {
    if (!activeId || !active || active.channel !== 'INSTAGRAM' || disabledReason) return;
    if (Date.now() - typingRef.current < 3000) return;
    typingRef.current = Date.now();
    sendTyping(activeId).catch(() => {});
  };

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
    setBusyHead(true);
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
      onError: (message) => toast(message, 'error'),
    });
    setBusyHead(false);
    if (saved) toast('Диалог привязан к заявке', 'success');
  };

  const onUnlink = async () => {
    if (!activeId) return;
    const id = activeId;
    setBusyHead(true);
    const saved = await runOptimistic<ConvPair, Conversation>({
      current: { items, total, active },
      optimistic: (prev) => patchPair(prev, id, { studentId: null, student: null, applicationId: null, application: null }),
      commit: commitPairFor(id),
      request: () => linkConversation(id, { applicationId: '', studentId: '' }),
      reconcile: (prev, updated) => patchPair(prev, id, updated),
      onError: (message) => toast(message, 'error'),
    });
    setBusyHead(false);
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

  /** ИИ в этом чате: выключить/включить или «Понятно» на просьбу о менеджере. */
  const onAi = async (payload: { off?: boolean; clearHandoff?: boolean }, okText: string) => {
    if (!activeId) return;
    const id = activeId;
    const patch: Partial<Conversation> = {
      ...(payload.off !== undefined ? { aiOff: payload.off, aiOffReason: payload.off ? 'STAFF' : null } : {}),
      ...(payload.clearHandoff ? { aiHandoffAt: null, aiHandoffReason: null } : {}),
    };
    setBusyHead(true);
    const saved = await runOptimistic<ConvPair, Conversation>({
      current: { items, total, active },
      optimistic: (prev) => patchPair(prev, id, patch),
      commit: commitPairFor(id),
      request: () => setConversationAi(id, payload),
      reconcile: (prev, updated) => patchPair(prev, id, updated),
      onError: (message) => toast(message, 'error'),
    });
    setBusyHead(false);
    if (saved) toast(okText, 'success');
  };

  const displayName = (c: Conversation) => c.title || (c.username ? `@${c.username}` : '') || (c.phone ? `+${c.phone.replace(/^\+/, '')}` : '') || 'Без имени';
  const initials = (c: Conversation) =>
    displayName(c)
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase() || '?';
  const avatar = (c: Conversation, size: number, extra?: string) => (
    <span className={`dm-avatar ch-${c.channel.toLowerCase()}${extra ? ` ${extra}` : ''}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {c.contactPicture ? <img src={conversationPictureUrl(c.id)} alt="" loading="lazy" /> : initials(c)}
    </span>
  );
  const metaProblems = metaStatus.filter((m) => m.state === 'MISCONFIGURED' || m.state === 'TOKEN_REFUSED');
  const igStatus = metaStatus.find((m) => m.value === 'INSTAGRAM');
  const accountTitle = igStatus?.account && igStatus.state === 'CONNECTED' ? igStatus.account.replace(/^@/, '') : 'Диалоги';

  /** Все фото и видео загруженной переписки — для просмотра на весь экран. */
  const mediaItems: LightboxItem[] = useMemo(() => {
    const list: LightboxItem[] = [];
    for (const m of messages) {
      if (m.deletedByContactAt) continue;
      for (const a of m.chatAttachments ?? []) {
        if (!isViewable(a)) continue;
        const who = m.direction === 'INBOUND' ? active ? displayName(active) : 'Клиент' : m.byAi ? 'ИИ-помощник' : m.author?.fullName ?? 'Вы';
        list.push({ id: a.id, src: attachmentUrl(a.id), kind: isVideoAtt(a) ? 'video' : 'image', caption: `${who} · ${formatDateTimeRu(m.sentAt)}` });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, active?.id]);

  const statusLine = (c: Conversation): { text: string; cls: string } | null => {
    if (isMetaChannel(c.channel)) {
      if (c.aiHandoffAt) return { text: 'Нужен менеджер', cls: 'warn' };
      if (c.assignedTo) return { text: c.assignedToId === me?.id ? 'Ведёте вы' : `Ведёт ${c.assignedTo.fullName}`, cls: '' };
      if (aiActive(c)) return { text: 'ИИ отвечает', cls: 'ai' };
      return null;
    }
    if (!c.studentId && !c.applicationId) return { text: 'Не привязан к карточке', cls: '' };
    return null;
  };

  const showInfo = infoOpen && !!active;

  return (
    <motion.div ref={pageRef} className="dm-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} data-testid="dm-page">
      <div className={`dm-layout${activeId ? ' has-active' : ''}${showInfo ? ' has-info' : ''}`}>
        {/* ------------------------- Список чатов ------------------------ */}
        <div className="dm-list">
          <div className="dm-list-head">
            <div className="dm-list-title" title={total ? `${total} диалогов` : undefined}>
              <span>{accountTitle}</span>
              {igStatus?.state === 'CONNECTED' && <span className="dm-online" title="Instagram подключён" />}
            </div>
            {isAdmin && (
              <div className="dm-list-tools">
                <button type="button" className="dm-icon-btn" onClick={() => setQrModal(true)} title="Быстрые ответы" aria-label="Быстрые ответы" data-testid="qr-open">
                  <Icon name="bolt" size={22} />
                </button>
                <button
                  type="button"
                  className={`dm-icon-btn${aiSettings?.enabled ? ' ai-on' : ''}`}
                  onClick={() => setAiModal(true)}
                  title={aiSettings?.enabled ? 'ИИ-помощник включён — настройки' : 'ИИ-помощник выключен — настройки'}
                  aria-label="ИИ-помощник"
                  data-testid="ai-open"
                >
                  <Icon name="auto_awesome" size={22} />
                </button>
              </div>
            )}
          </div>

          {isAdmin && metaProblems.length > 0 && (
            <div className="dm-warn" data-testid="meta-status">
              {metaProblems.map((m) => (
                <div key={m.value}>
                  <Icon name="warning" size={16} />
                  <span>
                    <strong>{m.value === 'INSTAGRAM' ? 'Instagram' : 'WhatsApp'}</strong>: {META_STATE_TEXT[m.state]}
                    {m.account ? ` · ${m.account}` : ''}
                    {m.missing.length ? ` (не хватает ${m.missing.join(', ')})` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
          {isAdmin && telegramMisconfigured && (
            <div className="dm-warn">
              <div>
                <Icon name="info" size={16} />
                <span>
                  Клиентский Telegram-бот настроен не полностью — задайте <code>TELEGRAM_CLIENT_WEBHOOK_SECRET</code>.
                </span>
              </div>
            </div>
          )}

          <div className="dm-search">
            <Icon name="search" size={18} />
            <input placeholder="Поиск: имя, ник, телефон" value={search} onChange={(e) => setFilters({ search: e.target.value })} data-testid="conv-search" />
            {search && (
              <button type="button" onClick={() => setFilters({ search: '' })} aria-label="Очистить поиск">
                <Icon name="cancel" size={16} />
              </button>
            )}
          </div>

          <div className="dm-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={!mine && !unread} className={`dm-tab${!mine && !unread ? ' active' : ''}`} onClick={() => setFilters({ mine: '', unread: '' })}>
              Все
            </button>
            <button type="button" role="tab" aria-selected={mine} className={`dm-tab${mine ? ' active' : ''}`} onClick={() => setFilters({ mine: mine ? '' : '1' })} data-testid="tab-mine">
              Мои
            </button>
            <button type="button" role="tab" aria-selected={unread} className={`dm-tab${unread ? ' active' : ''}`} onClick={() => setFilters({ unread: unread ? '' : '1' })} data-testid="tab-unread">
              Непрочитанные
            </button>
            {channels.length > 1 && (
              <select className="dm-channel-select" value={channel} onChange={(e) => setFilters({ channel: e.target.value })} aria-label="Канал" data-testid="channel-select">
                <option value="">Все каналы</option>
                {channels.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="dm-items">
            {loading ? (
              <div className="dm-empty">Загрузка…</div>
            ) : items.length === 0 ? (
              <div className="dm-empty">
                <Icon name="forum" size={40} />
                <div>{search || mine || unread || channel ? 'Ничего не найдено' : 'Диалогов пока нет'}</div>
              </div>
            ) : (
              items.map((c) => {
                const st = statusLine(c);
                const unreadNow = c.unreadCount > 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`dm-item${c.id === activeId ? ' active' : ''}${unreadNow ? ' unread' : ''}`}
                    onClick={() => setActiveId(c.id)}
                    title={displayName(c)}
                    data-testid="conv-item"
                  >
                    <span className="dm-item-avatar">
                      {avatar(c, 56)}
                      {c.channel !== 'INSTAGRAM' && <span className={`dm-ch-mark ch-${c.channel.toLowerCase()}`} title={channelLabel(c.channel)} />}
                    </span>
                    <span className="dm-item-body">
                      <span className="dm-item-name">{displayName(c)}</span>
                      <span className="dm-item-preview">
                        <span className="dm-item-text">{c.lastMessageText || '—'}</span>
                        <span className="dm-item-dot">·</span>
                        <span className="dm-item-ago">{ago(c.lastMessageAt, now)}</span>
                      </span>
                      {st && (
                        <span className={`dm-item-status ${st.cls}`} data-testid="conv-status">
                          {st.cls === 'ai' && <Icon name="auto_awesome" size={12} />}
                          {st.cls === 'warn' && <Icon name="support_agent" size={13} />}
                          {st.text}
                        </span>
                      )}
                    </span>
                    {unreadNow && <span className="dm-unread-dot" title={`Непрочитанных: ${c.unreadCount}`} data-testid="unread-dot" />}
                  </button>
                );
              })
            )}
            {!loading && total > items.length && (
              <div className="dm-more">
                Показаны последние {items.length} из {total} — уточните поиск
              </div>
            )}
          </div>
        </div>

        {/* --------------------------- Переписка ---------------------------- */}
        <div className="dm-thread">
          {!activeId ? (
            <div className="dm-empty dm-empty-thread">
              <span className="dm-empty-ring">
                <Icon name="send" size={40} />
              </span>
              <div className="dm-empty-title">Ваши сообщения</div>
              <div>Выберите чат слева, чтобы начать переписку.</div>
            </div>
          ) : loadingThread && !active ? (
            <div className="dm-empty">Загрузка…</div>
          ) : !active ? (
            <div className="dm-empty">Диалог недоступен</div>
          ) : (
            <>
              <div className="dm-thread-head">
                <button type="button" className="dm-icon-btn dm-back" onClick={() => setActiveId(null)} aria-label="К списку диалогов">
                  <Icon name="arrow_back" size={24} />
                </button>
                <button
                  type="button"
                  className="dm-thread-who"
                  onClick={() => {
                    // На телефоне то же касание, что открыло чат из списка, приходит
                    // и сюда (шапка оказывается под пальцем) — «Сведения» открывались сами.
                    if (Date.now() - openedAtRef.current < 600) return;
                    setInfoOpen(true);
                  }}
                  title="Сведения о чате"
                >
                  {avatar(active, 44)}
                  <span className="dm-thread-names">
                    <span className="dm-thread-name">{displayName(active)}</span>
                    <span className="dm-thread-sub">
                      {[
                        active.username ? `@${active.username}` : channelLabel(active.channel),
                        meta ? (active.assignedTo ? (active.assignedToId === me?.id ? 'ведёте вы' : `ведёт ${active.assignedTo.fullName}`) : aiActive(active) ? 'отвечает ИИ' : 'свободный чат') : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </button>
                <div className="dm-thread-actions">
                  {active.aiHandoffAt && (
                    <button type="button" className="dm-pill warn" onClick={() => setInfoOpen(true)} title={active.aiHandoffReason ?? undefined} data-testid="handoff-pill">
                      <Icon name="support_agent" size={16} /> <span className="dm-pill-text">Нужен менеджер</span>
                    </button>
                  )}
                  {meta && !active.assignedToId && (
                    <button type="button" className="dm-btn-primary" disabled={busyHead} onClick={() => headAction(() => takeConversation(active.id), 'Чат теперь ваш')} data-testid="head-take-btn">
                      Взять себе
                    </button>
                  )}
                  <button
                    type="button"
                    className={`dm-icon-btn${showInfo ? ' on' : ''}`}
                    onClick={() => setInfoOpen((v) => !v)}
                    title="Сведения"
                    aria-label="Сведения"
                    aria-pressed={showInfo}
                    data-testid="info-toggle"
                  >
                    <Icon name="info" size={26} />
                  </button>
                </div>
              </div>

              <div className="dm-messages" ref={threadRef} onScroll={onThreadScroll} data-testid="thread">
                {loadingOlder && <div className="dm-more">Загружаем ранние сообщения…</div>}
                <ChatMessageList
                  messages={messages}
                  conversation={active}
                  avatar={(size) => avatar(active, size)}
                  showIntro={!hasMore && !loadingThread}
                  profileUrl={active.channel === 'INSTAGRAM' && active.username ? `https://www.instagram.com/${encodeURIComponent(active.username)}/` : null}
                  aiTyping={aiTyping.has(active.id)}
                  highlightId={highlightId}
                  canAct={meta ? canReplyMeta && !disabledReason : !disabledReason}
                  canReact={meta}
                  canQuote={meta}
                  onReply={onReply}
                  onReact={onReact}
                  onRetry={onRetry}
                  onEdit={onEdit}
                  onCopy={onCopy}
                  onOpenMedia={(attId) => setLightbox(attId)}
                  onJump={onJump}
                />
                {messages.length === 0 && !loadingThread && <div className="dm-empty small">Сообщений пока нет</div>}
              </div>

              <ChatComposer
                key={active.id}
                channel={active.channel}
                disabledReason={disabledReason}
                edit={edit}
                onCancelEdit={() => setEdit(null)}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                quickReplies={quickReplies}
                canManageQuickReplies={isAdmin}
                onManageQuickReplies={() => setQrModal(true)}
                onTyping={onTyping}
                onSendText={onSendText}
                onSendFile={(file) => sendWith(() => sendChatFile(active.id, file), 'Файл не отправлен')}
                onSendVoice={(blob) => sendWith(() => sendChatVoice(active.id, blob), 'Голосовое не отправлено')}
                onSendLocation={(loc) => sendWith(() => sendChatLocation(active.id, loc), 'Место не отправлено')}
              />
            </>
          )}
        </div>

        {/* --------------------------- Сведения ---------------------------- */}
        {showInfo && active && (
          <ChatInfoPanel
            conversation={active}
            meId={me?.id ?? null}
            isAdmin={isAdmin}
            users={users}
            channelLabel={channelLabel(active.channel)}
            canChangeChat={canChangeChat}
            ai={aiSettings}
            busy={busyHead}
            avatar={avatar(active, 88)}
            now={now}
            onClose={() => setInfoOpen(false)}
            onTake={() => headAction(() => takeConversation(active.id), 'Чат теперь ваш')}
            onRelease={() => headAction(() => releaseConversation(active.id), 'Чат снова свободен')}
            onAssign={onAssign}
            onLink={onLink}
            onUnlink={onUnlink}
            onCreateApp={() => setAppModal(true)}
            onToggleAi={(off) => onAi({ off }, off ? 'ИИ в этом чате выключен' : 'ИИ в этом чате включён')}
            onClearHandoff={() => onAi({ clearHandoff: true }, 'Отметка снята')}
          />
        )}
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
        {aiModal && <AiSettingsModal key="ai" onClose={() => setAiModal(false)} onSaved={(s) => setAiSettings({ enabled: s.enabled, available: s.available })} />}
        {qrModal && <QuickRepliesModal key="qr" items={quickReplies} onClose={() => setQrModal(false)} onChanged={setQuickReplies} />}
        {lightbox && mediaItems.length > 0 && <ChatLightbox key="lb" items={mediaItems} startId={lightbox} onClose={() => setLightbox(null)} />}
      </AnimatePresence>
    </motion.div>
  );
}
