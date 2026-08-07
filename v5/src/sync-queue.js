import { openDB } from 'idb';

const DB_NAME = 'measured-stock-v5';
const STORE = 'write_queue';
const DB_VERSION = 2;

let dbPromise = null;
let flushPromise = null;
let onStatusChange = null;
/** @type {string | null} ISO timestamp of last successful flush write */
let lastSyncedAt = null;
const LAST_SYNC_KEY = 'v5_last_synced_at';

try {
  lastSyncedAt = sessionStorage.getItem(LAST_SYNC_KEY) || null;
} catch {
  lastSyncedAt = null;
}

function markSynced() {
  lastSyncedAt = new Date().toISOString();
  try {
    sessionStorage.setItem(LAST_SYNC_KEY, lastSyncedAt);
  } catch { /* ignore */ }
}

/** @returns {string | null} */
export function getLastSyncedAt() {
  return lastSyncedAt;
}

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('status', 'status');
          store.createIndex('createdAt', 'createdAt');
          store.createIndex('dedupeKey', 'dedupeKey', { unique: false });
          return;
        }
        if (oldVersion < 2) {
          const store = transaction.objectStore(STORE);
          if (!store.indexNames.contains('dedupeKey')) {
            store.createIndex('dedupeKey', 'dedupeKey', { unique: false });
          }
        }
      },
    });
  }
  return dbPromise;
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'q' + Date.now() + Math.random().toString(36).slice(2);
}

function notifyStatus() {
  if (onStatusChange) onStatusChange();
}

export function setSyncStatusListener(fn) {
  onStatusChange = fn;
}

export async function getQueueStats() {
  const db = await getDb();
  const [pendingRows, failedRows] = await Promise.all([
    db.getAllFromIndex(STORE, 'status', 'pending'),
    db.getAllFromIndex(STORE, 'status', 'failed'),
  ]);
  return {
    pending: pendingRows.length,
    failed: failedRows.length,
    total: pendingRows.length + failedRows.length,
  };
}

/**
 * @param {object} item
 * @param {'upsert'|'insert'|'update'|'delete'} item.op
 * @param {string} item.table
 * @param {object} item.payload
 * @param {string} [item.dedupeKey] — replace existing pending with same key
 */
export async function enqueueWrite(item) {
  const db = await getDb();
  if (item.dedupeKey) {
    const matches = await db.getAllFromIndex(STORE, 'dedupeKey', item.dedupeKey);
    for (const row of matches) {
      if (row.status === 'pending') await db.delete(STORE, row.id);
    }
  }
  const record = {
    id: uuid(),
    op: item.op,
    table: item.table,
    payload: item.payload,
    dedupeKey: item.dedupeKey || null,
    createdAt: new Date().toISOString(),
    retries: 0,
    status: 'pending',
    lastError: null,
  };
  await db.put(STORE, record);
  notifyStatus();
  scheduleFlush();
  return record;
}

async function executeWrite(DB, record) {
  const { op, table, payload } = record;
  const enc = DB._.enc;

  if (op === 'delete') {
    const filter = payload.filter || ('id=eq.' + enc(payload.id));
    return DB.remove(table, filter);
  }

  if (op === 'insert') {
    const rows = Array.isArray(payload.rows) ? payload.rows : [payload.row];
    return DB.insert(table, rows);
  }

  if (op === 'update') {
    const filter = payload.filter || ('id=eq.' + enc(payload.id));
    return DB.update(table, filter, payload.patch);
  }

  if (op === 'upsert') {
    const rows = Array.isArray(payload.rows) ? payload.rows : [payload.row];
    return DB.upsert(table, rows, { onConflict: payload.onConflict });
  }

  throw new Error('Unknown op: ' + op);
}

export async function flushQueue(DB) {
  if (flushPromise) return flushPromise;

  flushPromise = (async () => {
    const db = await getDb();
    const [pendingRows, failedRows] = await Promise.all([
      db.getAllFromIndex(STORE, 'status', 'pending'),
      db.getAllFromIndex(STORE, 'status', 'failed'),
    ]);
    const pending = [...pendingRows, ...failedRows]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    let wrote = false;
    for (const record of pending) {
      try {
        await executeWrite(DB, record);
        await db.delete(STORE, record.id);
        wrote = true;
      } catch (err) {
        record.retries = (record.retries || 0) + 1;
        record.status = record.retries >= 5 ? 'failed' : 'pending';
        record.lastError = String(err?.message || err);
        await db.put(STORE, record);
        if (!navigator.onLine) break;
      }
    }
    if (wrote || pending.length === 0) markSynced();
    notifyStatus();
  })().finally(() => {
    flushPromise = null;
  });

  return flushPromise;
}

let flushTimer = null;
function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    if (typeof window !== 'undefined' && window.__V5_FLUSH__) {
      window.__V5_FLUSH__();
    }
  }, 300);
}

export function bindOnlineFlush(flushFn) {
  if (typeof window === 'undefined') return;
  window.__V5_FLUSH__ = flushFn;
  window.addEventListener('online', () => flushFn());
  setInterval(() => {
    if (navigator.onLine) flushFn();
  }, 30000);
}

export async function clearFailed() {
  const db = await getDb();
  const failed = await db.getAllFromIndex(STORE, 'status', 'failed');
  for (const r of failed) {
    await db.delete(STORE, r.id);
  }
  notifyStatus();
}
