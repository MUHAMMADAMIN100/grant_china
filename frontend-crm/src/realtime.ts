import { io, Socket } from 'socket.io-client';
import { useEffect, useRef, useState } from 'react';
import { api } from './api/client';

// Same-origin: socket.io подключается к тому же домену через Vercel rewrite
// `/admin/socket.io/*` → Railway backend. В dev — на localhost напрямую.
const isDev = (import.meta as any).env?.DEV;
const API_URL =
  (import.meta as any).env?.VITE_API_URL ||
  (isDev ? 'http://localhost:3001/api' : '/admin/api');
const SOCKET_URL = API_URL.replace(/\/api$/, '');

let socket: Socket | null = null;
type ConnState = 'connected' | 'disconnected' | 'reconnecting';
let connState: ConnState = 'disconnected';
const stateListeners: ((s: ConnState) => void)[] = [];
const setState = (s: ConnState) => {
  connState = s;
  stateListeners.forEach((cb) => cb(s));
};

/**
 * Подключение к Socket.io. Авторизация через httpOnly cookie
 * `gc_token` — браузер пошлёт её автоматически благодаря
 * `withCredentials: true`. Токен фронту не доступен.
 */
export function connectRealtime() {
  try {
    if (socket) socket.disconnect();
    socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
    });
    socket.on('connect', () => setState('connected'));
    socket.on('disconnect', (reason) => {
      setState('disconnected');
      // ПРОБЛЕМА A/F аудита: если backend разрывает сокет НАМЕРЕННО
      // (socket.disconnect() на сервере — например при увольнении/смене роли
      // сотрудника прямо во время открытой сессии), socket.io-client сам НЕ
      // пытается переподключиться для reason === 'io server disconnect' —
      // это штатное поведение библиотеки, зацикливания ретраев нет.
      // Но пользователь при этом молча остаётся на странице со старыми
      // данными в памяти без переподключения. Сверяем cookie-сессию через
      // /auth/me: если она правда протухла (401), interceptor в
      // api/client.ts сам разлогинит и уведёт на /login.
      if (reason === 'io server disconnect') {
        api.get('/auth/me').catch(() => {});
      }
    });
    socket.io.on('reconnect_attempt', () => setState('reconnecting'));
    socket.io.on('reconnect', () => setState('connected'));
    return socket;
  } catch (err) {
    console.error('[realtime] connect failed:', err);
    return null;
  }
}

export function disconnectRealtime() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  setState('disconnected');
}

export function getSocket() {
  return socket;
}

/** Хук: подписывается на событие и автоматически отписывается при размонтировании. */
export function useRealtimeEvent(event: string, handler: (...args: any[]) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const cb = (...args: any[]) => handlerRef.current(...args);
    s.on(event, cb);
    return () => {
      s.off(event, cb);
    };
  }, [event]);
}

/** Подписка на несколько событий. handlers — объект { event: callback } */
export function useRealtime(handlers: Record<string, (...args: any[]) => void>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const events = Object.keys(handlersRef.current);
    const wrapped = events.map((ev) => {
      const cb = (...args: any[]) => handlersRef.current[ev]?.(...args);
      s.on(ev, cb);
      return [ev, cb] as const;
    });
    return () => {
      wrapped.forEach(([ev, cb]) => s.off(ev, cb));
    };
  }, []);
}

/** Хук: текущее состояние соединения для UI-индикатора. */
export function useRealtimeConnState(): ConnState {
  const [state, setLocal] = useState<ConnState>(connState);
  useEffect(() => {
    const cb = (s: ConnState) => setLocal(s);
    stateListeners.push(cb);
    return () => {
      const i = stateListeners.indexOf(cb);
      if (i >= 0) stateListeners.splice(i, 1);
    };
  }, []);
  return state;
}
