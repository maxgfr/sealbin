/**
 * The one automatic reload after a deploy: a sessionStorage flag set before it, cleared when a
 * screen loads. sessionStorage belongs to the origin, shared by every maxgfr.github.io site opened
 * in the tab, so the key carries the app's name, and a full one must not turn into a reload loop:
 * no flag stored, no automatic reload.
 */
export const RELOADED_KEY = "sealbin:reloaded-for-update";
/** The flag's name before it was namespaced: still sealbin's own, removed with the new one. */
const OLD_RELOADED_KEY = "sb-reloaded-for-update";

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function session(): FlagStorage {
  return globalThis.sessionStorage;
}

export function reloadedOnce(storage: FlagStorage = session()): boolean {
  try {
    return storage.getItem(RELOADED_KEY) !== null || storage.getItem(OLD_RELOADED_KEY) !== null;
  } catch {
    // Storage blocked: never auto-reload, since the loop guard could not hold.
    return true;
  }
}

/** Sets or clears the flag; false when it could not be set (storage blocked or full). */
export function setReloaded(on: boolean, storage: FlagStorage = session()): boolean {
  try {
    if (on) {
      storage.setItem(RELOADED_KEY, "1");
    } else {
      storage.removeItem(RELOADED_KEY);
      storage.removeItem(OLD_RELOADED_KEY);
    }
    return true;
  } catch {
    return false;
  }
}
