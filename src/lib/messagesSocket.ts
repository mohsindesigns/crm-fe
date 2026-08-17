'use client';

import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let socketToken: string | null = null;

/** Same-origin Socket.IO (proxied to the API via next.config rewrites). */
export function getMessagesSocket(token: string): Socket {
  if (socket && socketToken === token) {
    if (!socket.connected) socket.connect();
    return socket;
  }

  // Token changed (different login) — drop the old socket so auth is re-handshake.
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  socketToken = token;
  socket = io({
    path: '/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
  });
  return socket;
}

export function disconnectMessagesSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    socketToken = null;
  }
}
