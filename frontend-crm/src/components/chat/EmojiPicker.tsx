import { useEffect, useRef, useState } from 'react';

/**
 * 21.11.2026 — панель смайлов в поле ответа, как в Instagram. Своя, без
 * библиотеки (правило проекта — без новых зависимостей): набор частых эмодзи
 * по разделам. Закрывается щелчком мимо и Esc.
 */
const GROUPS: Array<{ label: string; icon: string; items: string[] }> = [
  {
    label: 'Часто',
    icon: '🙂',
    items: ['😊', '🙂', '😉', '😁', '😂', '🤗', '😍', '🥰', '🙏', '👍', '👌', '👏', '🤝', '❤️', '🔥', '✨', '🎉', '✅', '📌', '💬'],
  },
  {
    label: 'Смайлы',
    icon: '😀',
    items: [
      '😀', '😃', '😄', '😅', '🤣', '😇', '🙃', '😌', '😋', '😎', '🤓', '🧐', '🤔', '🤨', '😐', '😶', '🙄', '😏', '😮', '😯',
      '😲', '😳', '🥺', '😢', '😭', '😤', '😡', '🤯', '😱', '😴', '🤒', '🤧', '😷', '🥳', '🤩', '😘', '😚', '🤭', '🫡', '🫶',
    ],
  },
  {
    label: 'Жесты',
    icon: '👋',
    items: ['👋', '🤚', '✋', '🖐', '👌', '🤌', '✌️', '🤞', '🤟', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊', '🙌', '👐', '🤲', '💪', '🙏', '✍️'],
  },
  {
    label: 'Учёба',
    icon: '🎓',
    items: ['🎓', '📚', '📖', '✏️', '📝', '📄', '📑', '🗂', '📅', '⏰', '🏫', '🏛', '🇨🇳', '🇹🇯', '✈️', '🛂', '🧳', '🏠', '💰', '💳', '📞', '📍', '🌏', '🀄', '🥇'],
  },
  {
    label: 'Символы',
    icon: '❤️',
    items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '💯', '✅', '☑️', '✔️', '❗', '❓', '⚠️', '⭐', '🌟', '💡', '🔔', '📢', '➡️', '⬇️', '🔝', '🆗', '🆕', '🎁'],
  },
];

export default function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: Event) => {
      const t = e.target as HTMLElement;
      if (boxRef.current?.contains(t) || t.closest?.('[data-emoji-toggle]')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="dm-emoji" ref={boxRef} role="dialog" aria-label="Смайлы" data-testid="emoji-picker">
      <div className="dm-emoji-title">{GROUPS[tab].label}</div>
      <div className="dm-emoji-grid">
        {GROUPS[tab].items.map((e, i) => (
          <button key={`${e}-${i}`} type="button" className="dm-emoji-item" onClick={() => onPick(e)} aria-label={e}>
            {e}
          </button>
        ))}
      </div>
      <div className="dm-emoji-tabs">
        {GROUPS.map((g, i) => (
          <button key={g.label} type="button" className={`dm-emoji-tab${i === tab ? ' active' : ''}`} onClick={() => setTab(i)} title={g.label} aria-label={g.label}>
            {g.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
