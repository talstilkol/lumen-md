/**
 * The recovery key (plan W11.S8, research R3.9): 256 random bits, made once
 * when recovery is set up and shown to the user (W11.S9: as 24 BIP-39
 * words). With it alone, a forgotten passphrase no longer loses the vault.
 *
 * Two keys derive from it (HKDF-SHA256, salt = the vault id, info =
 * "lumen-e2ee/1/<purpose>", like every other key: keys.ts):
 *
 *   recovery-x25519  an age X25519 identity. Its public recipient is in the
 *                    keyring; every epoch secret is wrapped to it (an age
 *                    file), so a re-key or a revocation, made on a device
 *                    that never holds the recovery key, wraps the new
 *                    secret for it again. A revoked device learns nothing
 *                    from the recipient: it is a public key.
 *   recovery-mac     an HMAC key, kept in the keyring's sealed part. Each
 *                    keyring's recovery wrap carries `check`, an HMAC under
 *                    it, so the storage — which sees the recipient, a public
 *                    key — can't make a keyring with a secret of its own
 *                    that the recovery key would accept.
 *
 * The recovery key itself is never stored or sent: not in the vault, not at
 * the provider, not in this device's state. The keyring holds the
 * recipient (public), the age wrap (ciphertext) and, sealed, the MAC key.
 */
import { bs, toB64u, utf8 } from "./bytes";
import { identityFromRaw, type AgeIdentity } from "./age";

/** 256 bits. */
export const RECOVERY_KEY_BYTES = 32;

export class RecoveryKeyError extends Error {
  constructor(message = "This is not a recovery key for this vault") {
    super(message);
    this.name = "RecoveryKeyError";
  }
}

/** A fresh recovery key: 32 random bytes from the system's CSPRNG. */
export function newRecoveryKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(RECOVERY_KEY_BYTES));
}

async function derive(key: Uint8Array, vaultId: string, purpose: string): Promise<Uint8Array<ArrayBuffer>> {
  if (key.length !== RECOVERY_KEY_BYTES) throw new RecoveryKeyError(`A recovery key has ${RECOVERY_KEY_BYTES} bytes`);
  const base = await crypto.subtle.importKey("raw", bs(key), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: bs(utf8(vaultId)), info: bs(utf8(`lumen-e2ee/1/${purpose}`)) }, base, 256));
}

export interface RecoveryKeys {
  /** The age identity the epoch secret is wrapped to. */
  age: AgeIdentity;
  /** The HMAC key of the keyring's recovery `check` (b64u, as the sealed part keeps it). */
  mac: string;
}

/**
 * The keys a recovery key gives for one vault. `kind` "passkey" (plan
 * W11.S10): the same derivation from a passkey's 32-byte WebAuthn PRF
 * output, under its own labels ("passkey-x25519", "passkey-mac").
 */
export async function recoveryKeys(key: Uint8Array, vaultId: string, kind: "recovery" | "passkey" = "recovery"): Promise<RecoveryKeys> {
  const [x, m] = await Promise.all([derive(key, vaultId, `${kind}-x25519`), derive(key, vaultId, `${kind}-mac`)]);
  return { age: await identityFromRaw(x), mac: toB64u(m) };
}
