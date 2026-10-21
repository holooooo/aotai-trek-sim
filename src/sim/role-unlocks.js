const STORAGE_KEY = 'aotai-role-unlocks-v1';
const FALLBACK = new Set();
const VALID_ID = /^[A-Za-z0-9_-]{1,32}$/;

function getStorage(storage) {
  if (storage !== undefined) return storage && typeof storage.getItem === 'function' ? storage : null;
  try { return globalThis.localStorage && typeof globalThis.localStorage.getItem === 'function' ? globalThis.localStorage : null; } catch { return null; }
}

function read(storage) {
  const s = getStorage(storage);
  if (!s) return new Set(FALLBACK);
  let raw;
  try { raw = s.getItem(STORAGE_KEY); } catch { return new Set(FALLBACK); }
  try {
    const value = JSON.parse(raw || '[]');
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string' && VALID_ID.test(id)) : []);
  } catch { return new Set(); }
}

function write(storage, ids) {
  const s = getStorage(storage);
  const payload = JSON.stringify([...ids]);
  if (s) {
    try { s.setItem(STORAGE_KEY, payload); return true; } catch { /* private mode or quota */ }
  }
  FALLBACK.clear();
  ids.forEach((id) => FALLBACK.add(id));
  return false;
}

export function isRoleUnlocked(id, storage) {
  return read(storage).has(id);
}

export function unlockRole(id, storage) {
  if (typeof id !== 'string' || !VALID_ID.test(id)) return false;
  const ids = read(storage);
  const already = ids.has(id);
  ids.add(id);
  write(storage, ids);
  return !already;
}

export function clearRoleUnlocks(storage) {
  const s = getStorage(storage);
  try { s?.removeItem?.(STORAGE_KEY); } catch { /* private mode or quota */ }
  FALLBACK.clear();
}

export const ROLE_UNLOCK_STORAGE_KEY = STORAGE_KEY;
