/**
 * Collaborative version history — saves snapshots of the document
 * at 5-minute intervals during active editing, with author attribution
 * and a diff-based timeline UI.
 *
 * Snapshots are stored in IndexedDB keyed by (roomId, timestamp).
 */

import { log } from "../lib/logger";

const DB_NAME = "LumenVersionHistory";
const DB_VERSION = 1;
const STORE = "snapshots";

export interface Snapshot {
  roomId: string;
  timestamp: number;
  text: string;
  authorName: string;
  authorClientId: number;
}

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: ["roomId", "timestamp"] });
        s.createIndex("byRoom", "roomId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.put(snapshot);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function getSnapshots(roomId: string, limit = 50): Promise<Snapshot[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const idx = store.index("byRoom");
    const req = idx.openCursor(roomId);
    const out: Snapshot[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= limit) {
        resolve(out.reverse()); // newest first
        db.close();
        return;
      }
      out.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => {
      reject(req.error);
      db.close();
    };
  });
}

/** Delete all snapshots older than `maxAgeDays` for a given room. */
export async function pruneSnapshots(roomId: string, maxAgeDays = 30): Promise<number> {
  const db = await openDb();
  const cutoff = Date.now() - maxAgeDays * 86400_000;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const idx = store.index("byRoom");
    const req = idx.openCursor(roomId);
    let deleted = 0;
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(deleted);
        db.close();
        return;
      }
      const snap: Snapshot = cursor.value;
      if (snap.timestamp < cutoff) {
        cursor.delete();
        deleted++;
      }
      cursor.continue();
    };
    req.onerror = () => {
      reject(req.error);
      db.close();
    };
  });
}

/**
 * Very simple line-based diff.
 * Returns { added: string[], removed: string[] } comparing `older` to `newer`.
 */
export function computeDiff(older: string, newer: string): { added: string[]; removed: string[] } {
  const oldLines = older.split("\n");
  const newLines = newer.split("\n");
  const removed: string[] = [];
  const added: string[] = [];

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  for (const line of oldLines) {
    if (!newSet.has(line) && line.trim()) removed.push(line);
  }
  for (const line of newLines) {
    if (!oldSet.has(line) && line.trim()) added.push(line);
  }
  return { added, removed };
}

/**
 * Background snapshot interval. Call once when a collab session starts.
 * Automatically prunes old snapshots.
 */
export function startSnapshotInterval(
  roomId: string,
  getText: () => string,
  getAuthor: () => { name: string; clientId: number },
  intervalMs = 300_000, // 5 minutes
): () => void {
  let lastText = "";
  const timer = setInterval(async () => {
    const text = getText();
    if (text === lastText) return; // no change — skip
    lastText = text;
    try {
      await saveSnapshot({
        roomId,
        timestamp: Date.now(),
        text,
        authorName: getAuthor().name,
        authorClientId: getAuthor().clientId,
      });
      // Prune every 20 snapshots
      const snaps = await getSnapshots(roomId, 1);
      if (snaps.length % 20 === 0) {
        await pruneSnapshots(roomId);
      }
    } catch (e) {
      log.warn("snapshot", e);
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
