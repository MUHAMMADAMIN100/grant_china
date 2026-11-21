import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import Icon from '../../Icon';

export interface LightboxItem {
  /** id вложения */
  id: string;
  src: string;
  kind: 'image' | 'video';
  /** «Клиент · 21 нояб., 10:54» */
  caption: string;
}

/**
 * 21.11.2026 — фото и видео переписки на весь экран, как в Instagram:
 * листать стрелками на экране, клавишами ← → и свайпом; Esc или щелчок по
 * фону — закрыть. Показывает все фото и видео загруженной части переписки.
 */
export default function ChatLightbox({ items, startId, onClose }: { items: LightboxItem[]; startId: string; onClose: () => void }) {
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex((i) => i.id === startId)));
  const touchX = useRef<number | null>(null);
  const item = items[index];

  const go = (d: number) => setIndex((i) => Math.min(items.length - 1, Math.max(0, i + d)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!item) return null;

  return createPortal(
    <motion.div
      className="dm-lightbox"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр"
      data-testid="lightbox"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="dm-lightbox-top" onClick={(e) => e.stopPropagation()}>
        <span className="dm-lightbox-caption">{item.caption}</span>
        <span className="dm-lightbox-count">
          {index + 1} / {items.length}
        </span>
        <a className="dm-lightbox-btn" href={item.src} target="_blank" rel="noreferrer" title="Открыть файл" aria-label="Открыть файл">
          <Icon name="open_in_new" size={22} />
        </a>
        <button type="button" className="dm-lightbox-btn" onClick={onClose} title="Закрыть" aria-label="Закрыть" data-testid="lightbox-close">
          <Icon name="close" size={24} />
        </button>
      </div>
      {index > 0 && (
        <button type="button" className="dm-lightbox-nav prev" onClick={(e) => (e.stopPropagation(), go(-1))} aria-label="Предыдущее" data-testid="lightbox-prev">
          <Icon name="chevron_left" size={32} />
        </button>
      )}
      <div className="dm-lightbox-stage" onClick={(e) => e.stopPropagation()}>
        {item.kind === 'image' ? (
          <img key={item.id} src={item.src} alt="" className="dm-lightbox-media" data-testid="lightbox-media" />
        ) : (
          <video key={item.id} src={item.src} className="dm-lightbox-media" controls autoPlay playsInline data-testid="lightbox-media" />
        )}
      </div>
      {index < items.length - 1 && (
        <button type="button" className="dm-lightbox-nav next" onClick={(e) => (e.stopPropagation(), go(1))} aria-label="Следующее" data-testid="lightbox-next">
          <Icon name="chevron_right" size={32} />
        </button>
      )}
    </motion.div>,
    document.body,
  );
}
