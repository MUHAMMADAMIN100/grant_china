import { Fragment, type ReactNode } from 'react';
import type { ChannelMessage, Conversation } from '../../api/messaging';
import ChatMessageBubble, { type BubblePos } from './ChatMessageBubble';
import Icon from '../../Icon';

/** Новая группа сообщений — если между ними больше 5 минут. */
const GROUP_GAP_MS = 5 * 60_000;
/** Разделитель со временем — если больше 30 минут или другой день. */
const SEPARATOR_GAP_MS = 30 * 60_000;

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** «Сегодня, 10:54», «Вчера, 18:20», «понедельник, 12:00», «12 нояб., 10:00». */
export function separatorLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, now)) return `Сегодня, ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return `Вчера, ${time}`;
  const days = (now.getTime() - d.getTime()) / 86400_000;
  if (days < 6) return `${d.toLocaleDateString('ru-RU', { weekday: 'long' })}, ${time}`;
  const date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return `${date}, ${time}`;
}

/** Кто писал: клиент, ИИ, конкретный сотрудник или «из приложения». */
const authorKey = (m: ChannelMessage) =>
  m.direction === 'INBOUND' ? 'client' : m.byAi ? 'ai' : m.authorId ? `u:${m.authorId}` : m.status ? 'app' : 'none';
const authorLabel = (m: ChannelMessage) =>
  m.byAi ? 'ИИ-помощник' : m.author ? m.author.fullName : m.status ? 'Из приложения Instagram' : null;

/**
 * 21.11.2026 — лента переписки как в Instagram: сообщения подряд от одного
 * человека — группой со скруглёнными стыками, аватар клиента у последнего
 * в группе, время — разделителями между разговорами, под последним нашим
 * сообщением — «Просмотрено» / «Отправлено». Над группой наших сообщений —
 * кто писал (сотрудник или ИИ): в CRM это важно, в Instagram — нет.
 */
export default function ChatMessageList({
  messages,
  conversation,
  avatar,
  showIntro,
  profileUrl,
  aiTyping,
  highlightId,
  canAct,
  canReact,
  canQuote,
  onReply,
  onReact,
  onRetry,
  onEdit,
  onCopy,
  onOpenMedia,
  onJump,
}: {
  messages: ChannelMessage[];
  conversation: Conversation;
  avatar: (size: number) => ReactNode;
  showIntro: boolean;
  profileUrl: string | null;
  aiTyping: boolean;
  highlightId: string | null;
  canAct: boolean;
  canReact: boolean;
  canQuote: boolean;
  onReply: (m: ChannelMessage) => void;
  onReact: (m: ChannelMessage, on: boolean) => void;
  onRetry: (m: ChannelMessage) => void;
  onEdit: (m: ChannelMessage) => void;
  onCopy: (text: string) => void;
  onOpenMedia: (attachmentId: string) => void;
  onJump: (messageId: string) => void;
}) {
  const now = new Date();
  // Последнее наше сообщение со статусом — под ним «Просмотрено» / «Отправлено».
  let lastOutIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].direction === 'OUTBOUND') {
      lastOutIdx = i;
      break;
    }
  }
  // Есть ли после него сообщения клиента: тогда «Просмотрено» уже не нужно.
  const lastOut = lastOutIdx >= 0 ? messages[lastOutIdx] : null;
  const showSeen = !!lastOut && lastOutIdx === messages.length - 1 && !!lastOut.status && lastOut.status !== 'FAILED';
  const seenText = !lastOut ? '' : lastOut.status === 'READ' ? 'Просмотрено' : lastOut.status === 'SENDING' ? 'Отправляется…' : 'Отправлено';

  let lastOutAuthor: string | null = null;

  return (
    <>
      {showIntro && (
        <div className="dm-intro" data-testid="chat-intro">
          {avatar(88)}
          <div className="dm-intro-name">{conversation.title || (conversation.username ? `@${conversation.username}` : 'Клиент')}</div>
          <div className="dm-intro-sub">
            {[conversation.username ? `@${conversation.username}` : null, conversation.channel === 'INSTAGRAM' ? 'Instagram' : conversation.channel === 'WHATSAPP' ? 'WhatsApp' : 'Telegram']
              .filter(Boolean)
              .join(' · ')}
          </div>
          {profileUrl && (
            <a className="dm-btn-soft" href={profileUrl} target="_blank" rel="noreferrer">
              Открыть профиль
            </a>
          )}
        </div>
      )}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const t = new Date(m.sentAt).getTime();
        const sep = !prev || !sameDay(new Date(prev.sentAt), new Date(m.sentAt)) || t - new Date(prev.sentAt).getTime() > SEPARATOR_GAP_MS;
        const nextSep = !next || !sameDay(new Date(m.sentAt), new Date(next.sentAt)) || new Date(next.sentAt).getTime() - t > SEPARATOR_GAP_MS;
        const joinsPrev = !!prev && !sep && authorKey(prev) === authorKey(m) && t - new Date(prev.sentAt).getTime() <= GROUP_GAP_MS && !m.replyToExternalId;
        const joinsNext =
          !!next && !nextSep && authorKey(next) === authorKey(m) && new Date(next.sentAt).getTime() - t <= GROUP_GAP_MS && !next.replyToExternalId;
        const pos: BubblePos = joinsPrev ? (joinsNext ? 'middle' : 'last') : joinsNext ? 'first' : 'single';
        const out = m.direction === 'OUTBOUND';

        let author: string | null = null;
        if (out && !joinsPrev) {
          const key = authorKey(m);
          const label = authorLabel(m);
          if (label && (key !== lastOutAuthor || sep)) author = label;
          lastOutAuthor = key;
        }

        return (
          <Fragment key={m.id}>
            {sep && <div className="dm-sep">{separatorLabel(m.sentAt, now)}</div>}
            {author && (
              <div className={`dm-author${m.byAi ? ' ai' : ''}`} data-testid="msg-author">
                {m.byAi && <Icon name="auto_awesome" size={13} />}
                {author}
              </div>
            )}
            <ChatMessageBubble
              m={m}
              pos={pos}
              avatar={!out && (pos === 'last' || pos === 'single') ? avatar(28) : null}
              canAct={canAct}
              canReact={canReact}
              canQuote={canQuote}
              highlighted={highlightId === m.id}
              onReply={onReply}
              onReact={onReact}
              onRetry={onRetry}
              onEdit={onEdit}
              onCopy={onCopy}
              onOpenMedia={onOpenMedia}
              onJump={onJump}
            />
            {i === lastOutIdx && showSeen && (
              <div className="dm-seen" data-testid="seen-status">
                {seenText}
              </div>
            )}
          </Fragment>
        );
      })}
      {aiTyping && (
        <div className="dm-row out pos-single dm-typing-row" data-testid="ai-typing">
          <div className="dm-col">
            <div className="dm-author ai">
              <Icon name="auto_awesome" size={13} /> ИИ печатает…
            </div>
            <div className="dm-line">
              <div className="dm-bubble dm-typing" aria-label="ИИ печатает">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
