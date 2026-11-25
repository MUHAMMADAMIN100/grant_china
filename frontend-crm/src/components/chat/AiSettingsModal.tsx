import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { getAiSettings, saveAiSettings, testAi, type AiChatSettings, type AiTestResult } from '../../api/messaging';
import { useUI } from '../../ui/Dialogs';
import { formatDateTimeRu } from '../../utils/datetime';
import Icon from '../../Icon';

const DIRECTION_LABEL: Record<string, string> = {
  BACHELOR: 'Бакалавриат',
  MASTER: 'Магистратура',
  LANGUAGE: 'Языковые курсы',
  LANGUAGE_COLLEGE: 'Языковой + колледж',
  LANGUAGE_BACHELOR: 'Языковой + бакалавриат',
  COLLEGE: 'Колледж',
};

type TestMsg = { from: 'client' | 'ai'; text: string; result?: AiTestResult };

const errText = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m || fallback;
};

/**
 * 21.11.2026 — настройки ИИ-помощника в Instagram (только руководство):
 * общий выключатель, памятка (что ИИ знает о компании) и «Проверить ИИ» —
 * переписка, где вы пишете как клиент. Проверка берёт памятку из поля, даже
 * несохранённую, и ничего не отправляет в Instagram.
 */
export default function AiSettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: (s: AiChatSettings) => void }) {
  const { toast, confirm } = useUI();
  const [s, setS] = useState<AiChatSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [notes, setNotes] = useState('');
  /** 25.11.2026 — отмеченные аккаунты Instagram, в которых отвечает ИИ. */
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chat, setChat] = useState<TestMsg[]>([]);
  const [input, setInput] = useState('');
  const [testing, setTesting] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Опоздавший ответ (повторная загрузка) не должен затирать то, что сотрудник уже поменял.
    let cancelled = false;
    getAiSettings()
      .then((r) => {
        if (cancelled) return;
        setS(r);
        setEnabled(r.enabled);
        setNotes(r.notes);
        setPicked(r.accounts ?? (r.igAccounts ?? []).map((a) => a.id));
      })
      .catch((e) => !cancelled && setLoadError(errText(e, 'Не удалось загрузить настройки')));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [chat, testing]);

  const allIds = (s?.igAccounts ?? []).map((a) => a.id);
  const savedPicked = s ? (s.accounts ?? allIds) : [];
  const samePick = picked.length === savedPicked.length && picked.every((id) => savedPicked.includes(id));
  const dirty = !!s && (enabled !== s.enabled || notes !== s.notes || !samePick);

  const close = async () => {
    if (dirty && !(await confirm({ title: 'Закрыть без сохранения?', message: 'Изменения памятки и выключателя пропадут.', confirmText: 'Закрыть', danger: true }))) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && void close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const save = async () => {
    setSaving(true);
    try {
      const accounts = allIds.length > 1 ? (allIds.every((id) => picked.includes(id)) ? null : picked) : undefined;
      const r = await saveAiSettings({ enabled, notes, ...(accounts !== undefined ? { accounts } : {}) });
      setS(r);
      setEnabled(r.enabled);
      setNotes(r.notes);
      setPicked(r.accounts ?? (r.igAccounts ?? []).map((a) => a.id));
      onSaved(r);
      toast(r.enabled ? 'Сохранено. ИИ отвечает клиентам в свободных чатах' : 'Сохранено. ИИ выключен', 'success');
    } catch (e) {
      toast(errText(e, 'Не удалось сохранить'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const ask = async () => {
    const text = input.trim();
    if (!text || testing) return;
    const next: TestMsg[] = [...chat, { from: 'client', text }];
    setChat(next);
    setInput('');
    setTesting(true);
    try {
      const r = await testAi(
        next.map((m) => ({ from: m.from, text: m.text || '(ИИ не ответил)' })),
        notes,
      );
      setChat([...next, { from: 'ai', text: r.reply, result: r }]);
    } catch (e) {
      toast(errText(e, 'ИИ не ответил'), 'error');
      setChat(chat);
      setInput(text);
    } finally {
      setTesting(false);
    }
  };

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !saving && void close()}>
      <motion.div
        className="dialog-card dm-ai-modal"
        role="dialog"
        aria-modal="true"
        aria-label="ИИ-помощник в Instagram"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
        data-testid="ai-settings-modal"
      >
        <div className="dm-ai-modal-head">
          <div>
            <div className="dialog-title">
              <Icon name="auto_awesome" size={22} /> ИИ-помощник в Instagram
            </div>
            <div className="dm-ai-modal-sub">Отвечает клиентам сам, пока чат свободный. Менеджер написал или взял чат — ИИ в нём замолкает.</div>
          </div>
          <button type="button" className="dm-icon-btn" onClick={() => void close()} aria-label="Закрыть" disabled={saving}>
            <Icon name="close" size={22} />
          </button>
        </div>

        {loadError ? (
          <div className="error-banner">{loadError}</div>
        ) : !s ? (
          <div className="empty">Загрузка…</div>
        ) : (
          <div className="dm-ai-modal-body">
            <div className="dm-ai-col">
              {!s.available && (
                <div className="dm-ai-warn">
                  <Icon name="key_off" size={18} /> На сервере не задан ключ <code>GEMINI_API_KEY</code> — ИИ не может работать.
                </div>
              )}
              {s.available && !s.instagram && (
                <div className="dm-ai-warn">
                  <Icon name="link_off" size={18} /> Instagram не подключён к CRM — ИИ некому отвечать.
                </div>
              )}
              <label className={`dm-switch big${!s.available ? ' disabled' : ''}`}>
                <input type="checkbox" checked={enabled} disabled={!s.available || saving} onChange={(e) => setEnabled(e.target.checked)} data-testid="ai-enabled" />
                <span className="dm-switch-track" aria-hidden="true" />
                <span>
                  <strong>{enabled ? 'ИИ отвечает клиентам' : 'ИИ выключен'}</strong>
                  <small>{enabled ? 'В свободных чатах Instagram, круглосуточно.' : 'Включите, когда памятка заполнена и проверена.'}</small>
                </span>
              </label>

              {(s.igAccounts ?? []).length > 1 && (
                <div className="dm-ai-accounts" data-testid="ai-accounts">
                  <div className="dm-ai-accounts-title">Отвечает в аккаунтах</div>
                  {(s.igAccounts ?? []).map((a) => (
                    <label key={a.id} className="dm-ai-account">
                      <input
                        type="checkbox"
                        checked={picked.includes(a.id)}
                        disabled={saving}
                        onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id)))}
                        data-testid="ai-account"
                        data-account={a.id}
                      />
                      <span>{a.username ? `@${a.username}` : `id ${a.id}`}</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="dm-ai-notes-head">
                <label htmlFor="ai-notes">Памятка для ИИ</label>
                {!notes.trim() && (
                  <button type="button" className="dm-btn-text small" onClick={() => setNotes(s.template)} data-testid="ai-template">
                    Вставить шаблон
                  </button>
                )}
              </div>
              <div className="dm-ai-hint">
                Всё, что ИИ может говорить клиентам: услуги и цены, адрес, часы работы, условия грантов, документы, частые вопросы. Чего нет в памятке и в разделе
                «Программы», ИИ не скажет — ответит «уточню у менеджера» и позовёт вас. Строки с «[укажите …]» он пропускает.
              </div>
              <textarea id="ai-notes" className="dm-ai-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={30000} placeholder="Например: Консультация бесплатная. Офис: …" data-testid="ai-notes" />
              <div className="dm-ai-meta">
                {notes.length.toLocaleString('ru-RU')} / 30 000 знаков
                {s.updatedAt && ` · сохранено ${formatDateTimeRu(s.updatedAt)}${s.updatedByName ? `, ${s.updatedByName}` : ''}`}
              </div>
            </div>

            <div className="dm-ai-col dm-ai-test">
              <div className="dm-ai-test-head">
                <span>Проверить ИИ</span>
                {chat.length > 0 && (
                  <button type="button" className="dm-btn-text small muted" onClick={() => setChat([])} disabled={testing}>
                    Начать заново
                  </button>
                )}
              </div>
              <div className="dm-ai-hint">Пишите как клиент. Берётся памятка из поля слева, даже несохранённая. В Instagram ничего не уходит.</div>
              <div className="dm-ai-test-chat" ref={chatRef} data-testid="ai-test-chat">
                {chat.length === 0 && !testing && <div className="dm-ai-test-empty">Например: «Здравствуйте, сколько стоит учёба в Китае?»</div>}
                {chat.map((m, i) => (
                  <div key={i} className={`dm-ai-test-msg ${m.from}`}>
                    <div className="dm-ai-test-bubble">{m.text || <em>ИИ решил промолчать</em>}</div>
                    {m.result && (
                      <div className="dm-ai-test-facts">
                        {m.result.handoff && (
                          <span className="dm-chip warn">
                            <Icon name="support_agent" size={14} /> Позвал менеджера: {m.result.handoffReason || 'без причины'}
                          </span>
                        )}
                        {m.result.lead && (m.result.lead.fullName || m.result.lead.phone || m.result.lead.age || m.result.lead.interest) && (
                          <span className="dm-chip">
                            <Icon name="person" size={14} />
                            {[
                              m.result.lead.fullName,
                              m.result.lead.phone,
                              m.result.lead.age,
                              m.result.lead.interest,
                              m.result.lead.direction && m.result.lead.direction !== 'UNKNOWN' ? DIRECTION_LABEL[m.result.lead.direction] : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                        {m.result.lead?.fullName && m.result.lead?.phone && <span className="dm-chip ok">В бою здесь создалась бы заявка</span>}
                        <span className="dm-chip muted">{(m.result.ms / 1000).toFixed(1)} с</span>
                      </div>
                    )}
                  </div>
                ))}
                {testing && (
                  <div className="dm-ai-test-msg ai">
                    <div className="dm-ai-test-bubble dm-typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                )}
              </div>
              <form
                className="dm-ai-test-input"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask();
                }}
              >
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={s.available ? 'Сообщение от клиента…' : 'Нужен ключ Gemini'} disabled={!s.available || testing} maxLength={2000} data-testid="ai-test-input" />
                <button type="submit" className="dm-btn-text" disabled={!s.available || testing || !input.trim()} data-testid="ai-test-send">
                  Отправить
                </button>
              </form>
            </div>
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void close()} disabled={saving}>
            Закрыть
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!s || !dirty || saving} data-testid="ai-save">
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
