import { io, Socket } from 'socket.io-client';
import { useEffect } from 'react';

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';
const SOCKET_URL = API_URL.replace(/\/api$/, '');

let socket: Socket | null = null;

export function connectRealtime(token: string) {
  try {
    if (socket) socket.disconnect();
    socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
    });
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
}

export function getSocket() {
  return socket;
}

/** Хук: подписывается на событие и автоматически отписывается при размонтировании. */
export function useRealtimeEvent(event: string, handler: (...args: any[]) => void) {
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    s.on(event, handler);
    return () => {
      s.off(event, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);
}

/** Подписка на несколько событий. handlers — объект { event: callback } */
export function useRealtime(handlers: Record<string, (...args: any[]) => void>) {
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const entries = Object.entries(handlers);
    entries.forEach(([ev, cb]) => s.on(ev, cb));
    return () => {
      entries.forEach(([ev, cb]) => s.off(ev, cb));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
