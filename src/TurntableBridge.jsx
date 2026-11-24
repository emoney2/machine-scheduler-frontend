import React, { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "./socketClient";
import { connectShellyPlug, previouslyPairedShelly } from "./photoStation/shellyBle";

const SHELLY_ID_KEY = "jr.shellyDeviceId";

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
  const [lightsName, setLightsName] = useState("");
  const [lightsState, setLightsState] = useState("disconnected");
  const [lightsWifi, setLightsWifi] = useState(false);
  const [lightsIp, setLightsIp] = useState("");
  const [lightsSsid, setLightsSsid] = useState("");
  const [lightsOn, setLightsOn] = useState(null);
  const [lightsError, setLightsError] = useState("");
  const shellyRef = useRef(null);
  const lightsInfoRef = useRef({ name: "", ip: "", ready: false });
  const lightsHandlerRef = useRef(null);
  const lightsConnectLock = useRef(false);

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
    const lights = lightsInfoRef.current;
    socket.emit("lights:registerBridge", {
      host: lights.name || "",
      connected: !!lights.ready && !!shellyRef.current,
      ip: lights.ip || "",
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
    const onLights = (payload) => {
      const run = lightsHandlerRef.current;
      if (!run) return;
      run(payload).catch((e) => {
        pushLog(`Lights failed: ${e?.message || e}`);
      });
    };
    socket.on("lights:bridgeSet", onLights);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("comxim:bridgeRegistered");
      socket.off("comxim:bridgeError");
      socket.off("comxim:bridgeSend");
      socket.off("lights:bridgeSet", onLights);
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

  function markLightsDown(message) {
    shellyRef.current = null;
    lightsInfoRef.current = { name: "", ip: "", ready: false };
    setLightsState("disconnected");
    setLightsWifi(false);
    setLightsIp("");
    setLightsSsid("");
    setLightsOn(null);
    if (message) setLightsError(message);
    registerBridge();
  }

  async function adoptShelly(shelly) {
    const onDisconnect = () => {
      if (shellyRef.current?.device !== shelly.device) return;
      pushLog("Lights Bluetooth disconnected");
      markLightsDown("Lights Bluetooth disconnected.");
    };
    shelly.device.addEventListener("gattserverdisconnected", onDisconnect);
    shellyRef.current = shelly;
    let snap;
    try {
      snap = await shelly.snapshot();
    } catch (e) {
      shellyRef.current = null;
      try {
        shelly.device.gatt?.disconnect();
      } catch {
        /* ignore */
      }
      throw e;
    }
    try {
      localStorage.setItem(SHELLY_ID_KEY, shelly.device.id || "");
    } catch {
      /* ignore */
    }
    lightsInfoRef.current = { name: snap.name, ip: snap.ip, ready: true };
    setLightsName(snap.name);
    setLightsIp(snap.ip);
    setLightsSsid(snap.ssid);
    setLightsWifi(snap.wifiUp);
    setLightsOn(snap.on);
    setLightsError("");
    setLightsState("connected");
    pushLog(
      `Lights connected: ${snap.name}${snap.wifiUp ? ` on Wi-Fi ${snap.ssid || ""} ${snap.ip}`.trim() : " — Wi-Fi not connected"}`
    );
    registerBridge();
  }

  async function handleLights(payload) {
    const requestId = payload?.requestId;
    const on = !!payload?.on;
    const fromSid = payload?.fromSid;
    const respond = (result) => {
      socket?.emit("lights:bridgeResult", {
        requestId,
        fromSid,
        on,
        host: lightsInfoRef.current.name || shellyRef.current?.name || "",
        ip: lightsInfoRef.current.ip || "",
        ...result,
      });
    };
    const shelly = shellyRef.current;
    if (!shelly || !lightsInfoRef.current.ready) {
      respond({
        ok: false,
        error: "Lights Bluetooth is not connected. On the bridge page, tap Connect Lights Bluetooth.",
      });
      pushLog("Lights command ignored — plug not connected");
      return;
    }
    try {
      pushLog(on ? "Lights ON" : "Lights OFF");
      await shelly.setOn(on);
      setLightsOn(on);
      setLightsError("");
      respond({ ok: true });
    } catch (e) {
      const message = e?.message || String(e);
      setLightsError(message);
      respond({ ok: false, error: message });
      pushLog(`Lights failed: ${message}`);
    }
  }

  lightsHandlerRef.current = handleLights;

  async function connectLights() {
    if (!supportsWebBluetooth()) {
      pushLog("Web Bluetooth not available. Install Chrome, then open this page in Chrome.");
      alert("This browser cannot use Bluetooth. Open the bridge page in Chrome.");
      return;
    }
    if (lightsConnectLock.current) return;
    lightsConnectLock.current = true;
    setBusy(true);
    setLightsState("connecting");
    setLightsError("");
    try {
      pushLog("Choose the Shelly plug in the Bluetooth list. Do not choose the turntable.");
      const shelly = await connectShellyPlug();
      await adoptShelly(shelly);
    } catch (e) {
      if (e?.name === "NotFoundError") {
        pushLog("Lights chooser closed");
        setLightsState(lightsInfoRef.current.ready && shellyRef.current ? "connected" : "disconnected");
        return;
      }
      const message = e?.message || String(e);
      pushLog(`Lights connect failed: ${message}`);
      if (lightsInfoRef.current.ready && shellyRef.current) {
        setLightsState("connected");
        setLightsError(message);
      } else {
        markLightsDown(message);
      }
    } finally {
      lightsConnectLock.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!supportsWebBluetooth()) return;
      let acquired = false;
      try {
        const saved = localStorage.getItem(SHELLY_ID_KEY) || "";
        const device = await previouslyPairedShelly(saved);
        if (!device || cancel || lightsConnectLock.current) return;
        lightsConnectLock.current = true;
        acquired = true;
        setLightsState("connecting");
        pushLog("Reconnecting lights…");
        const shelly = await connectShellyPlug(device);
        if (cancel) {
          try {
            shelly.device.gatt?.disconnect();
          } catch {
            /* ignore */
          }
          return;
        }
        await adoptShelly(shelly);
      } catch (e) {
        if (cancel) return;
        pushLog(`Lights reconnect failed: ${e?.message || e}`);
        if (!shellyRef.current) {
          setLightsState("disconnected");
          setLightsError(e?.message || "Could not reconnect the lights.");
        }
      } finally {
        if (acquired) lightsConnectLock.current = false;
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (lightsState !== "connected") return undefined;
    const id = setInterval(() => {
      const shelly = shellyRef.current;
      if (!shelly) return;
      shelly
        .snapshot()
        .then((snap) => {
          lightsInfoRef.current = { name: snap.name, ip: snap.ip, ready: true };
          setLightsName(snap.name);
          setLightsIp(snap.ip);
          setLightsSsid(snap.ssid);
          setLightsWifi(snap.wifiUp);
          setLightsOn(snap.on);
          setLightsError("");
        })
        .catch((e) => {
          setLightsError(e?.message || "Could not read the plug.");
        });
    }, 20000);
    return () => clearInterval(id);
  }, [lightsState]);

  async function testLights(on) {
    const shelly = shellyRef.current;
    if (!shelly) return;
    setBusy(true);
    try {
      pushLog(on ? "Lights ON" : "Lights OFF");
      await shelly.setOn(on);
      setLightsOn(on);
      setLightsError("");
    } catch (e) {
      const message = e?.message || String(e);
      setLightsError(message);
      pushLog(`Lights failed: ${message}`);
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
      pushLog("Turntable Bluetooth connected");
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
        Keep this page open on the Fire HD 10. The iPhone sends turntable and light commands here.
        This tablet talks Bluetooth to the turntable and to the Shelly plug.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <Chip ok={socketOk} label={socketOk ? "Server connected" : "Server offline"} />
        <Chip ok={bleOk} label={bleOk ? `Turntable: ${bleName || "connected"}` : "Turntable disconnected"} />
        <Chip
          ok={lightsState === "connected" && lightsWifi}
          warn={lightsState === "connecting" || (lightsState === "connected" && !lightsWifi)}
          label={
            lightsState === "connecting"
              ? "Lights connecting"
              : lightsState === "connected" && lightsWifi
                ? "Lights connected"
                : lightsState === "connected"
                  ? "Lights: Wi-Fi off"
                  : "Lights not connected"
          }
        />
        {busy ? <Chip ok={false} warn label="Busy" /> : null}
      </div>

      <div
        style={{
          background: "#111",
          border: `1px solid ${
            lightsState === "connected" && lightsWifi
              ? "rgba(22,163,74,0.7)"
              : lightsState === "connecting"
                ? "rgba(245,158,11,0.7)"
                : "rgba(239,68,68,0.55)"
          }`,
          borderRadius: 12,
          padding: "12px 14px",
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 13, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9ca3af" }}>
          Lights
        </div>
        <StatusLine
          label="Bluetooth"
          ok={lightsState === "connecting" ? null : lightsState === "connected"}
          value={lightsState === "connecting" ? "Connecting…" : lightsState === "connected" ? "Connected" : "Not connected"}
        />
        <StatusLine
          label="Wi-Fi"
          ok={lightsState === "connecting" ? null : lightsState === "connected" && lightsWifi}
          value={
            lightsState === "connecting"
              ? "Checking…"
              : lightsState === "connected" && lightsWifi
                ? "Connected"
                : "Not connected"
          }
        />
        {lightsState === "connected" && lightsWifi ? (
          <div style={{ color: "#9ca3af", fontSize: 14, marginTop: 4 }}>
            {[lightsSsid, lightsIp].filter(Boolean).join(" · ")}
            {lightsName ? ` · ${lightsName}` : ""}
          </div>
        ) : null}
        <StatusLine
          label="Power"
          ok={lightsState === "connected" ? (lightsOn ? true : null) : false}
          value={lightsState === "connected" ? (lightsOn ? "On" : "Off") : "—"}
        />
        {lightsError ? (
          <div style={{ color: "#fecaca", fontSize: 14, marginTop: 8 }}>{lightsError}</div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          <button type="button" style={btnPrimary} disabled={busy} onClick={connectLights}>
            {lightsState === "connected" ? "Reconnect Lights Bluetooth" : "Connect Lights Bluetooth"}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              style={{ ...btnSecondary, flex: 1 }}
              disabled={busy || lightsState !== "connected"}
              onClick={() => testLights(true)}
            >
              Turn lights on
            </button>
            <button
              type="button"
              style={{ ...btnSecondary, flex: 1 }}
              disabled={busy || lightsState !== "connected"}
              onClick={() => testLights(false)}
            >
              Turn lights off
            </button>
          </div>
        </div>
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
        <li>Tap Connect Lights Bluetooth and choose the Shelly plug, not the turntable.</li>
        <li>Bluetooth and Wi-Fi both need to say Connected.</li>
        <li>Power on the ComXim turntable, then tap Connect Turntable Bluetooth.</li>
        <li>Use Turn lights on and Turn lights off on this page. A barcode scan on the iPhone only takes the photos.</li>
      </ol>
    </div>
  );
}

function StatusLine({ label, ok, value }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 18,
        padding: "8px 0",
        borderTop: "1px solid #2a2a2a",
        marginTop: 8,
      }}
    >
      <span style={{ color: "#9ca3af" }}>{label}</span>
      <span style={{ color: ok == null ? "#e5e7eb" : ok ? "#4ade80" : "#f87171", fontWeight: 700 }}>{value}</span>
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
