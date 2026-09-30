/**
 * Single Socket.IO client for the whole app. Import this instead of calling io()
 * again — duplicate clients double connections and reconnection storms against Render.
 */
import { io } from "socket.io-client";
import { getSocketOrigin } from "./apiRoot";

export const SOCKET_ORIGIN = getSocketOrigin();
const SOCKET_PATH = "/socket.io";

let socket = null;
let socketErrorLogged = false;
let hardReconnectTimer = null;

function scheduleHardReconnect() {
  if (hardReconnectTimer || !socket) return;
  hardReconnectTimer = setTimeout(() => {
    hardReconnectTimer = null;
    try {
      socket.disconnect();
    } catch (_) {}
    try {
      socket.connect();
    } catch (e) {
      console.warn("🟡 socket reconnect failed:", e);
    }
  }, 1500);
}

function isDeadSidError(err) {
  const status = err?.description ?? err?.context?.status ?? err?.context?.statusCode;
  if (status === 400 || status === "400") return true;
  const msg = String(err?.message || err || "");
  return /session id unknown|invalid session|xhr poll error/i.test(msg);
}

try {
  socket = io(SOCKET_ORIGIN, {
    path: SOCKET_PATH,
    // Polling first: Render often drops a cold WebSocket handshake. Do not send
    // the Flask session cookie — Engine.IO treats a stale `io`/sid cookie as
    // 400 "Session ID unknown" after a Render recycle.
    transports: ["polling", "websocket"],
    autoConnect: false,
    timeout: 60000,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 15000,
    withCredentials: false,
    rememberUpgrade: false,
  });

  socket.on("connect", () => {
    socketErrorLogged = false;
    window.__SOCKET_DOWN__ = false;
  });
  socket.on("connect_error", (err) => {
    window.__SOCKET_DOWN__ = true;
    if (!socketErrorLogged) {
      socketErrorLogged = true;
      console.warn(
        "🟡 Socket connection failed (backend may be waking up). Real-time updates disabled until connected."
      );
    }
    if (isDeadSidError(err)) scheduleHardReconnect();
  });
  socket.on("error", (err) => {
    if (!socketErrorLogged) {
      socketErrorLogged = true;
      console.warn("🟡 socket error:", err?.message || err);
    }
    if (isDeadSidError(err)) scheduleHardReconnect();
  });

  // Defer first connect so /ping + /combined are not racing the same cold worker.
  setTimeout(() => {
    try {
      if (socket && !socket.connected) socket.connect();
    } catch (e) {
      console.warn("🟡 socket connect failed:", e);
    }
  }, 1000);
} catch (e) {
  console.warn("🟡 socket init failed:", e);
  window.__SOCKET_DOWN__ = true;
}

export { socket };

export function isSocketLive() {
  return !!(socket && socket.connected);
}
