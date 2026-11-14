/**
 * Signing the static plugin registry (plan W10.B3, audit W4.32 / 11.2).
 *
 * The owner signs the exact bytes of public/plugins/examples/index.json with
 * an Ed25519 key that never leaves the owner's machine; the signature goes in
 * index.json.sig next to it. index.json lists every version's SHA-256 (code
 * and manifest), so one signature covers every byte a user can install.
 *
 * The app trusts a signer only through VITE_PLUGIN_TRUSTED_KEYS (or a key the
 * user trusted), never through the public key written in the .sig file: that
 * copy is there so `--check` and people can see which key signed.
 *
 * Node's crypto only; the browser side is src/plugins/signing.ts (WebCrypto).
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

/** SHA-256 (hex) of a public key's SPKI DER bytes: the `signedBy` fingerprint signing.ts expects. */
export function fingerprintOfSpki(spkiDer) {
  return createHash("sha256").update(spkiDer).digest("hex");
}

/** A new Ed25519 key pair for the owner: the private key as PKCS#8 PEM, the public key as SPKI base64. */
export function generateSigningKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spkiDer = publicKey.export({ type: "spki", format: "der" });
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    spkiBase64: Buffer.from(spkiDer).toString("base64"),
    fingerprint: fingerprintOfSpki(spkiDer),
  };
}

/** The VITE_PLUGIN_TRUSTED_KEYS value that pins this public key (JSON: fingerprint → SPKI base64). */
export function trustedKeysEnv(spkiBase64) {
  return JSON.stringify({ [fingerprintOfSpki(Buffer.from(spkiBase64, "base64"))]: spkiBase64 });
}

/** Sign registry bytes with a PKCS#8 PEM Ed25519 private key. Returns the index.json.sig object. */
export function signRegistryBytes(bytes, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`the signing key is ${key.asymmetricKeyType}, not Ed25519`);
  const spkiDer = createPublicKey(key).export({ type: "spki", format: "der" });
  return {
    alg: "Ed25519",
    signedBy: fingerprintOfSpki(spkiDer),
    signature: sign(null, Buffer.from(bytes), key).toString("base64"),
    publicKey: Buffer.from(spkiDer).toString("base64"),
  };
}

/**
 * Check a signature over registry bytes against one public key (SPKI base64).
 * Returns "ok", "wrong-key" (signedBy is another key) or "bad-signature".
 */
export function verifyRegistryBytes(bytes, sig, spkiBase64) {
  const spkiDer = Buffer.from(spkiBase64, "base64");
  if (!sig || sig.alg !== "Ed25519" || sig.signedBy !== fingerprintOfSpki(spkiDer)) return "wrong-key";
  try {
    const key = createPublicKey({ key: spkiDer, format: "der", type: "spki" });
    return verify(null, Buffer.from(bytes), key, Buffer.from(String(sig.signature), "base64")) ? "ok" : "bad-signature";
  } catch {
    return "bad-signature";
  }
}
