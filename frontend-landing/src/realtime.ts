import { io, Socket } from 'socket.io-client';
import { useEffect, useRef, useState } from 'react';

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';
const SOCKET_URL = API_URL.replace(/\/api$/, '');

let socket: Socket | null = null;
type ConnState = 'connected' | 'disconnected' | 'reconnecting';
let connState: ConnState = 'disconnected';
const stateListeners: ((s: ConnState) => void)[] = [];

const setState = (s: ConnState) => {
  connState = s;
  stateListeners.forEach((cb) => cb(s));
};

export function connectStudentRealtime(token: string) {
  try {
    if (socket) socket.disconnect();
    socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
    });
    socket.on('connect', () => setState('connected'));
    socket.on('disconnect', () => setState('disconnected'));
    socket.io.on('reconnect_attempt', () => setState('reconnecting'));
    socket.io.on('reconnect', () => setState('connected'));
    return socket;
  } catch (err) {
    console.error('[realtime] connect failed:', err);
    return null;
  }
}

/** React hook: отдаёт текущее состояние соединения и подписывается на изменения. */
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

export function disconnectStudentRealtime() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket() {
  return socket;
}

export function useStudentRealtime(handlers: Record<string, (...args: any[]) => void>) {
  // handlers держим в ref чтобы не пересоздавать подписки при каждом рендере,
  // но всегда вызывать актуальные коллбэки.
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
