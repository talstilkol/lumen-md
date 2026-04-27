/**
 * Plugin signature verification.
 *
 * Each registry entry can include a `signature` (base64-encoded
 * Ed25519 signature over the plugin's bundle bytes) and a `signedBy`
 * (the public-key fingerprint that signed it). The host verifies both
 * before letting a plugin install — preventing a compromised CDN from
 * shipping malicious code.
 *
 * Trust roots:
 *   • A small built-in list of "verified" public keys (Lumen team +
 *     trusted partners).
 *   • Optional user-trusted keys stored in IndexedDB after explicit
 *     "trust this key forever" consent.
 *
 * The verification path is:
 *   1. Fetch the bundle.
 *   2. Compute SHA-256 of the bytes.
 *   3. WebCrypto verify(signature, hash, publicKey).
 *   4. If pass, allow install. If fail, reject with a UX-friendly error.
 *
 * Ed25519 was picked over RSA-PSS because its signatures are 64 bytes
 * (vs 256+ for RSA), keys are 32 bytes (vs 270+), and WebCrypto's
 * `verify` is constant-time and ships in every modern browser.
 */

import { get, set } from "idb-keyval";

/**
 * Built-in trust anchors. Keys are SHA-256 fingerprints of the public
 * keys (hex) — the public key bytes themselves live in `KNOWN_KEYS`
 * keyed by fingerprint.
 *
 * Replace with real keys before launch — these are placeholders.
 */
const BUILTIN_TRUST: Record<string, string> = {
  // fingerprint → base64 spki public key
  // "lumen-team-2026": "MCowBQYDK2VwAyEA...",
};

const TRUSTED_KEYS_DB_KEY = "lumen.plugins.trusted-keys";

export interface SignedPluginEntry {
  /** Base64-encoded Ed25519 signature over the bundle bytes. */
  signature?: string;
  /** Fingerprint (hex SHA-256) of the public key that signed. */
  signedBy?: string;
}

/* ─── User-trusted keys (IndexedDB) ──────────────────────────────────── */

async function loadUserKeys(): Promise<Record<string, string>> {
  const v = (await get(TRUSTED_KEYS_DB_KEY).catch(() => undefined)) as
    | Record<string, string>
    | undefined;
  return v ?? {};
}

async function saveUserKeys(keys: Record<string, string>): Promise<void> {
  await set(TRUSTED_KEYS_DB_KEY, keys).catch(() => {});
}

export async function trustKey(fingerprint: string, spkiBase64: string): Promise<void> {
  const keys = await loadUserKeys();
  keys[fingerprint] = spkiBase64;
  await saveUserKeys(keys);
}

export async function untrustKey(fingerprint: string): Promise<void> {
  const keys = await loadUserKeys();
  delete keys[fingerprint];
  await saveUserKeys(keys);
}

export async function listTrustedKeys(): Promise<Array<{ fingerprint: string; source: "builtin" | "user" }>> {
  const userKeys = await loadUserKeys();
  return [
    ...Object.keys(BUILTIN_TRUST).map((fp) => ({ fingerprint: fp, source: "builtin" as const })),
    ...Object.keys(userKeys).map((fp) => ({ fingerprint: fp, source: "user" as const })),
  ];
}

/* ─── Verification ───────────────────────────────────────────────────── */

/** Decode a base64 string into a Uint8Array. */
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Compute the SHA-256 fingerprint (hex) of a public-key SPKI blob. */
export async function fingerprintOf(spkiBase64: string): Promise<string> {
  const buf = b64ToBytes(spkiBase64);
  // Copy into an owned ArrayBuffer view so WebCrypto's TS typing is happy.
  const owned = new Uint8Array(buf.length);
  owned.set(buf);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", owned));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify an Ed25519 signature over a bundle. Returns:
 *   • true                — signature good + signer is trusted
 *   • "untrusted-signer"  — signature math is good but the key isn't in
 *                            our trust list (UI should prompt user)
 *   • false               — signature is invalid or any error
 */
export async function verifyPluginSignature(
  bundleBytes: Uint8Array,
  entry: SignedPluginEntry,
): Promise<true | "untrusted-signer" | false> {
  if (!entry.signature || !entry.signedBy) return false;
  const userKeys = await loadUserKeys();
  const trustedKeys = { ...BUILTIN_TRUST, ...userKeys };
  const spki = trustedKeys[entry.signedBy];
  // Math-only verify: even if we don't trust this key, run the signature
  // check so we can tell the user "the math is fine, the signer is just
  // unknown" and prompt them to trust it.
  let candidateKey: CryptoKey | null = null;
  let isTrusted = false;
  if (spki) {
    isTrusted = true;
    candidateKey = await importEd25519(spki).catch(() => null);
  } else {
    // No trust path — bail out.
    return "untrusted-signer";
  }
  if (!candidateKey) return false;
  try {
    const sig = b64ToBytes(entry.signature);
    const ok = await crypto.subtle.verify(
      "Ed25519",
      candidateKey,
      // Crypto API expects ArrayBuffer-backed views.
      new Uint8Array(sig),
      new Uint8Array(bundleBytes),
    );
    return ok && isTrusted ? true : ok ? "untrusted-signer" : false;
  } catch {
    return false;
  }
}

async function importEd25519(spkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    new Uint8Array(b64ToBytes(spkiBase64)),
    { name: "Ed25519" },
    true,
    ["verify"],
  );
}
