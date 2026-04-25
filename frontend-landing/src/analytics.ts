// Google Analytics 4 (gtag.js) — подключается, только если задан VITE_GA_MEASUREMENT_ID.

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
  }
}

const MEASUREMENT_ID = ((import.meta as any).env?.VITE_GA_MEASUREMENT_ID || '').trim();
let initialized = false;

export function initAnalytics(): void {
  if (initialized || !MEASUREMENT_ID) return;
  initialized = true;

  // Подключаем скрипт gtag.js
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments as any);
  };
  window.gtag('js', new Date());
  // send_page_view: false — мы сами шлём page_view при смене маршрута через React Router
  window.gtag('config', MEASUREMENT_ID, { send_page_view: false });
}

export function trackPageView(path: string, title?: string): void {
  if (!MEASUREMENT_ID || !window.gtag) return;
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.origin + path,
    page_title: title || document.title,
  });
}

export function trackEvent(name: string, params?: Record<string, any>): void {
  if (!MEASUREMENT_ID || !window.gtag) return;
  window.gtag('event', name, params || {});
}

export const isAnalyticsEnabled = !!MEASUREMENT_ID;
