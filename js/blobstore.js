// Imported models live in IndexedDB (localStorage is too small for model
// files). Like storage.js, this is per browser; failures reject and callers
// decide what to tell the user.
const DB_NAME = "backyard";
const STORE = "imports";

let dbPromise = null;
function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const allImports = () => run("readonly", (s) => s.getAll());
export const putImport = (record) => run("readwrite", (s) => s.put(record));
export const deleteImport = (id) => run("readwrite", (s) => s.delete(id));
