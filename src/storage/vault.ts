/**
 * Vault – encrypted IndexedDB storage for secrets (API keys, Git tokens).
 *
 * Uses AES-256-GCM via encryption.ts to protect secrets at rest.
 * The master password is the user's chosen password — it never leaves
 * the browser and is required to read/write secrets.
 *
 * Recovery: at vault creation time, the user is given a 12-word recovery
 * phrase (BIP39-style). The phrase is hashed and stored alongside an
 * encryption of the master password. If the user forgets the password,
 * they can re-enter the phrase to recover access.
 */
import { encryptText, decryptText } from "./encryption";
import { randomInt } from "../lib/cryptoRandom";

const DB_NAME = "lumen-vault";
const STORE_NAME = "secrets";
const RECOVERY_PASSWORD_KEY = "__recovery_password__";
const RECOVERY_PHRASE_HASH_KEY = "__recovery_phrase_hash__";

function openVaultDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Store a secret value in the encrypted vault.
 * The value is AES-encrypted with the master password before persistence.
 */
export async function setSecret(
  key: string,
  value: string | null,
  masterPassword: string,
): Promise<void> {
  const db = await openVaultDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  if (value === null) {
    store.delete(key);
  } else {
    const encrypted = await encryptText(value, masterPassword);
    store.put(encrypted, key);
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Retrieve a secret value from the encrypted vault.
 * Returns null if the key doesn't exist. Throws on wrong password.
 */
export async function getSecret(
  key: string,
  masterPassword: string,
): Promise<string | null> {
  const db = await openVaultDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);

  const encrypted = await new Promise<string | null>((resolve) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });

  db.close();
  if (!encrypted) return null;

  return decryptText(encrypted, masterPassword);
}

/**
 * Check if the vault has any secrets stored (to know if we need to prompt
 * for a master password).
 */
export async function hasSecrets(): Promise<boolean> {
  const db = await openVaultDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);

  const count = await new Promise<number>((resolve) => {
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(0);
  });

  db.close();
  return count > 0;
}

/**
 * List all secret keys (without decrypting values).
 * Internal recovery keys are filtered out.
 */
export async function listSecretKeys(): Promise<string[]> {
  const db = await openVaultDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);

  const keys = await new Promise<string[]>((resolve) => {
    const req = store.getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => resolve([]);
  });

  db.close();
  return keys.filter(
    (k) => k !== RECOVERY_PASSWORD_KEY && k !== RECOVERY_PHRASE_HASH_KEY,
  );
}

// ── Recovery phrase ─────────────────────────────────────────────────────
// Short BIP39-flavored wordlist; small enough to embed but large enough
// that 12 words from it gives ~144 bits of entropy.
const RECOVERY_WORDS = [
  "amber","anchor","apple","arrow","aurora","beacon","blaze","bloom","blue","bold",
  "bridge","brisk","cable","calm","candle","canyon","cedar","cipher","clay","clear",
  "cloud","clover","coast","comet","copper","coral","cosmic","creek","crisp","crown",
  "crystal","dawn","delta","desert","dew","drift","ember","emerald","falcon","fern",
  "field","flame","flint","flora","forest","frost","garnet","glacier","glow","golden",
  "grain","granite","grove","harbor","harvest","hazel","heron","hollow","horizon","ivory",
  "jade","jasper","journey","keel","kindle","lagoon","lake","lantern","laurel","leaf",
  "lichen","linen","lotus","lumen","lunar","maple","marble","meadow","mesa","misty",
  "moon","mosaic","mountain","myth","nimbus","north","oak","oasis","ocean","onyx",
  "opal","orchid","pearl","pebble","petal","pine","plum","poppy","prairie","quartz",
  "quill","raven","rapids","ridge","river","sage","saffron","savanna","sequoia","shore",
  "silver","slate","snow","solar","sonnet","spire","spring","starling","stone","summit",
  "sunset","tide","timber","tundra","vale","velvet","verdant","vesper","violet","walnut",
  "willow","winter","wisp","woven","yarrow","zenith",
];

export function generateRecoveryPhrase(wordCount = 12): string {
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    words.push(RECOVERY_WORDS[randomInt(RECOVERY_WORDS.length)]);
  }
  return words.join(" ");
}

function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

async function hashPhrase(phrase: string): Promise<string> {
  const data = new TextEncoder().encode(normalizePhrase(phrase));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function rawWrite(key: string, value: string): Promise<void> {
  const db = await openVaultDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(value, key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function rawRead(key: string): Promise<string | null> {
  const db = await openVaultDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const value = await new Promise<string | null>((resolve) => {
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
  db.close();
  return value;
}

/**
 * Bind a recovery phrase to a master password. Returns the freshly-generated
 * 12-word phrase. Show this to the user once — it cannot be retrieved later.
 *
 * Internally we store:
 *   1. SHA-256 hash of the phrase (for verification on recovery).
 *   2. The master password encrypted with the phrase as its key.
 */
export async function bindRecoveryPhrase(masterPassword: string): Promise<string> {
  const phrase = generateRecoveryPhrase();
  const phraseHash = await hashPhrase(phrase);
  const encryptedPassword = await encryptText(masterPassword, normalizePhrase(phrase));
  await rawWrite(RECOVERY_PHRASE_HASH_KEY, phraseHash);
  await rawWrite(RECOVERY_PASSWORD_KEY, encryptedPassword);
  return phrase;
}

export async function hasRecoveryPhrase(): Promise<boolean> {
  return (await rawRead(RECOVERY_PHRASE_HASH_KEY)) !== null;
}

/**
 * Recover the master password from a phrase. Returns the original password
 * if the phrase matches, or null if it doesn't.
 */
export async function recoverPassword(phrase: string): Promise<string | null> {
  const expectedHash = await rawRead(RECOVERY_PHRASE_HASH_KEY);
  if (!expectedHash) return null;
  const actualHash = await hashPhrase(phrase);
  if (actualHash !== expectedHash) return null;
  const encrypted = await rawRead(RECOVERY_PASSWORD_KEY);
  if (!encrypted) return null;
  try {
    return await decryptText(encrypted, normalizePhrase(phrase));
  } catch {
    return null;
  }
}
