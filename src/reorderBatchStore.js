const KEY = "jrco.reorder_batch.v1";
const CHANNEL = "jrco.reorder_batch";

function safeParse(raw) {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || !data.batchId) return null;
    return data;
  } catch (_) {
    return null;
  }
}

export function readActiveReorderBatch() {
  try {
    return safeParse(localStorage.getItem(KEY));
  } catch (_) {
    return null;
  }
}

export function writeActiveReorderBatch(batch) {
  const payload = {
    batchId: batch.batchId,
    company: batch.company || "",
    startedAt: batch.startedAt || new Date().toISOString(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch (_) {}
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel(CHANNEL);
      ch.postMessage({ type: "set", batch: payload });
      ch.close();
    }
  } catch (_) {}
}

export function clearActiveReorderBatch() {
  try {
    localStorage.removeItem(KEY);
  } catch (_) {}
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel(CHANNEL);
      ch.postMessage({ type: "clear" });
      ch.close();
    }
  } catch (_) {}
}

export function subscribeReorderBatch(onChange) {
  const emit = () => onChange(readActiveReorderBatch());
  const onStorage = (e) => {
    if (e.key === KEY) emit();
  };
  window.addEventListener("storage", onStorage);
  let channel = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = emit;
    }
  } catch (_) {}
  return () => {
    window.removeEventListener("storage", onStorage);
    try {
      channel?.close();
    } catch (_) {}
  };
}
