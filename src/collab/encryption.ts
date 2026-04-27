/**
 * End-to-end encryption for Yjs collab payloads (P3-13).
 *
 * Y-WebRTC + y-websocket transmit Y.Doc updates as binary `Uint8Array`s.
 * By default these are unencrypted — the signaling server (and anyone on
 * the LAN, or any compromised relay) sees the plaintext document.
 *
 * This module wraps the wire ops in AES-GCM using a key derived from a
 * shared room password via PBKDF2-SHA-256. The same room password on
 * every client → identical key → ops decrypt cleanly. A wrong password
 * → AES-GCM auth tag fails and the op is dropped (which Yjs handles —
 * the doc just stays out of sync until the user fixes the password).
 *
 * Format on the wire:
 *
 *     [12-byte IV][N-byte ciphertext + 16-byte tag]
 *
 * The IV is fresh per op (`crypto.getRandomValues`) so identical updates
 * encrypt to different ciphertexts. We don't ship the salt over the wire
 * — both peers derive the same key from the same password + a fixed
 * application salt (`lumen.collab.v1`). Rotating to a new key family is
 * handled by bumping the version string.
 */

const SALT_TEXT = "lumen.collab.v1";

let cachedKey: { password: string; key: CryptoKey } | null = null;

async function deriveKey(password: string): Promise<CryptoKey> {
  if (cachedKey && cachedKey.password === password) return cachedKey.key;
  const salt = new TextEncoder().encode(SALT_TEXT);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 200_000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  cachedKey = { password, key };
  return key;
}

/** Encrypt a Yjs update under the room password. */
export async function encryptOp(
  password: string,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const key = await deriveKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // Copy plaintext into a fresh ArrayBuffer-backed view — same reason
  // as decryptOp: WebCrypto's TS types reject ArrayBufferLike views.
  const ptCopy = new Uint8Array(plaintext);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, ptCopy),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return out;
}

/**
 * Decrypt a wire payload. Returns null when the auth tag fails — caller
 * should drop the op so a wrong-password peer can't poison the doc.
 */
export async function decryptOp(
  password: string,
  payload: Uint8Array,
): Promise<Uint8Array | null> {
  if (payload.length < 28) return null;
  const key = await deriveKey(password);
  // `subarray` views share the underlying ArrayBufferLike, which TS's
  // BufferSource types reject under stricter lib targets. Materialize
  // both halves into fresh, owned Uint8Arrays so the WebCrypto API is
  // happy.
  const iv = new Uint8Array(payload.slice(0, 12));
  const cipher = new Uint8Array(payload.slice(12));
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipher,
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

/** Drop the cached key (e.g. when leaving a room). */
export function resetCollabKey(): void {
  cachedKey = null;
}
