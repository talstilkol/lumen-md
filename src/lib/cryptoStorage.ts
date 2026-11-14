/**
 * Async IndexedDB encryption using Web Crypto API with streams.
 *
 * Encrypts sensitive data at rest (version history snapshots, auto-backup,
 * sync cache) with AES-GCM using a key derived from a user password + random salt.
 *
 * The key is never persisted — it's re-derived on demand from the password,
 * with PBKDF2 (100k iterations, SHA-256). The salt is stored alongside the
 * ciphertext. There is no "change the password" entry point: the one that
 * existed (`setEncryptionPassword`) had no caller and re-encrypted inside
 * IndexedDB callbacks after their transaction closed, so it was removed
 * (W10.C dead seams; the whole module is unused, scripts/unused-files.baseline.json).
 *
 * Non-encrypted stores (e.g. settings, UI state) can opt out with
 * `encrypt: false`.
 */

import { log } from "./logger";

const DB_NAME = "LumenEncryptedStorage";
const DB_VERSION = 1;

/**
 * Byte buffers backed by a plain `ArrayBuffer` (never a SharedArrayBuffer).
 * TS ≥5.7 makes `Uint8Array` generic over its buffer, and WebCrypto's
 * `BufferSource` only accepts `ArrayBuffer`-backed views — so we pin the
 * generic here instead of casting at every call site.
 */
type Bytes = Uint8Array<ArrayBuffer>;

interface EncryptedRecord {
  iv: Bytes;
  salt: Bytes;
  ciphertext: Bytes;
}

interface StoreConfig {
  name: string;
  encrypt: boolean;
}

const DEFAULT_STORES: StoreConfig[] = [
  { name: "snapshots", encrypt: true },    // versionHistory
  { name: "backups", encrypt: true },      // autoBackup
  { name: "syncCache", encrypt: true },   // cloudSync cache
  { name: "settings", encrypt: false },  // app settings
];

// PBKDF2 parameters
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 256; // bits
const IV_LENGTH = 12;   // 96-bit nonce for AES-GCM
const SALT_LENGTH = 16; // 128-bit salt

/** Derive an AES-GCM key from a password and salt. */
async function deriveKey(password: string, salt: Bytes): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
}

function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Encrypt a string with AES-GCM. Returns serializable EncryptedRecord. */
export async function encrypt(
  password: string,
  plaintext: string,
): Promise<EncryptedRecord> {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(plaintext),
    ),
  );
  return { iv, salt, ciphertext };
}

/** Decrypt an EncryptedRecord back to a string. */
export async function decrypt(
  password: string,
  record: EncryptedRecord,
): Promise<string> {
  const key = await deriveKey(password, record.salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: record.iv },
    key,
    record.ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

// ── IndexedDB wrapper ───────────────────────────────────────────────────────

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of DEFAULT_STORES) {
        if (!db.objectStoreNames.contains(s.name)) {
          db.createObjectStore(s.name);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

/** Check if a password was previously set (salt exists for any store). */
export async function isEncryptionConfigured(): Promise<boolean> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("snapshots", "readonly");
      const store = tx.objectStore("snapshots");
      const req = store.get("__salt");
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return false;
  }
}

/**
 * Store a value in IndexedDB, encrypting if the store requires it and a
 * password is configured. If no password is set, stores plaintext.
 */
export async function setItem(
  storeName: string,
  key: string,
  value: string,
  password?: string,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);

  const config = DEFAULT_STORES.find((s) => s.name === storeName);
  if (!config) throw new Error(`Unknown store: ${storeName}`);

  if (config.encrypt && password) {
    const enc = await encrypt(password, value);
    store.put(enc, key);
  } else {
    store.put(value, key);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Retrieve a value from IndexedDB. If encrypted, decrypts with the password.
 * Returns `null` if the key doesn't exist.
 */
export async function getItem(
  storeName: string,
  key: string,
  password?: string,
): Promise<string | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = async () => {
      const raw = req.result;
      if (raw === undefined) { resolve(null); return; }

      const config = DEFAULT_STORES.find((s) => s.name === storeName);
      if (!config || !config.encrypt) {
        resolve(typeof raw === "string" ? raw : JSON.stringify(raw));
        return;
      }

      // Encrypted?
      if (raw.iv && raw.salt && raw.ciphertext) {
        if (!password) { resolve(null); return; }
        try {
          const plain = await decrypt(password, raw);
          resolve(plain);
        } catch (e) {
          log.warn("cryptoStorage", "Decrypt failed:", key, e);
          resolve(null);
        }
        return;
      }

      // Plaintext fallback.
      resolve(typeof raw === "string" ? raw : JSON.stringify(raw));
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Delete a key from an IndexedDB store.
 */
export async function deleteItem(storeName: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Clear all data from an IndexedDB store.
 */
export async function clearStore(storeName: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
