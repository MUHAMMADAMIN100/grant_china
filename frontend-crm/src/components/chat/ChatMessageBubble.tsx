import { useEffect, useRef, useState, type ReactNode } from 'react';
import { attachmentUrl, type ChannelMessage, type ChatAttachment, type ReplyPreview } from '../../api/messaging';
import { formatDateTimeRu } from '../../utils/datetime';
import { FAILURE_TEXT } from '../../utils/chatLimits';
import Icon from '../../Icon';
import StaticMap, { mapLink } from './StaticMap';

const fmtSize = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1048576).toFixed(1)} МБ`);

const KIND_LABEL: Record<string, string> = {
  IMAGE: 'Фото',
  VIDEO: 'Видео',
  AUDIO: 'Голосовое',
  FILE: 'Файл',
  STICKER: 'Стикер',
  SHARE: 'Публикация',
  REEL: 'Reels',
  STORY: 'История',
  LOCATION: 'Место',
  CONTACT: 'Контакт',
};

/** Фото/видео, которые открываются на весь экран. */
export const isViewable = (a: ChatAttachment) =>
  !!a.storedName &&
  (a.kind === 'IMAGE' ||
    a.kind === 'VIDEO' ||
    ((a.kind === 'REEL' || a.kind === 'STORY' || a.kind === 'SHARE') && !!a.mimeType && (a.mimeType.startsWith('image/') || a.mimeType.startsWith('video/'))));
export const isVideoAtt = (a: ChatAttachment) => a.kind === 'VIDEO' || (!!a.mimeType && a.mimeType.startsWith('video/'));

function Attachment({ a, onOpen }: { a: ChatAttachment; onOpen: (id: string) => void }) {
  const src = a.storedName ? attachmentUrl(a.id) : null;
  if (a.kind === 'LOCATION' && a.latitude != null && a.longitude != null) {
    return (
      <div className="dm-att dm-att-location">
        <StaticMap lat={a.latitude} lon={a.longitude} />
        {(a.name || a.address) && <div className="dm-att-caption">{[a.name, a.address].filter(Boolean).join(', ')}</div>}
        <a href={mapLink(a.latitude, a.longitude)} target="_blank" rel="noreferrer" className="dm-att-link">
          Открыть на карте
        </a>
      </div>
    );
  }
  if (a.kind === 'CONTACT') {
    return (
      <div className="dm-att dm-att-row">
        <Icon name="contact_phone" size={18} />
        <span>{[a.name, a.address].filter(Boolean).join(' · ') || 'Контакт'}</span>
      </div>
    );
  }
  if (a.kind === 'UNSUPPORTED') return <div className="dm-att dm-att-muted">Сообщение этого типа CRM не показывает — посмотрите в приложении.</div>;
  if (!src) {
    if (a.downloadState === 'PENDING') return <div className="dm-att dm-att-muted">Файл загружается…</div>;
    if (a.url) {
      return (
        <a className="dm-att dm-att-card" href={a.url} target="_blank" rel="noreferrer">
          <Icon name={a.kind === 'REEL' ? 'movie' : a.kind === 'STORY' ? 'history_toggle_off' : 'photo_library'} size={20} />
          <span>{KIND_LABEL[a.kind] ?? 'Файл'} в Instagram</span>
          <Icon name="open_in_new" size={16} />
        </a>
      );
    }
    return <div className="dm-att dm-att-muted">Файл недоступен</div>;
  }
  if (a.kind === 'STICKER') return <img className="dm-sticker" src={src} alt="Стикер" loading="lazy" />;
  if (isViewable(a)) {
    if (isVideoAtt(a)) {
      return (
        <button type="button" className="dm-media dm-media-video" onClick={() => onOpen(a.id)} aria-label="Открыть видео" data-testid="media-open">
          <video src={src} preload="metadata" muted playsInline />
          <span className="dm-play">
            <Icon name="play_arrow" size={34} />
          </span>
        </button>
      );
    }
    return (
      <button type="button" className="dm-media" onClick={() => onOpen(a.id)} aria-label="Открыть фото" data-testid="media-open">
        <img src={src} alt={a.name ?? 'Фото'} loading="lazy" />
      </button>
    );
  }
  if (a.kind === 'AUDIO') return <audio className="dm-audio" src={src} controls preload="metadata" />;
  return (
    <a className="dm-att dm-att-row dm-att-file" href={src} target="_blank" rel="noreferrer">
      <Icon name="description" size={20} />
      <span className="dm-att-name">{a.name || 'Документ'}</span>
      <span className="dm-att-size">{fmtSize(a.size)}</span>
    </a>
  );
}

/** Цитата над ответом: на что ответили. Щелчок — к исходному сообщению. */
function Quote({ out, preview, onJump }: { out: boolean; preview: ReplyPreview | null | undefined; onJump: (id: string) => void }) {
  const whose = !preview ? 'сообщение' : preview.direction === 'INBOUND' ? 'клиенту' : preview.byAi ? 'сообщение ИИ' : 'своё сообщение';
  const label = out ? `Ответ на ${whose === 'клиенту' ? 'сообщение клиента' : whose}` : 'Клиент ответил на ваше сообщение';
  const body = !preview ? 'Сообщение недоступно' : preview.deleted ? 'Сообщение удалено' : preview.text || (preview.kind ? KIND_LABEL[preview.kind] ?? 'Вложение' : 'Сообщение');
  return (
    <div className={`dm-quote ${out ? 'out' : 'in'}`}>
      <div className="dm-quote-label">
        <Icon name="reply" size={14} /> {label}
      </div>
      <button type="button" className="dm-quote-body" onClick={() => preview && onJump(preview.id)} disabled={!preview} data-testid="reply-quote">
        {body}
      </button>
    </div>
  );
}

export type BubblePos = 'single' | 'first' | 'middle' | 'last';

/**
 * 21.11.2026 — сообщение в «Диалогах» в стиле Instagram Direct.
 *
 * Компьютер: при наведении сбоку — ❤️ (на сообщение клиента), «Ответить» и
 * «⋯» (Копировать, Исправить). Двойной щелчок по сообщению клиента — ❤️.
 * Телефон: двойное касание — ❤️, долгое нажатие — меню.
 * Удалить нельзя: Meta не удаляет сообщения у клиента.
 */
export default function ChatMessageBubble({
  m,
  pos,
  avatar,
  canAct,
  canReact,
  canQuote,
  highlighted,
  onReply,
  onReact,
  onRetry,
  onEdit,
  onCopy,
  onOpenMedia,
  onJump,
}: {
  m: ChannelMessage;
  pos: BubblePos;
  avatar: ReactNode | null;
  /** Можно отвечать в этот чат (права + окно 24 ч). */
  canAct: boolean;
  /** ❤️ доступна (сообщение клиента, Instagram/WhatsApp). */
  canReact: boolean;
  /** «Ответить» цитатой доступно (Instagram/WhatsApp). */
  canQuote: boolean;
  highlighted: boolean;
  onReply: (m: ChannelMessage) => void;
  onReact: (m: ChannelMessage, on: boolean) => void;
  onRetry: (m: ChannelMessage) => void;
  onEdit: (m: ChannelMessage) => void;
  onCopy: (text: string) => void;
  onOpenMedia: (attachmentId: string) => void;
  onJump: (messageId: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [pop, setPop] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef(0);
  /** Когда был последний touchend: двойное касание браузер дублирует событием dblclick. */
  const lastTouchRef = useRef(0);

  useEffect(() => {
    if (!menu) return;
    // На компьютере меню под сообщением может уйти за край ленты — показываем его целиком.
    if (!window.matchMedia?.('(hover: none)').matches) boxRef.current?.querySelector('.dm-menu')?.scrollIntoView({ block: 'nearest' });
    const onDown = (e: Event) => {
      if (!boxRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const out = m.direction === 'OUTBOUND';
  const deleted = !!m.deletedByContactAt;
  const failed = m.status === 'FAILED';
  const temp = m.id.startsWith('temp-');
  const atts = deleted ? [] : m.chatAttachments ?? [];
  const legacy = deleted ? [] : Array.isArray(m.attachments) ? m.attachments : [];
  const hasText = !!m.text && !deleted;
  const mediaOnly = !hasText && atts.length > 0 && atts.every((a) => isViewable(a) || a.kind === 'STICKER');
  const liked = !!m.ourReaction;
  const reactable = !out && canReact && canAct && !deleted && !!m.externalId;
  const quotable = canQuote && canAct && !temp && !deleted && !!m.externalId;
  const editable = out && canAct && !!m.status && hasText && !temp;

  const toggleLike = () => {
    if (!reactable) return;
    if (!liked) {
      setPop(true);
      setTimeout(() => setPop(false), 700);
    }
    onReact(m, !liked);
  };

  const touchStart = () => {
    if (pressRef.current) clearTimeout(pressRef.current);
    pressRef.current = setTimeout(() => {
      pressRef.current = null;
      setMenu(true);
      navigator.vibrate?.(10);
    }, 450);
  };
  const touchEnd = () => {
    lastTouchRef.current = Date.now();
    if (pressRef.current) {
      clearTimeout(pressRef.current);
      pressRef.current = null;
      const now = Date.now();
      if (now - lastTapRef.current < 300) toggleLike();
      lastTapRef.current = now;
    }
  };
  const touchMove = () => {
    if (pressRef.current) clearTimeout(pressRef.current);
    pressRef.current = null;
  };

  const title = `${formatDateTimeRu(m.sentAt)}${out ? (m.byAi ? ' · ИИ-помощник' : m.author ? ` · ${m.author.fullName}` : m.status ? ' · из приложения' : '') : ''}`;
  const anyActions = hasText || reactable || quotable;

  return (
    <div
      ref={boxRef}
      className={`dm-row ${out ? 'out' : 'in'} pos-${pos}${highlighted ? ' hl' : ''}${failed ? ' failed' : ''}${temp ? ' temp' : ''}`}
      data-testid="chat-message"
      data-id={m.id}
      data-status={m.status ?? ''}
      data-ai={m.byAi ? '1' : undefined}
    >
      {!out && <div className="dm-avatar-slot">{avatar}</div>}
      <div className="dm-col">
        {m.replyToExternalId && <Quote out={out} preview={m.replyTo} onJump={onJump} />}
        <div className="dm-line">
          <div
            className={`dm-bubble${mediaOnly ? ' media' : ''}${deleted ? ' deleted' : ''}${atts.some((a) => a.kind === 'AUDIO' && a.storedName) ? ' has-audio' : ''}`}
            title={title}
            onDoubleClick={
              reactable
                ? () => {
                    // Двойное касание пальцем уже обработано в touchEnd — второй раз не переключаем.
                    if (Date.now() - lastTouchRef.current < 800) return;
                    toggleLike();
                  }
                : undefined
            }
            onTouchStart={touchStart}
            onTouchEnd={touchEnd}
            onTouchMove={touchMove}
            onContextMenu={(e) => {
              if (window.matchMedia?.('(hover: none)').matches) e.preventDefault();
            }}
            data-testid="bubble"
          >
            {deleted ? (
              <div className="dm-text">Сообщение удалено клиентом</div>
            ) : (
              <>
                {atts.map((a) => (
                  <Attachment key={a.id} a={a} onOpen={onOpenMedia} />
                ))}
                {hasText && <div className="dm-text">{m.text}</div>}
                {legacy.map((a, i) => (
                  <div key={i} className="dm-att dm-att-row">
                    <Icon name="attach_file" size={14} />
                    {a.name || (a.type === 'photo' ? 'Фото' : a.type === 'voice' ? 'Голосовое' : a.type === 'video' ? 'Видео' : 'Файл')}
                  </div>
                ))}
              </>
            )}
            {pop && (
              <span className="dm-heart-pop" aria-hidden="true">
                ❤️
              </span>
            )}
          </div>
          {anyActions && (
            <div className="dm-actions">
              {reactable && (
                <button type="button" className={`dm-act${liked ? ' on' : ''}`} onClick={toggleLike} title={liked ? 'Убрать ❤️' : 'Нравится'} aria-label={liked ? 'Убрать реакцию' : 'Нравится'} data-testid="msg-like">
                  <Icon name="favorite" size={18} />
                </button>
              )}
              {quotable && (
                <button type="button" className="dm-act" onClick={() => onReply(m)} title="Ответить" aria-label="Ответить" data-testid="msg-reply">
                  <Icon name="reply" size={18} />
                </button>
              )}
              {hasText && (
                <button type="button" className="dm-act" onClick={() => setMenu((v) => !v)} title="Ещё" aria-label="Ещё" data-testid="msg-menu">
                  <Icon name="more_horiz" size={18} />
                </button>
              )}
            </div>
          )}
          {menu && (
            <div className="dm-menu" role="menu" data-testid="msg-menu-list">
              <div className="dm-menu-time">{title}</div>
              {quotable && (
                <button type="button" role="menuitem" onClick={() => (setMenu(false), onReply(m))}>
                  <Icon name="reply" size={18} /> Ответить
                </button>
              )}
              {reactable && (
                <button type="button" role="menuitem" onClick={() => (setMenu(false), toggleLike())}>
                  <Icon name="favorite" size={18} /> {liked ? 'Убрать ❤️' : 'Нравится'}
                </button>
              )}
              {hasText && (
                <button type="button" role="menuitem" onClick={() => (setMenu(false), onCopy(m.text!))}>
                  <Icon name="content_copy" size={18} /> Копировать
                </button>
              )}
              {editable && (
                <button type="button" role="menuitem" onClick={() => (setMenu(false), onEdit(m))} data-testid="msg-edit">
                  <Icon name="edit" size={18} /> Исправить
                </button>
              )}
            </div>
          )}
        </div>
        {(m.contactReaction || m.ourReaction) && !deleted && (
          <div className="dm-reactions" data-testid="reactions">
            {m.contactReaction && (
              <span className="dm-reaction" title="Реакция клиента">
                {m.contactReaction}
              </span>
            )}
            {m.ourReaction && (
              <button type="button" className="dm-reaction ours" title="Ваша реакция — нажмите, чтобы убрать" onClick={reactable ? toggleLike : undefined} data-testid="our-reaction">
                {m.ourReaction}
              </button>
            )}
          </div>
        )}
        {failed && (
          <div className="dm-failed" data-testid="msg-failed">
            <Icon name="error" size={16} />
            <span>
              {FAILURE_TEXT[m.error ?? ''] ?? 'Сообщение не ушло.'}
              {m.errorDetail ? ` (код ${m.errorDetail})` : ''}
            </span>
            {canAct && (
              <button type="button" onClick={() => onRetry(m)} data-testid="msg-retry">
                Повторить
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
