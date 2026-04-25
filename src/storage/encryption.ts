/**
 * Vault Encryption — AES-256-GCM using the Web Crypto API.
 * 
 * Provides encrypt/decrypt for individual documents and workspace-level
 * key management using PBKDF2 password derivation.
 */

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 100_000;

/** Derive an AES-GCM key from a password using PBKDF2 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
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
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt plaintext with a password. Returns base64-encoded ciphertext. */
export async function encryptText(plaintext: string, password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );

  // Pack: salt (16) + iv (12) + ciphertext
  const packed = new Uint8Array(SALT_LENGTH + IV_LENGTH + encrypted.byteLength);
  packed.set(salt, 0);
  packed.set(iv, SALT_LENGTH);
  packed.set(new Uint8Array(encrypted), SALT_LENGTH + IV_LENGTH);

  return btoa(String.fromCharCode(...packed));
}

/** Decrypt base64-encoded ciphertext with a password. */
export async function decryptText(cipherBase64: string, password: string): Promise<string> {
  const packed = Uint8Array.from(atob(cipherBase64), (c) => c.charCodeAt(0));

  const salt = packed.slice(0, SALT_LENGTH);
  const iv = packed.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = packed.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveKey(password, salt);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(decrypted);
}

/** Check if a document is encrypted (starts with the encryption marker) */
export function isEncrypted(content: string): boolean {
  return content.startsWith("🔒LUMEN_ENCRYPTED:");
}

/** Wrap encrypted content with a marker */
export function wrapEncrypted(encrypted: string): string {
  return `🔒LUMEN_ENCRYPTED:${encrypted}`;
}

/** Unwrap encrypted content (remove marker) */
export function unwrapEncrypted(content: string): string {
  return content.replace(/^🔒LUMEN_ENCRYPTED:/, "");
}

/** Encrypt a document for storage */
export async function encryptDocument(content: string, password: string): Promise<string> {
  const encrypted = await encryptText(content, password);
  return wrapEncrypted(encrypted);
}

/** Decrypt a stored document */
export async function decryptDocument(content: string, password: string): Promise<string> {
  if (!isEncrypted(content)) return content;
  const payload = unwrapEncrypted(content);
  return decryptText(payload, password);
}
