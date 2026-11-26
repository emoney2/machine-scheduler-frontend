// Headcover Studio sessions, saved in this browser (IndexedDB) so a batch of designs can be reopened later.
// A session holds the cleaned logo, the picks and settings, and every design as plain data (template +
// one material id per role + locked flag). Renders are rebuilt from that when a session is opened.
const DB = "hcs-sessions", STORE = "sessions";

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "id" }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), st = t.objectStore(STORE);
    const req = fn(st);
    t.oncomplete = () => { resolve(req && req.result); db.close(); };
    t.onerror = () => { reject(t.error); db.close(); };
  });
}

export const saveSession = (s) => tx("readwrite", (st) => st.put(s));
export const getSession = (id) => tx("readonly", (st) => st.get(id));
export const deleteSession = (id) => tx("readwrite", (st) => st.delete(id));
export async function listSessions() {
  const all = (await tx("readonly", (st) => st.getAll())) || [];
  // the list only needs the summary; the logo blob and design data stay in storage
  return all.map(({ id, name, updatedAt, createdAt, count, locked, thumb }) => ({ id, name, updatedAt, createdAt, count, locked, thumb }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Spec -> storable data (materials by id) and back. */
export const packSpec = (sp) => ({ ...sp, roles: sp.roles.map((r) => ({ label: r.label, id: r.mat && r.mat.id })) });
export function unpackSpec(sp, matById) {
  const roles = sp.roles.map((r) => ({ label: r.label, mat: matById(r.id) }));
  return roles.every((r) => r.mat) ? { ...sp, roles } : null;
}

/** Small JPEG of a canvas for the session list. */
export function thumbOf(canvas, w = 260) {
  if (!canvas) return null;
  const c = document.createElement("canvas"), k = w / canvas.width;
  c.width = w; c.height = Math.round(canvas.height * k);
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.72);
}
