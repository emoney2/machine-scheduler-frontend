/**
 * Single Socket.IO client for the whole app. Import this instead of calling io()
 * again — duplicate clients double connections and reconnection storms against Render.
 */
import { io } from "socket.io-client";

const RAW_API_ROOT = process.env.REACT_APP_API_ROOT || "";
const API_ROOT = (RAW_API_ROOT || "/api").replace(/\/$/, "");
export const SOCKET_ORIGIN = API_ROOT.startsWith("http")
  ? API_ROOT.replace(/\/api$/, "")
  : "https://machine-scheduler-backend.onrender.com";
const SOCKET_PATH = "/socket.io";

let socket = null;
let socketErrorLogged = false;

try {
  socket = io(SOCKET_ORIGIN, {
    path: SOCKET_PATH,
    // Polling first: Render/free tiers often drop pure-WebSocket handshakes; the
    // browser then reports a misleading "CORS" error because the 502/HTML body
    // has no Access-Control-Allow-Origin. Upgrade to websocket when available.
    transports: ["polling", "websocket"],
    timeout: 60000,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    withCredentials: true,
  });

  socket.on("connect", () => {
    socketErrorLogged = false;
    window.__SOCKET_DOWN__ = false;
  });
  socket.on("connect_error", () => {
    window.__SOCKET_DOWN__ = true;
    if (!socketErrorLogged) {
      socketErrorLogged = true;
      console.warn(
        "🟡 Socket connection failed (backend may be waking up). Real-time updates disabled until connected."
      );
    }
  });
  socket.on("error", (err) => {
    if (!socketErrorLogged) {
      socketErrorLogged = true;
      console.warn("🟡 socket error:", err?.message || err);
    }
  });
} catch (e) {
  console.warn("🟡 socket init failed:", e);
  window.__SOCKET_DOWN__ = true;
}

export { socket };

export function isSocketLive() {
  return !!(socket && socket.connected);
}
