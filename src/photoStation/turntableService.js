/**
 * Modular turntable control interface.
 * Phase 1 uses a simulated driver. Real hardware drivers should implement
 * the same methods. Browsers cannot open raw TCP sockets — prefer HTTPS
 * or WebSocket control without a companion computer.
 */

export const TURNTABLE_STATES = Object.freeze({
  disconnected: "disconnected",
  connecting: "connecting",
  idle: "idle",
  moving: "moving",
  error: "error",
});

/**
 * @typedef {Object} TurntableDriver
 * @property {() => Promise<void>} connect
 * @property {(degrees: number) => Promise<void>} rotateDegrees
 * @property {(speed?: number) => Promise<void>} rotateContinuous
 * @property {() => Promise<void>} stop
 * @property {() => Promise<void>} home
 * @property {() => { state: string, positionDeg: number, driver: string, lastError: string|null }} getStatus
 * @property {() => Promise<void>} disconnect
 */

/**
 * Simulated turntable for Phase 1 camera validation.
 * Mimics 60° steps between stills and a smooth 360° spin during video.
 */
export function createSimulatedTurntable({
  stepMs = 2000,
  continuousMsPer360 = 10000,
  onLog = () => {},
} = {}) {
  let state = TURNTABLE_STATES.disconnected;
  let positionDeg = 0;
  let lastError = null;
  let moveToken = 0;

  function status() {
    return {
      state,
      positionDeg: Math.round(positionDeg * 10) / 10,
      driver: "simulated",
      lastError,
    };
  }

  function log(msg, detail) {
    onLog(`[turntable:sim] ${msg}`, detail);
  }

  async function wait(ms, token) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (token !== moveToken) {
        const err = new Error("Turntable move cancelled");
        err.code = "TURNTABLE_CANCELLED";
        throw err;
      }
      await new Promise((r) => setTimeout(r, Math.min(50, ms - (Date.now() - start))));
    }
  }

  /** @type {TurntableDriver} */
  return {
    async connect() {
      state = TURNTABLE_STATES.connecting;
      lastError = null;
      log("connecting");
      await new Promise((r) => setTimeout(r, 120));
      state = TURNTABLE_STATES.idle;
      positionDeg = 0;
      log("connected", status());
    },

    async rotateDegrees(degrees) {
      if (state === TURNTABLE_STATES.disconnected) {
        throw new Error("Turntable is not connected");
      }
      const deg = Number(degrees) || 0;
      const token = ++moveToken;
      state = TURNTABLE_STATES.moving;
      log(`rotateDegrees ${deg}`, { from: positionDeg });
      const duration = Math.max(0, (Math.abs(deg) / 60) * stepMs);
      await wait(duration, token);
      positionDeg = ((positionDeg + deg) % 360 + 360) % 360;
      state = TURNTABLE_STATES.idle;
      log("rotateDegrees complete", status());
    },

    async rotateContinuous(speed = 1) {
      if (state === TURNTABLE_STATES.disconnected) {
        throw new Error("Turntable is not connected");
      }
      const token = ++moveToken;
      state = TURNTABLE_STATES.moving;
      const duration = continuousMsPer360 / Math.max(0.1, Number(speed) || 1);
      log("rotateContinuous 360", { durationMs: duration, speed });
      await wait(duration, token);
      positionDeg = 0;
      state = TURNTABLE_STATES.idle;
      log("rotateContinuous complete", status());
    },

    async stop() {
      moveToken += 1;
      if (state !== TURNTABLE_STATES.disconnected) {
        state = TURNTABLE_STATES.idle;
      }
      log("stop", status());
    },

    async home() {
      if (state === TURNTABLE_STATES.disconnected) {
        throw new Error("Turntable is not connected");
      }
      const delta = (360 - (positionDeg % 360)) % 360;
      if (delta === 0) {
        log("already home");
        return;
      }
      await this.rotateDegrees(delta);
      positionDeg = 0;
      log("home", status());
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
