/**
 * Shelly Plug US Gen4 RPC over Bluetooth, used by the Fire tablet bridge page.
 * The bridge page is HTTPS, so it cannot call the plug's http:// address.
 */

const GATT = "5f6d4f53-5f52-5043-5f53-56435f49445f";
const TX = "5f6d4f53-5f52-5043-5f74-785f63746c5f";
const DATA = "5f6d4f53-5f52-5043-5f64-6174615f5f5f";
const RX = "5f6d4f53-5f52-5043-5f72-785f63746c5f";
const CHUNK = 20;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function viewBytes(view) {
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

async function writeChar(characteristic, bytes) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (characteristic.properties?.write) {
    await characteristic.writeValue(value);
    return;
  }
  if (characteristic.writeValueWithoutResponse) {
    await characteristic.writeValueWithoutResponse(value);
    return;
  }
  await characteristic.writeValue(value);
}

export async function previouslyPairedShelly(savedId) {
  if (!navigator.bluetooth?.getDevices) return null;
  const devices = await navigator.bluetooth.getDevices();
  if (savedId) {
    const match = devices.find((device) => device.id === savedId);
    if (match) return match;
  }
  return devices.find((device) => /shelly/i.test(device.name || "")) || null;
}

export async function connectShellyPlug(existingDevice) {
  if (!navigator.bluetooth?.requestDevice) {
    throw new Error("This browser cannot use Bluetooth. Open the bridge page in Chrome.");
  }
  const device =
    existingDevice ||
    (await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [GATT],
    }));
  const server = await device.gatt.connect();
  let service;
  try {
    service = await server.getPrimaryService(GATT);
  } catch {
    try {
      server.disconnect();
    } catch {
      /* ignore */
    }
    throw new Error("That Bluetooth device is not the Shelly plug. Choose the plug, not the turntable.");
  }
  const tx = await service.getCharacteristic(TX);
  const data = await service.getCharacteristic(DATA);
  const rx = await service.getCharacteristic(RX);

  let rpcId = 1;
  let pendingLength = null;
  let chain = Promise.resolve();

  const onRx = (event) => {
    const view = event.target?.value;
    if (!view || view.byteLength < 4 || !pendingLength) return;
    const length = view.getUint32(0, false);
    if (!length || length > 16000) return;
    const resolve = pendingLength;
    pendingLength = null;
    resolve(length);
  };
  rx.addEventListener("characteristicvaluechanged", onRx);
  if (rx.properties?.notify || rx.properties?.indicate) {
    await rx.startNotifications();
  }

  function waitForLength() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (pendingLength === give) pendingLength = null;
        fn(value);
      };
      const give = (length) => finish(resolve, length);
      const timer = setTimeout(() => {
        finish(reject, new Error("The Shelly plug did not answer."));
      }, 8000);
      pendingLength = give;
      const poll = async () => {
        await sleep(600);
        while (!settled && rx.properties?.read) {
          try {
            const view = await rx.readValue();
            if (view?.byteLength >= 4) {
              const length = view.getUint32(0, false);
              if (length > 0 && length < 16000) {
                finish(resolve, length);
                return;
              }
            }
          } catch {
            /* the notify may still arrive */
          }
          await sleep(200);
        }
      };
      poll();
    });
  }

  async function callNow(method, params) {
    if (!device.gatt?.connected) {
      throw new Error("Lights Bluetooth disconnected.");
    }
    const id = rpcId;
    rpcId += 1;
    const payload = JSON.stringify({
      id,
      method,
      params: params || {},
    });
    const bytes = new TextEncoder().encode(payload);
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, bytes.length, false);
    if (rx.properties?.read) {
      try {
        await rx.readValue();
      } catch {
        /* clear a stale length before this request */
      }
    }
    const lengthPromise = waitForLength();
    lengthPromise.catch(() => {});
    await writeChar(tx, length);
    await sleep(20);
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
      await writeChar(data, bytes.slice(offset, offset + CHUNK));
      if (offset + CHUNK < bytes.length) await sleep(15);
    }
    const expected = await lengthPromise;
    const parts = [];
    let got = 0;
    let emptyReads = 0;
    while (got < expected && emptyReads < 8) {
      const chunk = viewBytes(await data.readValue());
      if (!chunk.length) {
        emptyReads += 1;
        await sleep(40);
        continue;
      }
      emptyReads = 0;
      parts.push(chunk);
      got += chunk.length;
    }
    const merged = new Uint8Array(got);
    let at = 0;
    for (const part of parts) {
      merged.set(part, at);
      at += part.length;
    }
    let json;
    try {
      json = JSON.parse(new TextDecoder().decode(merged.slice(0, expected)));
    } catch {
      throw new Error(`The Shelly plug sent an unreadable answer to ${method}.`);
    }
    if (json.id != null && Number(json.id) !== id) {
      throw new Error("The Shelly plug answered a different command.");
    }
    if (json.error) {
      const message = json.error.message || "Shelly rejected the command";
      if (Number(json.error.code) === 401) {
        throw new Error("The plug is asking for a password. In the Shelly app, open the plug and turn authentication off.");
      }
      throw new Error(message);
    }
    return json.result;
  }

  function call(method, params) {
    const run = chain.then(() => callNow(method, params));
    chain = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  async function snapshot() {
    const info = await call("Shelly.GetDeviceInfo");
    const wifi = await call("Wifi.GetStatus");
    const sw = await call("Switch.GetStatus", { id: 0 });
    const ip = String(wifi?.sta_ip || "").trim();
    const name =
      (info?.name && String(info.name).trim()) ||
      info?.id ||
      device.name ||
      "Shelly plug";
    return {
      name,
      model: info?.model || "",
      ip,
      ssid: wifi?.ssid || "",
      wifiUp: !!ip && String(wifi?.status || "").toLowerCase() === "got ip",
      on: !!sw?.output,
    };
  }

  return {
    device,
    name: device.name || "Shelly plug",
    call,
    snapshot,
    setOn(on) {
      return call("Switch.Set", { id: 0, on: !!on });
    },
  };
}
