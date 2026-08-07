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
import { removeById, replaceById, runOptimistic, tempId } from '../utils/optimistic';
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

  // Живые ссылки на состояние для reconcile: к моменту ответа сервера лента и
  // список могли измениться (пришло входящее по сокету), а замыкание помнит
  // значения на момент отправки. Через ref берём то, что на экране СЕЙЧАС.
  const messagesRef = useRef<ChannelMessage[]>([]);
  const itemsRef = useRef<Conversation[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkOptions, setLinkOptions] = useState<Application[]>([]);
  const [linking, setLinking] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  /**
   * Какой диалог открыт ПРЯМО СЕЙЧАС.
   *
   * Обработчики захватывают activeId в момент клика, а ответ сервера приходит
   * позже — здесь менеджер за это время успевает уйти к следующему диалогу.
   * По этому рефу они проверяют, что правят ту переписку, которая на экране, а
   * не затирают открытую снимком предыдущей.
   */
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  /**
   * `silent` — обновление на фоне: список не подменяется строкой «Загрузка...».
   * Со спиннером остаётся только смена фильтров, ради которой человек и ждёт
   * ответа; входящее сообщение соседу гасить его список не должно.
   */
  const loadList = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
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
    const t = setTimeout(() => loadList(), 300);
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
        // Тихо: событие могло прийти от чужого действия. Заодно это та самая
        // сверка с сервером после локальных правок — список и лента
        // заменяются целиком, поэтому задвоиться нечему.
        loadList({ silent: true });
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

  /**
   * Диалог живёт на экране в двух местах сразу — строкой в списке слева и
   * открытой перепиской справа, — а счётчик над списком считает те же строки.
   * Держим их одним снимком: при отказе сервера откат обязан вернуть всё
   * вместе, иначе шапка покажет привязку, которой в списке уже нет.
   */
  type ConvPair = { items: Conversation[]; total: number; active: Conversation | null };
  const commitPairFor = (conversationId: string) => (next: ConvPair) => {
    setItems(next.items);
    setTotal(next.total);
    // Открытую переписку трогаем, только если она всё ещё открыта: иначе
    // снимок предыдущего диалога вернул бы на экран не то, что человек читает.
    if (activeIdRef.current === conversationId) setActive(next.active);
  };
  /** Одна и та же правка — и в строке списка, и в открытом диалоге. */
  const patchPair = (prev: ConvPair, id: string, patch: Partial<Conversation>): ConvPair => ({
    items: replaceById(prev.items, id, patch),
    total: prev.total,
    active: prev.active && prev.active.id === id ? { ...prev.active, ...patch } : prev.active,
  });

  /** Отправка меняет ленту сообщений и превью строки — тоже одним снимком. */
  type SendPair = { messages: ChannelMessage[]; items: Conversation[] };
  const commitSendTo = (conversationId: string) => (next: SendPair) => {
    // Лента на экране может быть уже чужой — см. activeIdRef. Превью в списке
    // при этом правим всегда: список общий и остаётся на месте.
    if (activeIdRef.current === conversationId) setMessages(next.messages);
    setItems(next.items);
  };

  /**
   * Отправка ответа клиенту.
   *
   * Было: сообщение появлялось в ленте только ПОСЛЕ ответа сервера, а следом
   * перезагружался весь список диалогов — ради одной строки превью. Стало:
   * сообщение встаёт в ленту сразу (с временным id), превью правится точечно,
   * а ответ сервера подменяет временное сообщение настоящим — у него свой id и
   * точное время отправки, которые клиент придумать не может.
   *
   * Порядок строк в списке (сверху свежие) специально НЕ пересчитываем:
   * менеджер работает потоком, и строка, прыгнувшая под курсором, сбивает
   * прицел. Порядок придёт со следующей загрузкой по conversation:updated.
   */
  const onSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !activeId || sending) return;
    const id = activeId;
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
    };
    // Одна отправка за раз, как и раньше: два параллельных запроса откатывались
    // бы каждый на свой снимок ленты, и ответ первого стёр бы второе сообщение.
    setSending(true);
    setDraft('');
    // Результат не разбираем: успех уже на экране, а причину отказа показал
    // onError, вернув текст в поле ввода.
    await runOptimistic<SendPair, ChannelMessage>({
      current: { messages, items },
      optimistic: (prev) => ({
        messages: [...prev.messages, pending],
        items: replaceById(prev.items, id, { lastMessageText: text, lastMessageAt: sentAt }),
      }),
      commit: commitSendTo(id),
      request: () => sendConversationMessage(id, text),
      // Заменяем предсказанное сообщение НА МЕСТЕ, а не дописываем настоящее к
      // снимку «до». Дописывание к снимку тоже не задваивало (снимок ещё без
      // нашей реплики), но было хрупким по двум причинам:
      //  - оно молча полагается на то, что параллельных отправок нет (сейчас их
      //    держит флаг sending; уберут его — ответ первого запроса стёр бы
      //    второе сообщение);
      //  - оно теряет всё, что успело прийти в ленту по сокету, пока летел наш
      //    запрос: входящее сообщение клиента исчезло бы с экрана.
      // Замена по временному id свободна от обоих.
      reconcile: (_prev, msg) => ({
        messages: messagesRef.current.map((m) => (m.id === pending.id ? msg : m)),
        items: replaceById(itemsRef.current, id, { lastMessageText: msg.text ?? text, lastMessageAt: msg.sentAt }),
      }),
      onError: (message) => {
        // Набранный текст возвращаем в поле: потерять готовый ответ вместе с
        // ошибкой хуже самой ошибки. Но только если человек не начал печатать
        // заново — затирать новый текст старым нельзя.
        setDraft((cur) => (cur ? cur : text));
        toast(message, 'error');
      },
    });
    setSending(false);
  };

  /**
   * Привязка диалога к заявке. Предсказуема целиком: заявка уже выбрана в
   * поле, её подпись и владельцы известны — ждать сервер, чтобы показать ровно
   * то же самое, незачем. Поэтому и принимаем сюда саму заявку, а не только id.
   */
  const onLink = async (app: Application) => {
    if (!activeId) return;
    const id = activeId;
    /** Подпись варианта — та же, что в поле поиска: понадобится при откате. */
    const label = `${app.fullName} · ${app.phone}`;
    setLinking(true);
    setLinkQuery('');
    setLinkOptions([]);
    const saved = await runOptimistic<ConvPair, Conversation>({
      current: { items, total, active },
      optimistic: (prev) =>
        patchPair(prev, id, {
          applicationId: app.id,
          application: {
            id: app.id,
            fullName: app.fullName,
            status: app.status,
            managerId: app.managerId,
            chinaManagerId: app.chinaManagerId,
          },
        }),
      commit: commitPairFor(id),
      request: () => linkConversation(id, { applicationId: app.id }),
      // Ответ сервера кладём поверх: вместе с заявкой могли подтянуться
      // студент и ответственный, о которых клиент не знал.
      reconcile: (prev, updated) => patchPair(prev, id, updated),
      onError: (message) => {
        // Возвращаем выбранную заявку в поле — иначе после отказа её пришлось
        // бы искать заново.
        setLinkQuery(label);
        toast(message, 'error');
      },
    });
    setLinking(false);
    if (saved) toast('Диалог привязан к заявке', 'success');
  };

  /** Снятие привязки предсказуемо полностью: обе ссылки просто обнуляются. */
  const onUnlink = async () => {
    if (!activeId) return;
    const id = activeId;
    setLinking(true);
    const saved = await runOptimistic<ConvPair, Conversation>({
      current: { items, total, active },
      optimistic: (prev) =>
        patchPair(prev, id, { studentId: null, student: null, applicationId: null, application: null }),
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
    const patch: Partial<Conversation> = {
      assignedToId: userId || null,
      assignedTo: picked ? { id: picked.id, fullName: picked.fullName } : null,
    };
    /**
     * Фильтр «Мои» на бэкенде — это assignedToId = я (listConversations).
     * Отдав диалог другому, из этого среза он уходит: строка должна исчезнуть
     * сразу, вместе со счётчиком, а не висеть до следующей загрузки. Открытую
     * переписку при этом не закрываем — человек её ещё читает.
     */
    const dropIfNotMine = (next: ConvPair, assignedToId: string | null): ConvPair =>
      mine && assignedToId !== (me?.id ?? null)
        ? { ...next, items: removeById(next.items, id), total: Math.max(0, next.total - 1) }
        : next;
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
                      // Передаём саму заявку, а не id: из неё складывается
                      // предсказанная привязка, которую видно до ответа сервера.
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
