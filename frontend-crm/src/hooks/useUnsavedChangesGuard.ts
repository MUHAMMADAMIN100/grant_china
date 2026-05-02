import { useEffect } from 'react';

/**
 * Защита от потери несохранённых данных формы.
 *
 * Когда `when=true`:
 *  1. beforeunload — браузер показывает нативное предупреждение при
 *     закрытии вкладки или перезагрузке страницы.
 *  2. click capture — перехватывает клики по внутренним ссылкам (<a> /
 *     <Link>) и спрашивает подтверждение через window.confirm().
 *  3. popstate — кнопка "назад" / "вперёд" в браузере: если юзер
 *     отменяет — возвращаем history на текущий URL.
 *
 * Не перехватывает программный navigate() из react-router внутри кода.
 * Это сознательное решение: переопределение history.pushState ломает
 * внутреннее состояние router и приводит к рассинхрону.
 */
export function useUnsavedChangesGuard(
  when: boolean,
  message = 'У вас есть несохранённые изменения в анкете. Уйти без сохранения?',
) {
  useEffect(() => {
    if (!when) return;

    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest('a') as HTMLAnchorElement | null;
      if (!anchor || !anchor.href) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      try {
        const url = new URL(anchor.href);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname) {
          if (url.search === window.location.search) return;
        }
      } catch {
        return;
      }
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    let lastHref = window.location.href;
    const onPopState = () => {
      if (window.location.href === lastHref) return;
      const goingTo = window.location.href;
      if (window.confirm(message)) {
        lastHref = goingTo;
      } else {
        window.history.pushState(null, '', lastHref);
      }
    };

    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, [when, message]);
}
