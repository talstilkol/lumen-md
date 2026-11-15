/**
 * Plan W11.S10 (research R3.9): unlock the vault with a passkey through the
 * WebAuthn PRF extension, offered only where the browser reports PRF, with
 * the wrap inside W11.S8's keyring.
 *
 * The authenticator is SIMULATED (the acceptance asks for that; real Chrome
 * and Safari devices are W11.M11). It behaves as WebAuthn L3 and CTAP2's
 * hmac-secret say: the browser hashes the page's salt as
 * SHA-256("WebAuthn PRF" ‖ 0x00 ‖ salt), and the authenticator answers
 * HMAC-SHA-256(its per-credential secret, that hash). Everything after the
 * WebAuthn call is the real engine and real WebCrypto.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { memoryProvider } from "../sync/e2ee/provider";
import { addPasskey, E2eeSync, removePasskey, setUpRecovery, unlockWithPasskey, unlockWithRecoveryKey } from "../sync/e2ee/engine";
import { KEYRING_NAME, readKeyring, TamperedWrapError } from "../sync/e2ee/keyring";
import { RecoveryKeyError } from "../sync/e2ee/recovery";
import { createPasskey, passkeyPrf, passkeySalt, PasskeyUnsupportedError, prfSupported, type WebAuthnApi } from "../sync/e2ee/passkey";
import { bs, toB64u, utf8 } from "../sync/e2ee/bytes";
import { memoryFiles } from "../sync/e2ee/localFiles";
import { memoryStateStore } from "../sync/e2ee/state";
import { newVault, snapshot } from "./helpers/e2ee";

/** A simulated platform authenticator with the PRF extension. */
function authenticator(opts: { capabilities?: Record<string, boolean> | "missing" | "throws"; prfAtCreate?: boolean; prf?: boolean } = {}) {
  const creds = new Map<string, Uint8Array>();
  const prfFor = async (secret: Uint8Array, salt: BufferSource) => {
    const s = new Uint8Array(salt instanceof ArrayBuffer ? salt : salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength));
    const hashed = new Uint8Array(await crypto.subtle.digest("SHA-256", bs(new Uint8Array([...utf8("WebAuthn PRF"), 0, ...s]))));
    const k = await crypto.subtle.importKey("raw", bs(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", k, bs(hashed))).buffer;
  };
  const credential = (rawId: Uint8Array, prf: Record<string, unknown>) => ({ id: toB64u(rawId), rawId: rawId.buffer, type: "public-key", getClientExtensionResults: () => ({ prf }) }) as unknown as Credential;
  const calls = { create: 0, get: 0 };
  const api: WebAuthnApi = {
    getClientCapabilities:
      opts.capabilities === "missing"
        ? undefined
        : async () => {
            if (opts.capabilities === "throws") throw new Error("not allowed");
            return (opts.capabilities as Record<string, boolean>) ?? { "extension:prf": true, passkeyPlatformAuthenticator: true };
          },
    async create(o) {
      calls.create++;
      const rawId = crypto.getRandomValues(new Uint8Array(32));
      const secret = crypto.getRandomValues(new Uint8Array(32));
      creds.set(toB64u(rawId), secret);
      const ext = (o.publicKey!.extensions as { prf?: { eval?: { first: BufferSource } } }).prf;
      if (opts.prf === false) return credential(rawId, { enabled: false });
      return credential(rawId, opts.prfAtCreate && ext?.eval ? { enabled: true, results: { first: await prfFor(secret, ext.eval.first) } } : { enabled: true });
    },
    async get(o) {
      calls.get++;
      const allow = o.publicKey!.allowCredentials;
      const id = allow?.length ? toB64u(new Uint8Array(allow[0].id as ArrayBuffer)) : [...creds.keys()][0]; // discoverable: the user picks the first
      const secret = creds.get(id);
      if (!secret) throw new DOMException("no such credential", "NotAllowedError");
      const ext = (o.publicKey!.extensions as { prf: { eval: { first: BufferSource } } }).prf;
      return credential(new Uint8Array(Buffer.from(id, "base64url")), { results: { first: await prfFor(secret, ext.eval.first) } });
    },
  };
  return { api, creds, calls };
}

async function vaultWithPasskey() {
  const p = memoryProvider();
  const a = await newVault(p);
  a.files.set("a.md", "# שלום\nפתק");
  a.files.set("notes/b.md", "ASCII");
  await a.sync.sync();
  const auth = authenticator();
  const pk = await createPasskey(a.sync.keys().vaultId, { api: auth.api });
  await addPasskey(a.sync, pk.id, pk.prf);
  await a.sync.sync();
  return { p, a, auth, pk };
}

/** A clean profile with only the provider and the passkey. */
async function openWithPasskey(p: ReturnType<typeof memoryProvider>, api: WebAuthnApi) {
  const ring = (await readKeyring(p))!;
  const { id, prf } = await passkeyPrf(ring.file.vaultId, { api });
  const { keys } = await unlockWithPasskey(p, id, prf);
  const files = memoryFiles();
  await new E2eeSync({ provider: p, keys, local: files, store: memoryStateStore(), access: { passkey: { id, prf } } }).sync();
  return { keys, files };
}

describe("offered only where the browser reports PRF", () => {
  it("getClientCapabilities must say extension:prf is true; missing, false or throwing means no", async () => {
    expect(await prfSupported(authenticator().api)).toBe(true);
    expect(await prfSupported(authenticator({ capabilities: { "extension:prf": false } }).api)).toBe(false);
    expect(await prfSupported(authenticator({ capabilities: { passkeyPlatformAuthenticator: true } }).api)).toBe(false);
    expect(await prfSupported(authenticator({ capabilities: "missing" }).api)).toBe(false);
    expect(await prfSupported(authenticator({ capabilities: "throws" }).api)).toBe(false);
    expect(await prfSupported(null)).toBe(false);
  });

  it("creating a passkey without PRF support is refused before any WebAuthn ceremony", async () => {
    const off = authenticator({ capabilities: { "extension:prf": false } });
    await expect(createPasskey("v", { api: off.api })).rejects.toBeInstanceOf(PasskeyUnsupportedError);
    expect(off.calls).toEqual({ create: 0, get: 0 });
    await expect(createPasskey("v", { api: authenticator({ prf: false }).api })).rejects.toThrow(/doesn't support the PRF/);
  });
});

describe("the PRF output", () => {
  it("comes at creation when the authenticator gives it, or from one assertion right after; the same either way", async () => {
    const at = authenticator({ prfAtCreate: true });
    const a = await createPasskey("vault-1", { api: at.api });
    expect(at.calls).toEqual({ create: 1, get: 0 });
    expect((await passkeyPrf("vault-1", { api: at.api, id: a.id })).prf).toEqual(a.prf);
    const after = authenticator();
    await createPasskey("vault-1", { api: after.api });
    expect(after.calls).toEqual({ create: 1, get: 1 });
  });

  it("is per vault (the salt names the vault) and per passkey", async () => {
    const auth = authenticator({ prfAtCreate: true });
    const a = await createPasskey("vault-1", { api: auth.api });
    expect((await passkeyPrf("vault-2", { api: auth.api, id: a.id })).prf).not.toEqual(a.prf);
    const b = await createPasskey("vault-1", { api: auth.api });
    expect(b.prf).not.toEqual(a.prf);
    expect(await passkeySalt("vault-1")).not.toEqual(await passkeySalt("vault-2"));
  });
});

describe("unlocking, revoking and restoring", () => {
  it("unlock: a clean profile opens the vault with the passkey alone and gets every note", async () => {
    const { p, a, auth } = await vaultWithPasskey();
    expect(a.sync.keys().ring?.passkeys).toHaveLength(1);
    const r = await openWithPasskey(p, auth.api);
    expect(r.keys.epoch).toBe(a.sync.keys().epoch);
    expect(snapshot({ files: r.files } as never)).toEqual(snapshot(a));
  });

  it("a rotation keeps the passkey: it opens the new epoch", async () => {
    const { p, a, auth } = await vaultWithPasskey();
    await a.sync.rekey();
    expect((await openWithPasskey(p, auth.api)).keys.epoch).toBe(2);
  });

  it("revoke: once removed, the passkey opens no later epoch; the recovery key still restores", async () => {
    const { p, a, auth, pk } = await vaultWithPasskey();
    const { key } = await setUpRecovery(a.sync);
    await removePasskey(a.sync, pk.id);
    expect(a.sync.keys().ring?.passkeys).toBeUndefined();
    expect((await readKeyring(p))!.file.passkeys).toBeUndefined();
    const { prf } = await passkeyPrf(a.sync.keys().vaultId, { api: auth.api, id: pk.id });
    await expect(unlockWithPasskey(p, pk.id, prf)).rejects.toBeInstanceOf(RecoveryKeyError);
    // Restore: the recovery key opens the vault, and a passkey can be added again.
    const { keys } = await unlockWithRecoveryKey(p, key);
    expect(keys.epoch).toBe(a.sync.keys().epoch);
    const again = await createPasskey(a.sync.keys().vaultId, { api: auth.api });
    await addPasskey(a.sync, again.id, again.prf);
    expect((await unlockWithPasskey(p, again.id, again.prf)).keys.epoch).toBe(a.sync.keys().epoch);
  });

  it("a passkey the vault doesn't list, or a wrap moved from one passkey to another, is refused", async () => {
    const { p, a, auth, pk } = await vaultWithPasskey();
    const other = await createPasskey(a.sync.keys().vaultId, { api: auth.api });
    await expect(unlockWithPasskey(p, other.id, other.prf)).rejects.toBeInstanceOf(RecoveryKeyError);
    await addPasskey(a.sync, other.id, other.prf);
    const f = (await readKeyring(p))!.file;
    // The storage swaps the two entries' ids: each check names its own passkey.
    const swapped = { ...f, passkeys: { [pk.id]: f.passkeys![other.id], [other.id]: f.passkeys![pk.id] } };
    p.objects.set(KEYRING_NAME, { data: utf8(JSON.stringify(swapped)), etag: "swapped" });
    await expect(unlockWithPasskey(p, pk.id, pk.prf)).rejects.toBeInstanceOf(RecoveryKeyError);
    // The same recipient with another passkey's check (the storage's own wrap) fails the check.
    const forged = { ...f, passkeys: { ...f.passkeys!, [pk.id]: { ...f.passkeys![pk.id], check: f.passkeys![other.id].check } } };
    p.objects.set(KEYRING_NAME, { data: utf8(JSON.stringify(forged)), etag: "forged" });
    await expect(unlockWithPasskey(p, pk.id, pk.prf)).rejects.toBeInstanceOf(TamperedWrapError);
  });

  it("the PRF output and the passkey's derived keys are never in sync storage", async () => {
    const { p, pk } = await vaultWithPasskey();
    const needles = [Buffer.from(pk.prf).toString("hex"), Buffer.from(pk.prf).toString("base64").replace(/=+$/, ""), toB64u(pk.prf)];
    for (const [name, o] of p.objects) {
      const text = Buffer.from(o.data).toString("latin1");
      for (const n of needles) expect(text.includes(n), name).toBe(false);
      expect(Buffer.from(o.data).indexOf(Buffer.from(pk.prf)), name).toBe(-1);
    }
  });
});
