/**
 * ComXim MT200RUBL driver for Photo Station.
 * iPhone Safari talks to the backend; a Fire HD bridge owns the BLE link.
 */
import { socket } from "../socketClient";
import { TURNTABLE_STATES } from "./turntableService";

function rid() {
  return `tt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureSocketConnected() {
  if (!socket) throw new Error("Socket.IO is not available");
  if (!socket.connected) {
    try {
      socket.connect();
    } catch {
      /* ignore */
    }
  }
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("Could not connect to server for turntable control")),
      15000
    );
    socket.once("connect", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/**
 * @param {object} [opts]
 * @param {(msg: string, detail?: any) => void} [opts.onLog]
 * @param {number} [opts.continuousMsPer360]
 * @param {number} [opts.speedGrade] ComXim speed 1–127
 */
export function createComximTurntable({
  onLog = () => {},
  continuousMsPer360 = 10000,
  speedGrade = 6,
} = {}) {
  let state = TURNTABLE_STATES.disconnected;
  let positionDeg = 0;
  let lastError = null;
  let moveToken = 0;

  function status() {
    return {
      state,
      positionDeg: Math.round(positionDeg * 10) / 10,
      driver: "comxim-fire-bridge",
      lastError,
    };
  }

  function log(msg, detail) {
    onLog(`[turntable:comxim] ${msg}`, detail);
  }

  function sendCommand(command, waitFor = "OK", timeoutMs = 45000) {
    ensureSocketConnected();
    const requestId = rid();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off("comxim:commandResult", onResult);
        reject(
          Object.assign(new Error(`Turntable timeout waiting for ${waitFor}: ${command}`), {
            code: "TURNTABLE_TIMEOUT",
          })
        );
      }, timeoutMs);

      function onResult(payload) {
        if (!payload || payload.requestId !== requestId) return;
        clearTimeout(timer);
        socket.off("comxim:commandResult", onResult);
        if (!payload.ok) {
          reject(
            Object.assign(new Error(payload.error || "Turntable command failed"), {
              code: "TURNTABLE_CMD_FAILED",
              lines: payload.lines,
            })
          );
          return;
        }
        resolve(payload);
      }

      socket.on("comxim:commandResult", onResult);
      socket.emit("comxim:command", {
        requestId,
        command,
        waitFor,
        timeoutMs,
      });
    });
  }

  return {
    async connect() {
      state = TURNTABLE_STATES.connecting;
      lastError = null;
      log("connecting via Fire HD bridge");
      await ensureSocketConnected();
      // Probe bridge with a harmless query
      try {
        await sendCommand("CT+ACK(1);", "OK", 12000);
        await sendCommand("CT+EVENT(1);", "OK", 12000);
      } catch (e) {
        state = TURNTABLE_STATES.error;
        lastError = e?.message || String(e);
        throw e;
      }
      state = TURNTABLE_STATES.idle;
      log("connected", status());
    },

    async rotateDegrees(degrees) {
      if (state === TURNTABLE_STATES.disconnected) {
        throw new Error("Turntable is not connected");
      }
      const deg = Math.abs(Number(degrees) || 0);
      if (!deg) return;
      const token = ++moveToken;
      state = TURNTABLE_STATES.moving;
      const direction = Number(degrees) < 0 ? 1 : 0; // 0=CW, 1=CCW
      const cmd = `CT+TURNSINGLE(${direction},${deg.toFixed(1)});`;
      log(cmd);
      try {
        await sendCommand(cmd, "TB_END", Math.max(20000, deg * 400));
        if (token !== moveToken) return;
        positionDeg = ((positionDeg + Number(degrees)) % 360 + 360) % 360;
        state = TURNTABLE_STATES.idle;
        log("rotateDegrees complete", status());
      } catch (e) {
        lastError = e?.message || String(e);
        state = TURNTABLE_STATES.error;
        throw e;
      }
    },

    async rotateContinuous(speed = 1) {
      if (state === TURNTABLE_STATES.disconnected) {
        throw new Error("Turntable is not connected");
      }
      const token = ++moveToken;
      state = TURNTABLE_STATES.moving;
      const grade = Math.max(
        1,
        Math.min(30, Math.round(Number(speedGrade) * (Number(speed) || 1)))
      );
      log("rotateContinuous 360", { grade, continuousMsPer360 });
      try {
        await sendCommand(`CT+SETSPEED(${grade});`, "OK", 10000);
        // Exact 360° move; wait for TB_END (may finish near video length)
        await sendCommand("CT+TURNSINGLE(0,360.0);", "TB_END", Math.max(continuousMsPer360 + 15000, 45000));
        if (token !== moveToken) return;
        positionDeg = 0;
        state = TURNTABLE_STATES.idle;
        log("rotateContinuous complete", status());
      } catch (e) {
        lastError = e?.message || String(e);
        state = TURNTABLE_STATES.error;
        try {
          await sendCommand("CT+SETSTOP();", "OK", 8000);
        } catch {
          /* ignore */
        }
        throw e;
      }
    },

    async stop() {
      moveToken += 1;
      try {
        await sendCommand("CT+SETSTOP();", "OK", 8000);
      } catch (e) {
        log("stop warning", e?.message || e);
      }
      if (state !== TURNTABLE_STATES.disconnected) {
        state = TURNTABLE_STATES.idle;
      }
      log("stop", status());
    },

    async home() {
      if (state === TURNTABLE_STATES.disconnected) {
        throw new Error("Turntable is not connected");
      }
      state = TURNTABLE_STATES.moving;
      log("home CT+TOZERO()");
      try {
        try {
          await sendCommand("CT+TOZERO();", "TB_END", 60000);
        } catch {
          // Some firmware returns OK without TB_END
          await sendCommand("CT+TOZERO();", "OK", 15000);
        }
        positionDeg = 0;
        state = TURNTABLE_STATES.idle;
        log("home complete", status());
      } catch (e) {
        lastError = e?.message || String(e);
        state = TURNTABLE_STATES.error;
        throw e;
      }
    },

    getStatus() {
      return status();
    },

    async disconnect() {
      moveToken += 1;
      state = TURNTABLE_STATES.disconnected;
      lastError = null;
      log("disconnected");
    },
  };
}
