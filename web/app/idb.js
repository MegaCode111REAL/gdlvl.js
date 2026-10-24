// Tiny IndexedDB key-value helper. Every call fails soft (returns undefined / does nothing) because
// storage can be missing or blocked in private windows.
const open = () => new Promise((resolve, reject) => {
  const r = indexedDB.open("gdlvl-editor", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("kv");
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

const run = async (mode, fn) => {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", mode);
      const req = fn(tx.objectStore("kv"));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } catch { return undefined; }
};

export const kvGet = (k) => run("readonly", (s) => s.get(k));
export const kvSet = (k, v) => run("readwrite", (s) => s.put(v, k));
export const kvDel = (k) => run("readwrite", (s) => s.delete(k));
