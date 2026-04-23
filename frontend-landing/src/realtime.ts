import { io, Socket } from 'socket.io-client';
import { useEffect } from 'react';

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';
const SOCKET_URL = API_URL.replace(/\/api$/, '');

let socket: Socket | null = null;

export function connectStudentRealtime(token: string) {
  if (socket) socket.disconnect();
  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });
  return socket;
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
