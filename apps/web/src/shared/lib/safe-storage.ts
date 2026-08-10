/**
 * localStorage helpers with quota fail-closed messaging (package 21 EDGE).
 */
const SHARE_LAST_KEY = "cloud-connector:last-share-state:v1";

export type StorageWriteResult =
  | { ok: true }
  | { ok: false; code: "quota" | "unavailable"; error: string };

export function writeLocalJson(key: string, value: unknown): StorageWriteResult {
  if (typeof localStorage === "undefined") {
    return { ok: false, code: "unavailable", error: "localStorage unavailable" };
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/quota|exceeded/i.test(msg)) {
      return { ok: false, code: "quota", error: "localStorage quota exceeded" };
    }
    return { ok: false, code: "unavailable", error: msg };
  }
}

export function readLocalJson<T>(key: string): T | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveLastShareState(state: unknown): StorageWriteResult {
  return writeLocalJson(SHARE_LAST_KEY, state);
}

export function loadLastShareState<T>(): T | null {
  return readLocalJson<T>(SHARE_LAST_KEY);
}

export { SHARE_LAST_KEY };
