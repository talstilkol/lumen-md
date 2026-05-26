/**
 * Async IndexedDB encryption using Web Crypto API with streams.
 *
 * Encrypts sensitive data at rest (version history snapshots, auto-backup,
 * sync cache) with AES-GCM using a key derived from a user password + random salt.
 *
 * The key is never persisted — it's re-derived on demand from the password,
 * with PBKDF2 (100k iterations, SHA-256). The salt is stored alongside the
 * ciphertext so a new password can be set without re-encrypting everything.
 *
 * Non-encrypted stores (e.g. settings, UI state) can opt out with
 * `encrypt: false`.
 */

import { log } from "./logger";

const DB_NAME = "LumenEncryptedStorage";
const DB_VERSION = 1;

interface EncryptedRecord {
  iv: Uint8Array;
  salt: Uint8Array;
  ciphertext: Uint8Array;
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
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
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
      salt: salt as any,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
}

function randomBytes(length: number): Uint8Array {
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
      { name: "AES-GCM", iv: iv as any },
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
    { name: "AES-GCM", iv: record.iv as any },
    key,
    record.ciphertext as any,
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

/** Set or change the encryption password. Re-encrypts all existing data.
 *  If `newPassword` is empty, removes encryption entirely. */
export async function setEncryptionPassword(
  newPassword: string,
  oldPassword?: string,
): Promise<void> {
  const db = await openDb();
  const stores = DEFAULT_STORES.filter((s) => s.encrypt).map((s) => s.name);

  // If we're removing encryption, decrypt everything and store plaintext.
  if (!newPassword) {
    if (!oldPassword) {
      // Just clear the salt marker to signal "unencrypted".
      const tx = db.transaction("snapshots", "readwrite");
      tx.objectStore("snapshots").delete("__salt");
      tx.oncomplete = () => db.close();
      return;
    }

    // Decrypt all stores.
    for (const name of stores) {
      const tx = db.transaction(name, "readwrite");
      const store = tx.objectStore(name);
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = async () => {
        for (const key of keysReq.result) {
          if (key === "__salt") continue;
          const recReq = store.get(key);
          recReq.onsuccess = async () => {
            const rec: EncryptedRecord = recReq.result;
            if (rec && rec.iv && rec.salt) {
              try {
                const plain = await decrypt(oldPassword, rec);
                store.put(plain, key);
              } catch (e) {
                log.warn("cryptoStorage", "Failed to decrypt during password removal:", key, e);
              }
            }
          };
        }
      };
    }
    db.close();
    return;
  }

  // Set / change password.
  const salt = randomBytes(SALT_LENGTH);
  const tx = db.transaction("snapshots", "readwrite");
  tx.objectStore("snapshots").put(salt, "__salt");
  tx.oncomplete = () => db.close();

  // Re-encrypt all stores with new password.
  // This is fire-and-forget in the background — the user can keep editing.
  for (const name of stores) {
    const tx2 = db.transaction(name, "readwrite");
    const store = tx2.objectStore(name);
    const keysReq = store.getAllKeys();
    keysReq.onsuccess = async () => {
      for (const key of keysReq.result) {
        if (key === "__salt") continue;
        const recReq = store.get(key);
        recReq.onsuccess = async () => {
          const raw = recReq.result;
          if (!raw) return;
          let plain: string;
          // Check if already encrypted (has iv/salt/ciphertext shape).
          if (raw.iv && raw.salt && raw.ciphertext) {
            if (!oldPassword) {
              log.warn("cryptoStorage", "Cannot re-encrypt without old password");
              return;
            }
            try {
              plain = await decrypt(oldPassword, raw as EncryptedRecord);
            } catch {
              log.warn("cryptoStorage", "Failed to decrypt with old password:", key);
              return;
            }
          } else if (typeof raw === "string") {
            plain = raw;
          } else {
            return; // object store — skip
          }
          const enc = await encrypt(newPassword, plain);
          store.put(enc, key);
        };
      }
    };
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
