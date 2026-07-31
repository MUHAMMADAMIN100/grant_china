import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { aiAsk, aiClearHistory, aiHistory, type AiChatMessage } from '../api/knowledge';
import { useUI } from '../ui/Dialogs';
import Icon from '../Icon';

/**
 * ТЗ 6.1 — «AI-ассистент, обученный на базе знаний компании».
 *
 * Плавающая кнопка в углу экрана, а не отдельная страница: помощник нужен
 * ровно в тот момент, когда сотрудник застрял на другом экране, — уход со
 * страницы ради вопроса означал бы потерю заполненной формы.
 *
 * Виджет сам себя прячет, если ключ Anthropic не задан (GET /ai/history
 * возвращает enabled: false): показывать кнопку, которая гарантированно
 * ответит ошибкой, хуже, чем не показывать её вовсе.
 */
export default function AiAssistant() {
  const { confirm, toast } = useUI();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    aiHistory()
      .then((res) => {
        setEnabled(res.enabled);
        setMessages(res.items);
      })
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, asking]);

  const onAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = question.trim();
    if (!text || asking) return;
    setAsking(true);
    setNotice(null);
    // Оптимистично показываем свой вопрос — ответ занимает несколько секунд,
    // и пустое поле без вопроса выглядит как «ничего не отправилось».
    const optimistic: AiChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setQuestion('');
    try {
      const res = await aiAsk(text);
      setMessages((prev) => [
        ...prev,
        { id: `local-a-${Date.now()}`, role: 'assistant', content: res.answer, createdAt: new Date().toISOString() },
      ]);
      if (res.articles === 0) {
        setNotice('База знаний пуста — помощнику не на что опираться. Наполните раздел «База знаний».');
      } else if (res.truncated) {
        setNotice('База знаний не поместилась в ответ целиком — часть статей не учтена.');
      }
    } catch (err: any) {
      // Вопрос остаётся в ленте, но помечаем, что ответа не будет — иначе
      // сотрудник решит, что бот «думает» и будет ждать.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setQuestion(text);
      toast(err?.response?.data?.message || 'Помощник не ответил. Попробуйте ещё раз.', 'error');
    } finally {
      setAsking(false);
    }
  };

  const onClear = async () => {
    const ok = await confirm({
      title: 'Очистить переписку',
      message: 'История ваших вопросов к помощнику будет скрыта. На базу знаний это не влияет.',
      confirmText: 'Очистить',
    });
    if (!ok) return;
    try {
      await aiClearHistory();
      setMessages([]);
      setNotice(null);
    } catch {
      toast('Не удалось очистить переписку', 'error');
    }
  };

  if (!enabled) return null;

  return (
    <>
      <motion.button
        className="ai-fab"
        onClick={() => setOpen((v) => !v)}
        title="AI-помощник по регламентам компании"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.6 }}
      >
        <Icon name={open ? 'close' : 'smart_toy'} size={24} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="ai-panel"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.2 }}
          >
            <div className="ai-panel-head">
              <div>
                <div className="ai-panel-title">
                  <Icon name="smart_toy" size={18} />
                  Помощник
                </div>
                <div className="ai-panel-sub">Отвечает по базе знаний компании</div>
              </div>
              {messages.length > 0 && (
                <button className="ai-panel-clear" onClick={onClear} title="Очистить переписку">
                  <Icon name="delete_sweep" size={18} />
                </button>
              )}
            </div>

            <div className="ai-feed" ref={feedRef}>
              {messages.length === 0 && !asking && (
                <div className="ai-empty">
                  <div className="empty-icon"><Icon name="menu_book" size={36} /></div>
                  Спросите, как устроен процесс в компании: «Как принять оплату наличными?»,
                  «Кто утверждает платёж?», «Что делать, если студент отменил перелёт?».
                  <div className="ai-empty-note">
                    Помощник знает только регламенты из раздела «База знаний» и не видит данные студентов.
                  </div>
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`ai-msg ${m.role}`}>
                  {m.content}
                </div>
              ))}
              {asking && (
                <div className="ai-msg assistant ai-typing">
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>

            {notice && (
              <div className="ai-notice">
                <Icon name="info" size={14} />
                {notice}
              </div>
            )}

            <form className="ai-composer" onSubmit={onAsk}>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ваш вопрос..."
                rows={2}
                maxLength={2000}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onAsk(e as unknown as React.FormEvent);
                  }
                }}
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={!question.trim() || asking}>
                <Icon name="send" size={16} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
