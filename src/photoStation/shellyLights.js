import { socket } from "../socketClient";

function requestId() {
  return `lt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Ask the shop-computer bridge to switch the Shelly Plug US Gen4.
 * Resolves with { ok, error? }. Does not throw.
 */
export function setPhotoLights(on, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!socket) {
      resolve({ ok: false, error: "No connection to the shop server." });
      return;
    }
    const id = requestId();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("lights:result", onResult);
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, error: "The lights did not respond." });
    }, timeoutMs);
    function onResult(payload) {
      if (!payload || payload.requestId !== id) return;
      finish({
        ok: !!payload.ok,
        on: payload.on,
        error: payload.error || null,
        host: payload.host || null,
      });
    }
    socket.on("lights:result", onResult);
    try {
      if (!socket.connected) socket.connect();
      socket.emit("lights:set", { requestId: id, on: !!on });
    } catch (e) {
      finish({ ok: false, error: e?.message || "Could not reach the lights." });
    }
  });
}
