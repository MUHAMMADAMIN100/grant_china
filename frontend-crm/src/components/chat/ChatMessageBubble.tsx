import { useEffect, useRef, useState } from 'react';
import { attachmentUrl, type ChannelMessage, type ChatAttachment } from '../../api/messaging';
import { formatDateTimeRu } from '../../utils/datetime';
import { FAILURE_TEXT } from '../../utils/chatLimits';
import Icon from '../../Icon';
import StaticMap, { mapLink } from './StaticMap';

const fmtSize = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1048576).toFixed(1)} МБ`);

function Attachment({ a }: { a: ChatAttachment }) {
  const src = a.storedName ? attachmentUrl(a.id) : null;
  if (a.kind === 'LOCATION' && a.latitude != null && a.longitude != null) {
    return (
      <div className="chat-att">
        <StaticMap lat={a.latitude} lon={a.longitude} />
        {(a.name || a.address) && <div className="chat-att-caption">{[a.name, a.address].filter(Boolean).join(', ')}</div>}
        <a href={mapLink(a.latitude, a.longitude)} target="_blank" rel="noreferrer" className="chat-att-link">Открыть на карте</a>
      </div>
    );
  }
  if (a.kind === 'CONTACT') {
    return (
      <div className="chat-att chat-att-row">
        <Icon name="contact_phone" size={16} />
        <span>{[a.name, a.address].filter(Boolean).join(' · ') || 'Контакт'}</span>
      </div>
    );
  }
  if (a.kind === 'UNSUPPORTED') {
    return <div className="chat-att chat-att-muted">Сообщение этого типа CRM не показывает — посмотрите в приложении.</div>;
  }
  if (!src) {
    if (a.downloadState === 'PENDING') return <div className="chat-att chat-att-muted">Файл загружается…</div>;
    if (a.url) {
      const label = a.kind === 'REEL' ? 'Reels' : a.kind === 'STORY' ? 'История' : a.kind === 'SHARE' ? 'Публикация' : 'Файл';
      return (
        <a className="chat-att chat-att-row chat-att-link" href={a.url} target="_blank" rel="noreferrer">
          <Icon name="open_in_new" size={16} /> {label} в Instagram
        </a>
      );
    }
    return <div className="chat-att chat-att-muted">Файл недоступен</div>;
  }
  if (a.kind === 'IMAGE' || a.kind === 'STICKER' || (a.kind === 'SHARE' && a.mimeType?.startsWith('image/'))) {
    return (
      <a className="chat-att" href={src} target="_blank" rel="noreferrer">
        <img className={a.kind === 'STICKER' ? 'chat-sticker' : 'chat-image'} src={src} alt={a.name ?? 'Фото'} loading="lazy" />
      </a>
    );
  }
  if (a.kind === 'VIDEO' || a.kind === 'REEL' || a.kind === 'STORY' || (a.kind === 'SHARE' && a.mimeType?.startsWith('video/'))) {
    return (
      <div className="chat-att">
        <video className="chat-video" src={src} controls preload="metadata" playsInline />
      </div>
    );
  }
  if (a.kind === 'AUDIO') {
    return (
      <div className="chat-att">
        <audio className="chat-audio" src={src} controls preload="metadata" />
      </div>
    );
  }
  return (
    <a className="chat-att chat-att-row chat-att-link" href={src} target="_blank" rel="noreferrer">
      <Icon name="description" size={18} />
      <span className="chat-att-name">{a.name || 'Документ'}</span>
      <span className="chat-att-size">{fmtSize(a.size)}</span>
    </a>
  );
}

function StatusMark({ m }: { m: ChannelMessage }) {
  if (!m.status) return null;
  const map: Record<string, { icon: string; title: string; cls?: string }> = {
    SENDING: { icon: 'schedule', title: 'Отправляется' },
    SENT: { icon: 'check', title: 'Отправлено' },
    DELIVERED: { icon: 'done_all', title: 'Доставлено' },
    READ: { icon: 'done_all', title: 'Прочитано', cls: 'read' },
    FAILED: { icon: 'error', title: 'Не отправлено', cls: 'failed' },
  };
  const s = map[m.status];
  if (!s) return null;
  return (
    <span className={`chat-status ${s.cls ?? ''}`} title={s.title} data-status={m.status}>
      <Icon name={s.icon} size={14} />
    </span>
  );
}

/**
 * 29.10.2026 — сообщение в ленте «Диалогов»: текст, вложения, статус своего
 * сообщения, реакция клиента, меню «Копировать / Исправить», «Повторить» у
 * неушедшего. Пункта «Удалить» нет: Meta не умеет удалять сообщения у клиента.
 */
export default function ChatMessageBubble({
  m,
  canAct,
  onRetry,
  onEdit,
  onCopy,
}: {
  m: ChannelMessage;
  canAct: boolean;
  onRetry: (m: ChannelMessage) => void;
  onEdit: (m: ChannelMessage) => void;
  onCopy: (text: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Меню закрывается щелчком мимо сообщения или Esc (а не когда мышь соскользнула),
  // а открывшись у последнего сообщения, само показывается в ленте целиком.
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.scrollIntoView({ block: 'nearest' });
    const onDown = (e: Event) => {
      if (!boxRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
    };
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
  const legacy = Array.isArray(m.attachments) ? m.attachments : [];
  const hasText = !!m.text && !deleted;
  return (
    <div ref={boxRef} className={`conv-msg ${out ? 'out' : 'in'}${failed ? ' failed' : ''}`} data-testid="chat-message" data-status={m.status ?? ''}>
      {deleted ? (
        <div className="conv-msg-text chat-deleted">Сообщение удалено клиентом</div>
      ) : (
        <>
          {(m.chatAttachments ?? []).map((a) => (
            <Attachment key={a.id} a={a} />
          ))}
          {hasText && <div className="conv-msg-text">{m.text}</div>}
          {legacy.map((a, i) => (
            <div key={i} className="conv-msg-attach">
              <Icon name="attach_file" size={14} />
              {a.name || (a.type === 'photo' ? 'Фото' : a.type === 'voice' ? 'Голосовое' : a.type === 'video' ? 'Видео' : 'Файл')}
            </div>
          ))}
        </>
      )}
      {m.contactReaction && <span className="chat-reaction" title="Реакция клиента">{m.contactReaction}</span>}
      <div className="conv-msg-meta">
        {out && (m.author ? `${m.author.fullName} · ` : m.status ? 'из приложения · ' : '')}
        {formatDateTimeRu(m.sentAt)}
        {out && <StatusMark m={m} />}
        {hasText && (
          <button type="button" className="chat-menu-btn" onClick={() => setMenu((v) => !v)} aria-label="Меню сообщения" data-testid="msg-menu">
            <Icon name="more_horiz" size={16} />
          </button>
        )}
      </div>
      {menu && hasText && (
        <div ref={menuRef} className="chat-menu">
          <button type="button" onClick={() => { setMenu(false); onCopy(m.text!); }}>Копировать</button>
          {out && canAct && m.status && (
            <button type="button" onClick={() => { setMenu(false); onEdit(m); }} data-testid="msg-edit">Исправить</button>
          )}
        </div>
      )}
      {failed && (
        <div className="chat-failed">
          <span>{FAILURE_TEXT[m.error ?? ''] ?? 'Сообщение не ушло.'}{m.errorDetail ? ` (код ${m.errorDetail})` : ''}</span>
          {canAct && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => onRetry(m)} data-testid="msg-retry">
              Повторить
            </button>
          )}
        </div>
      )}
    </div>
  );
}
