const STORAGE_KEY = "sewingBoardDraft.v1";

export function loadSewingBoardDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.dirty) return null;
    return {
      dirty: true,
      queue: Array.isArray(data.queue) ? data.queue : [],
      board: data.board && typeof data.board === "object" ? data.board : {},
      savedAt: data.savedAt || "",
    };
  } catch {
    return null;
  }
}

export function saveSewingBoardDraft(queue, board) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      dirty: true,
      queue: Array.isArray(queue) ? queue : [],
      board: board && typeof board === "object" ? board : {},
      savedAt: new Date().toISOString(),
    }));
  } catch (_) {
    /* ignore quota */
  }
}

export function clearSewingBoardDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {
    /* ignore */
  }
}
