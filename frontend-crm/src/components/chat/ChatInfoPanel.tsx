import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Conversation } from '../../api/messaging';
import { listApplications } from '../../api/applications';
import type { Application, User } from '../../api/types';
import { formatDateTimeRu } from '../../utils/datetime';
import { REPLY_WINDOW_MS } from '../../utils/chatLimits';
import Icon from '../../Icon';

/** Сколько ещё можно отвечать: «ещё 5 ч», «ещё 40 мин», null — окно закрыто. */
function windowLeft(lastIncomingAt: string | null | undefined, now: number): string | null {
  if (!lastIncomingAt) return null;
  const left = new Date(lastIncomingAt).getTime() + REPLY_WINDOW_MS - now;
  if (left <= 0) return null;
  const h = Math.floor(left / 3600_000);
  return h >= 1 ? `ещё ${h} ч` : `ещё ${Math.max(1, Math.round(left / 60_000))} мин`;
}

/**
 * 21.11.2026 — «Сведения» о чате справа, как в Instagram (кнопка ⓘ). Сюда
 * переехало всё, что раньше занимало треть экрана над перепиской:
 * ответственный, привязка к заявке, «Создать заявку», «Отпустить», плюс ИИ
 * в этом чате и окно 24 часа.
 */
export default function ChatInfoPanel({
  conversation: c,
  meId,
  isAdmin,
  users,
  channelLabel,
  canChangeChat,
  ai,
  accountLabel,
  busy,
  avatar,
  now,
  onClose,
  onTake,
  onRelease,
  onAssign,
  onLink,
  onUnlink,
  onCreateApp,
  onToggleAi,
  onClearHandoff,
}: {
  conversation: Conversation;
  meId: string | null;
  isAdmin: boolean;
  users: User[];
  channelLabel: string;
  canChangeChat: boolean;
  ai: { enabled: boolean; available: boolean; accountOff?: boolean } | null;
  /** 25.11.2026 — в какой из наших аккаунтов Instagram написал клиент (когда их несколько). */
  accountLabel?: string | null;
  busy: boolean;
  avatar: ReactNode;
  now: number;
  onClose: () => void;
  onTake: () => void;
  onRelease: () => void;
  onAssign: (userId: string) => void;
  onLink: (app: Application) => void;
  onUnlink: () => void;
  onCreateApp: () => void;
  onToggleAi: (off: boolean) => void;
  onClearHandoff: () => void;
}) {
  const meta = c.channel === 'INSTAGRAM' || c.channel === 'WHATSAPP';
  const instagram = c.channel === 'INSTAGRAM';
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Application[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setQuery('');
    setOptions([]);
  }, [c.id]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setOptions([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      listApplications({ search: q })
        .then((res) => setOptions(res.slice(0, 8)))
        .catch(() => setOptions([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const left = windowLeft(c.lastIncomingAt, now);
  const mine = !!meId && c.assignedToId === meId;

  let aiState: { text: string; tone: 'ok' | 'off' | 'muted' } | null = null;
  if (instagram) {
    if (!ai) aiState = null;
    else if (!ai.available) aiState = { text: 'Не работает: на сервере не задан ключ Gemini.', tone: 'off' };
    else if (!ai.enabled) aiState = { text: 'Выключен для всех чатов. Включает руководство в настройках ИИ (кнопка ✦ над списком чатов).', tone: 'off' };
    else if (ai.accountOff) aiState = { text: `Выключен для аккаунта ${accountLabel ?? 'этого чата'} — включает руководство в настройках ИИ.`, tone: 'off' };
    else if (c.aiOff)
      aiState = {
        text: c.aiOffReason === 'APP' ? 'Выключен в этом чате: сотрудник ответил клиенту из приложения Instagram.' : 'Выключен в этом чате.',
        tone: 'off',
      };
    else if (c.assignedToId) aiState = { text: `Молчит: чат ведёт ${c.assignedTo?.fullName ?? 'сотрудник'}. Отпустите чат — ИИ снова будет отвечать.`, tone: 'muted' };
    else if (!left) aiState = { text: 'Молчит: прошло больше 24 часов с последнего сообщения клиента.', tone: 'muted' };
    else aiState = { text: 'Отвечает клиенту сам, пока чат свободный.', tone: 'ok' };
  }

  return (
    <aside className="dm-info" data-testid="info-panel" aria-label="Сведения о чате">
      <div className="dm-info-head">
        <button type="button" className="dm-icon-btn dm-info-back" onClick={onClose} aria-label="Назад к переписке">
          <Icon name="arrow_back" size={22} />
        </button>
        <span>Сведения</span>
        <button type="button" className="dm-icon-btn dm-info-close" onClick={onClose} aria-label="Закрыть сведения" data-testid="info-close">
          <Icon name="close" size={22} />
        </button>
      </div>

      <div className="dm-info-scroll">
        <div className="dm-info-profile">
          {avatar}
          <div className="dm-info-name">{c.title || (c.username ? `@${c.username}` : 'Клиент')}</div>
          <div className="dm-info-sub">
            {[c.username ? `@${c.username}` : null, channelLabel, c.phone ? `+${c.phone.replace(/^\+/, '')}` : null].filter(Boolean).join(' · ')}
          </div>
          {accountLabel && (
            <div className="dm-info-account" data-testid="info-account">
              Написал(а) в {accountLabel}
            </div>
          )}
          {instagram && c.username && (
            <a className="dm-btn-soft" href={`https://www.instagram.com/${encodeURIComponent(c.username)}/`} target="_blank" rel="noreferrer">
              Открыть профиль в Instagram
            </a>
          )}
        </div>

        {meta && (
          <section className="dm-info-section">
            <div className="dm-info-label">Ответственный</div>
            <div className="dm-info-value" data-testid="info-owner">
              {c.assignedTo ? (mine ? `Вы (${c.assignedTo.fullName})` : c.assignedTo.fullName) : 'Свободный чат — ответит тот, кто возьмёт'}
            </div>
            <div className="dm-info-actions">
              {!c.assignedToId && (
                <button type="button" className="dm-btn-primary" disabled={busy} onClick={onTake} data-testid="take-btn">
                  Взять себе
                </button>
              )}
              {c.assignedToId && (mine || isAdmin) && (
                <button type="button" className="dm-btn-soft" disabled={busy} onClick={onRelease} data-testid="release-btn">
                  Отпустить
                </button>
              )}
            </div>
            {isAdmin && (
              <label className="dm-info-field">
                <span>Назначить</span>
                <select value={c.assignedToId ?? ''} onChange={(e) => onAssign(e.target.value)} data-testid="assign-select">
                  <option value="">Не назначен</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>
        )}

        <section className="dm-info-section">
          <div className="dm-info-label">Карточка клиента</div>
          {c.student || c.application ? (
            <div className="dm-info-links">
              {c.student && (
                <Link to={`/students/${c.student.id}`} className="dm-info-card" data-testid="student-link">
                  <Icon name="school" size={18} />
                  <span>
                    <strong>{c.student.fullName}</strong>
                    <small>Студент</small>
                  </span>
                </Link>
              )}
              {c.application && (
                <Link to={`/applications/${c.application.id}`} className="dm-info-card" data-testid="app-link">
                  <Icon name="assignment" size={18} />
                  <span>
                    <strong>{c.application.fullName}</strong>
                    <small>Заявка</small>
                  </span>
                </Link>
              )}
              {canChangeChat && (
                <button type="button" className="dm-btn-text muted small" onClick={onUnlink} disabled={busy} data-testid="unlink-btn">
                  <Icon name="link_off" size={16} /> Отвязать
                </button>
              )}
            </div>
          ) : canChangeChat ? (
            <>
              <div className="dm-info-search">
                <Icon name="search" size={18} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Привязать к заявке: ФИО или телефон" data-testid="link-input" />
              </div>
              {query.trim().length >= 2 && (
                <div className="dm-info-options" data-testid="link-options">
                  {searching && options.length === 0 ? (
                    <div className="dm-info-hint">Ищем…</div>
                  ) : options.length === 0 ? (
                    <div className="dm-info-hint">Заявок не найдено</div>
                  ) : (
                    options.map((a) => (
                      <button key={a.id} type="button" className="dm-info-option" onClick={() => (onLink(a), setQuery(''))} disabled={busy} data-testid="link-option">
                        <strong>{a.fullName}</strong>
                        <small>{a.phone}</small>
                      </button>
                    ))
                  )}
                </div>
              )}
              {meta && (
                <button type="button" className="dm-btn-soft wide" onClick={onCreateApp} data-testid="create-app-btn">
                  <Icon name="note_add" size={18} /> Создать заявку
                </button>
              )}
            </>
          ) : (
            <div className="dm-info-hint">Не привязан. Привязать может ответственный или руководство.</div>
          )}
        </section>

        {instagram && aiState && (
          <section className="dm-info-section" data-testid="info-ai">
            <div className="dm-info-label">
              <Icon name="auto_awesome" size={16} /> ИИ-помощник
            </div>
            <div className={`dm-ai-state ${aiState.tone}`} data-testid="ai-state">
              {aiState.text}
            </div>
            {ai?.available && (
              <label className={`dm-switch${!canChangeChat ? ' disabled' : ''}`}>
                <input type="checkbox" checked={!c.aiOff} disabled={!canChangeChat || busy} onChange={(e) => onToggleAi(!e.target.checked)} data-testid="ai-chat-toggle" />
                <span className="dm-switch-track" aria-hidden="true" />
                <span>ИИ в этом чате</span>
              </label>
            )}
            {c.aiHandoffAt && (
              <div className="dm-handoff" data-testid="handoff-box">
                <Icon name="support_agent" size={18} />
                <div>
                  <strong>ИИ просит менеджера</strong>
                  <div>{c.aiHandoffReason || 'Клиенту нужен человек.'}</div>
                  <small>{formatDateTimeRu(c.aiHandoffAt)}</small>
                </div>
                {canChangeChat && (
                  <button type="button" className="dm-btn-text small" onClick={onClearHandoff} disabled={busy} data-testid="handoff-clear">
                    Понятно
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {meta && (
          <section className="dm-info-section">
            <div className="dm-info-label">Окно ответа</div>
            <div className="dm-info-value" data-testid="info-window">
              {left ? `Можно отвечать ${left}` : 'Закрыто: клиент молчит больше 24 часов. Ответить можно, когда он напишет снова.'}
            </div>
            {c.lastIncomingAt && <div className="dm-info-hint">Последнее сообщение клиента: {formatDateTimeRu(c.lastIncomingAt)}</div>}
          </section>
        )}
      </div>
    </aside>
  );
}
