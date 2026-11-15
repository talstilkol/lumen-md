/**
 * Passkey unlock through the WebAuthn PRF extension (plan W11.S10, research
 * R3.9), after typage's design (FiloSottile/typage, "age with passkeys"):
 * the passkey evaluates a pseudo-random function on a fixed, per-vault salt,
 * and its 32-byte output stands in for the recovery key (recovery.ts, the
 * "passkey" labels). Nothing about the passkey is a password: the output
 * exists only inside a ceremony the user confirmed with the authenticator,
 * and it never leaves this device.
 *
 * Only offered where the browser says it supports PRF:
 * `PublicKeyCredential.getClientCapabilities()` reports "extension:prf".
 * Where it doesn't (or the call is missing), the option isn't shown at all.
 *
 * The salt the page passes is not what the authenticator sees: the browser
 * hashes it first (WebAuthn L3 §10.1.4: SHA-256("WebAuthn PRF" ‖ 0x00 ‖ salt)),
 * so a site can't ask a passkey for another site's output.
 */
import { bs, fromB64u, toB64u, utf8 } from "./bytes";

/** The salt for a vault: SHA-256 of a label and the vault id. Public; the passkey's secret is what makes the output. */
export async function passkeySalt(vaultId: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bs(utf8(`lumen-e2ee/1/passkey-prf-salt/${vaultId}`))));
}

export class PasskeyUnsupportedError extends Error {
  constructor(message = "This browser or passkey doesn't support the PRF extension") {
    super(message);
    this.name = "PasskeyUnsupportedError";
  }
}

/** The parts of the WebAuthn API this module uses (the real one in a browser; a simulated authenticator in tests). */
export interface WebAuthnApi {
  getClientCapabilities?: () => Promise<Record<string, boolean>>;
  create(options: CredentialCreationOptions): Promise<Credential | null>;
  get(options: CredentialRequestOptions): Promise<Credential | null>;
}

/** The browser's own WebAuthn, when there is one. */
export function browserWebAuthn(): WebAuthnApi | null {
  if (typeof window === "undefined" || typeof PublicKeyCredential === "undefined" || !navigator.credentials) return null;
  const pkc = PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> };
  return {
    getClientCapabilities: pkc.getClientCapabilities ? () => pkc.getClientCapabilities!() : undefined,
    create: (o) => navigator.credentials.create(o),
    get: (o) => navigator.credentials.get(o),
  };
}

/** True only when the browser reports PRF support. Anything else, including an error, is false. */
export async function prfSupported(api: WebAuthnApi | null = browserWebAuthn()): Promise<boolean> {
  if (!api?.getClientCapabilities) return false;
  try {
    return (await api.getClientCapabilities())["extension:prf"] === true;
  } catch {
    return false;
  }
}

type PrfResults = { enabled?: boolean; results?: { first?: BufferSource } };
const prfOf = (c: Credential | null): PrfResults | undefined => (c as PublicKeyCredential | null)?.getClientExtensionResults?.().prf as PrfResults | undefined;
const bytesOf = (b: BufferSource) => new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

/**
 * Make a passkey for this vault and get its PRF output. Some authenticators
 * return the output at creation; the others get one assertion right after,
 * as typage does. Returns the credential id (b64u) and the 32-byte output.
 */
export async function createPasskey(vaultId: string, opts: { api?: WebAuthnApi | null; rpName?: string; userName?: string } = {}): Promise<{ id: string; prf: Uint8Array<ArrayBuffer> }> {
  const api = opts.api === undefined ? browserWebAuthn() : opts.api;
  if (!api || !(await prfSupported(api))) throw new PasskeyUnsupportedError();
  const salt = await passkeySalt(vaultId);
  const cred = await api.create({
    publicKey: {
      rp: { name: opts.rpName ?? "Lumen" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: opts.userName ?? "Lumen vault", displayName: opts.userName ?? "Lumen vault" },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  });
  if (!cred) throw new PasskeyUnsupportedError("No passkey was made");
  const id = toB64u(new Uint8Array((cred as PublicKeyCredential).rawId));
  const made = prfOf(cred);
  if (made?.enabled === false) throw new PasskeyUnsupportedError("This passkey doesn't support the PRF extension");
  const first = made?.results?.first;
  if (first) return { id, prf: bytesOf(first) };
  return { id, prf: (await passkeyPrf(vaultId, { api, id })).prf };
}

/**
 * The PRF output of a passkey for this vault. With `id`, only that passkey
 * is asked; without, the user picks any passkey (a discoverable credential,
 * for a clean profile). Returns which passkey answered and its output.
 */
export async function passkeyPrf(vaultId: string, opts: { api?: WebAuthnApi | null; id?: string } = {}): Promise<{ id: string; prf: Uint8Array<ArrayBuffer> }> {
  const api = opts.api === undefined ? browserWebAuthn() : opts.api;
  if (!api || !(await prfSupported(api))) throw new PasskeyUnsupportedError();
  const cred = await api.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      userVerification: "required",
      ...(opts.id ? { allowCredentials: [{ type: "public-key", id: fromB64u(opts.id) }] } : {}),
      extensions: { prf: { eval: { first: await passkeySalt(vaultId) } } } as AuthenticationExtensionsClientInputs,
    },
  });
  const first = prfOf(cred)?.results?.first;
  if (!cred || !first) throw new PasskeyUnsupportedError("The passkey gave no PRF output");
  const out = bytesOf(first);
  if (out.length !== 32) throw new PasskeyUnsupportedError("The passkey's PRF output is not 32 bytes");
  return { id: toB64u(new Uint8Array((cred as PublicKeyCredential).rawId)), prf: out };
}
