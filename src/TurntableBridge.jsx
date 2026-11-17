import React, { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "./socketClient";

const UART_SERVICE = "0000ffe0-0000-1000-8000-00805f9b34fb";
const UART_CHAR = "0000ffe1-0000-1000-8000-00805f9b34fb";
const CHUNK = 20;
const CHUNK_DELAY_MS = 25;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function supportsWebBluetooth() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth?.requestDevice;
}

export default function TurntableBridge() {
  const [logs, setLogs] = useState([]);
  const [socketOk, setSocketOk] = useState(false);
  const [bleName, setBleName] = useState("");
  const [bleOk, setBleOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastCmd, setLastCmd] = useState("");

  const deviceRef = useRef(null);
  const serverRef = useRef(null);
  const charRef = useRef(null);
  const rxBufRef = useRef("");
  const pendingRef = useRef(null); // { requestId, waitFor, lines, resolve, reject, timer }

  const pushLog = useCallback((msg) => {
    const line = `${new Date().toISOString().slice(11, 19)} ${msg}`;
    setLogs((prev) => [...prev.slice(-60), line]);
    try {
      console.log("[TurntableBridge]", msg);
    } catch {
      /* ignore */
    }
  }, []);

  const publishState = useCallback(
    (extra = {}) => {
      if (!socket?.connected) return;
      socket.emit("comxim:bridgeState", {
        bleConnected: !!charRef.current,
        deviceName: deviceRef.current?.name || bleName || null,
        ...extra,
      });
    },
    [bleName]
  );

  const registerBridge = useCallback(() => {
    if (!socket?.connected) return;
    socket.emit("comxim:registerBridge", {
      token: localStorage.getItem("jr.comximBridgeToken") || "",
      bleConnected: !!charRef.current,
      deviceName: deviceRef.current?.name || bleName || null,
    });
  }, [bleName]);

  useEffect(() => {
    if (!socket) {
      pushLog("Socket.IO unavailable");
      return undefined;
    }
    const onConnect = () => {
      setSocketOk(true);
      pushLog("Connected to JR server");
      registerBridge();
    };
    const onDisconnect = () => {
      setSocketOk(false);
      pushLog("Disconnected from JR server");
    };
    if (socket.connected) onConnect();
    else {
      try {
        socket.connect();
      } catch {
        /* ignore */
      }
    }
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("comxim:bridgeRegistered", () => pushLog("Bridge registered with server"));
    socket.on("comxim:bridgeError", (p) => pushLog(`Bridge error: ${p?.error || "?"}`));
    socket.on("comxim:bridgeSend", (payload) => {
      handleBridgeSend(payload).catch((e) => {
        pushLog(`Command failed: ${e?.message || e}`);
      });
    });
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("comxim:bridgeRegistered");
      socket.off("comxim:bridgeError");
      socket.off("comxim:bridgeSend");
    };
  }, [pushLog, registerBridge]);

  function settlePending(ok, error) {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current = null;
    if (ok) p.resolve({ ok: true, lines: p.lines.slice(), command: p.command });
    else p.reject(new Error(error || "BLE command failed"));
  }

  function onRxChunk(text) {
    if (!text) return;
    rxBufRef.current += text;
    pushLog(`RX ${text}`);
    const p = pendingRef.current;
    if (!p) return;

    // Normalize and split on semicolons
    const parts = rxBufRef.current.split(";");
    rxBufRef.current = parts.pop() || "";
    for (const raw of parts) {
      const line = `${raw.trim()};`;
      if (!line || line === ";") continue;
      p.lines.push(line);
      const upper = line.toUpperCase();
      if (upper.includes("CR+ERR")) {
        settlePending(false, line);
        return;
      }
      if (p.waitFor === "NONE") continue;
      if (p.waitFor === "OK" && upper.includes("CR+OK")) {
        settlePending(true);
        return;
      }
      if (p.waitFor === "TB_END" && upper.includes("TB_END")) {
        settlePending(true);
        return;
      }
      // Some firmwares ACK moves with OK only
      if (p.waitFor === "TB_END" && upper.includes("CR+OK") && p.command.includes("TOZERO")) {
        // keep waiting for TB_END, but record OK
      }
    }
  }

  async function writeBle(command) {
    const ch = charRef.current;
    if (!ch) throw new Error("Bluetooth characteristic not ready");
    const encoder = new TextEncoder();
    const bytes = encoder.encode(command);
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const slice = bytes.slice(i, i + CHUNK);
      // writeValueWithoutResponse is often required for UART modules
      if (ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) {
        await ch.writeValueWithoutResponse(slice);
      } else {
        await ch.writeValue(slice);
      }
      if (i + CHUNK < bytes.length) await sleep(CHUNK_DELAY_MS);
    }
  }

  async function handleBridgeSend(payload) {
    const requestId = payload?.requestId;
    const command = String(payload?.command || "").trim();
    const waitFor = String(payload?.waitFor || "OK").toUpperCase();
    const timeoutMs = Number(payload?.timeoutMs) || 45000;
    const fromSid = payload?.fromSid;

    setLastCmd(command);
    pushLog(`CMD ${command} (wait ${waitFor})`);

    const respond = (result) => {
      socket.emit("comxim:bridgeResult", {
        requestId,
        fromSid,
        command,
        ...result,
      });
    };

    if (!charRef.current) {
      respond({ ok: false, error: "Turntable BLE not connected on Fire HD", lines: [] });
      return;
    }

    try {
      setBusy(true);
      const result = await new Promise(async (resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRef.current = null;
          reject(new Error(`Timeout waiting for ${waitFor}`));
        }, timeoutMs);
        pendingRef.current = {
          requestId,
          waitFor,
          command,
          lines: [],
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
          timer,
        };
        try {
          rxBufRef.current = "";
          await writeBle(command);
          if (waitFor === "NONE") {
            settlePending(true);
          }
        } catch (e) {
          clearTimeout(timer);
          pendingRef.current = null;
          reject(e);
        }
      });
      respond({ ok: true, lines: result.lines || [] });
      pushLog(`OK ${command}`);
    } catch (e) {
      respond({ ok: false, error: e?.message || String(e), lines: [] });
      pushLog(`FAIL ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function connectBle() {
    if (!supportsWebBluetooth()) {
      pushLog("Web Bluetooth not available. Install Chrome from the Amazon Appstore / sideload Chrome, then open this page in Chrome.");
      alert(
        "This Silk browser cannot use Bluetooth.\n\nInstall Google Chrome on the Fire HD, then open this same page in Chrome."
      );
      return;
    }
    setBusy(true);
    try {
      pushLog("Requesting Bluetooth device…");
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: "MT" },
          { namePrefix: "mt" },
          { namePrefix: "ComXim" },
        ],
        optionalServices: [UART_SERVICE, UART_CHAR],
      });
      deviceRef.current = device;
      setBleName(device.name || "ComXim");
      device.addEventListener("gattserverdisconnected", () => {
        pushLog("BLE disconnected");
        charRef.current = null;
        serverRef.current = null;
        setBleOk(false);
        publishState({ bleConnected: false });
      });

      pushLog(`Connecting GATT to ${device.name || "device"}…`);
      const server = await device.gatt.connect();
      serverRef.current = server;
      let service;
      try {
        service = await server.getPrimaryService(UART_SERVICE);
      } catch {
        // Some modules expose only the characteristic UUID as service discovery path
        const services = await server.getPrimaryServices();
        service =
          services.find((s) => String(s.uuid).toLowerCase().includes("ffe0")) ||
          services[0];
      }
      if (!service) throw new Error("No BLE UART service found");
      let characteristic;
      try {
        characteristic = await service.getCharacteristic(UART_CHAR);
      } catch {
        const chars = await service.getCharacteristics();
        characteristic =
          chars.find((c) => String(c.uuid).toLowerCase().includes("ffe1")) ||
          chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
      }
      if (!characteristic) throw new Error("No writable UART characteristic found");
      charRef.current = characteristic;

      if (characteristic.properties.notify) {
        await characteristic.startNotifications();
        characteristic.addEventListener("characteristicvaluechanged", (ev) => {
          const v = ev.target.value;
          const text = new TextDecoder().decode(v);
          onRxChunk(text);
        });
      }

      setBleOk(true);
      pushLog("BLE connected — ready for one-button Photo Station");
      registerBridge();
      publishState({ bleConnected: true, deviceName: device.name || "ComXim" });
    } catch (e) {
      pushLog(`BLE connect failed: ${e?.message || e}`);
      setBleOk(false);
      publishState({ bleConnected: false });
    } finally {
      setBusy(false);
    }
  }

  async function testRotate() {
    await handleBridgeSend({
      requestId: `test_${Date.now()}`,
      command: "CT+TURNSINGLE(0,60.0);",
      waitFor: "TB_END",
      timeoutMs: 30000,
    });
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0b0b0b",
        color: "#f5f5f5",
        padding: 16,
        fontFamily: "Avenir Next, Segoe UI, Helvetica, Arial, sans-serif",
        maxWidth: 720,
        margin: "0 auto",
        boxSizing: "border-box",
      }}
    >
      <div style={{ letterSpacing: "0.18em", fontSize: 11, color: "#9ca3af", textTransform: "uppercase" }}>
        JR &amp; Co. · Fire HD Bridge
      </div>
      <h1 style={{ margin: "6px 0 8px", fontSize: 26 }}>ComXim Turntable Bridge</h1>
      <p style={{ marginTop: 0, color: "#9ca3af", lineHeight: 1.4 }}>
        Keep this page open on the Fire HD 10. The iPhone Photo Station Start button sends rotate
        commands here over the internet, and this tablet talks Bluetooth to the turntable.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <Chip ok={socketOk} label={socketOk ? "Server connected" : "Server offline"} />
        <Chip ok={bleOk} label={bleOk ? `BLE: ${bleName || "connected"}` : "BLE disconnected"} />
        {busy ? <Chip ok={false} warn label="Busy" /> : null}
      </div>

      {!supportsWebBluetooth() ? (
        <div
          style={{
            background: "rgba(127,29,29,0.35)",
            border: "1px solid rgba(239,68,68,0.45)",
            borderRadius: 10,
            padding: 12,
            marginBottom: 12,
            color: "#fecaca",
            lineHeight: 1.4,
          }}
        >
          <strong>Install Chrome on this Fire HD</strong>
          <div style={{ marginTop: 6 }}>
            Amazon Silk usually cannot use Web Bluetooth. Install Google Chrome, then open:
            <div style={{ marginTop: 6, wordBreak: "break-all", color: "#fff" }}>
              {typeof window !== "undefined" ? window.location.href : "/turntable-bridge"}
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button type="button" style={btnPrimary} disabled={busy} onClick={connectBle}>
          {bleOk ? "Reconnect Turntable Bluetooth" : "Connect Turntable Bluetooth"}
        </button>
        <button type="button" style={btnSecondary} disabled={!bleOk || busy} onClick={testRotate}>
          Test: rotate 60°
        </button>
        <button type="button" style={btnSecondary} disabled={!socketOk} onClick={registerBridge}>
          Re-register with server
        </button>
      </div>

      {lastCmd ? (
        <div style={{ marginTop: 12, color: "#9ca3af", fontSize: 13 }}>Last command: {lastCmd}</div>
      ) : null}

      <h2 style={{ marginTop: 22, fontSize: 13, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9ca3af" }}>
        Log
      </h2>
      <pre
        style={{
          background: "#111",
          border: "1px solid #2a2a2a",
          borderRadius: 10,
          padding: 12,
          fontSize: 11,
          maxHeight: 280,
          overflow: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {logs.join("\n") || "No activity yet."}
      </pre>

      <ol style={{ color: "#9ca3af", fontSize: 13, lineHeight: 1.45, paddingLeft: 18 }}>
        <li>Plug in the Fire HD and keep it awake (Display → stay on while charging).</li>
        <li>Power on the ComXim turntable and wait ~10 seconds.</li>
        <li>Tap Connect Turntable Bluetooth and choose the MT200… device.</li>
        <li>On the iPhone, open Social Media Camera App and press Start once.</li>
      </ol>
    </div>
  );
}

function Chip({ ok, warn, label }) {
  const color = warn ? "#f59e0b" : ok ? "#16a34a" : "#ef4444";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 8,
        background: "#111",
        border: "1px solid #2a2a2a",
        fontSize: 12,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}

const btnPrimary = {
  appearance: "none",
  border: "none",
  borderRadius: 12,
  padding: "16px 18px",
  fontSize: 17,
  fontWeight: 700,
  background: "#16a34a",
  color: "#04140a",
  cursor: "pointer",
};

const btnSecondary = {
  appearance: "none",
  border: "1px solid #2a2a2a",
  borderRadius: 12,
  padding: "14px 16px",
  fontSize: 15,
  fontWeight: 650,
  background: "#1a1a1a",
  color: "#f5f5f5",
  cursor: "pointer",
};
