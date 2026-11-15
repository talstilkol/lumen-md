/**
 * Shared set-up for the blind encrypted-sync suites (plan W6.15, W10.D18).
 *
 * Written from docs/sync-protocol.md, docs/src/content/docs/sync/e2ee.md,
 * docs/src/content/docs/sync/e2ee-keys.md and the declarations tsc emits for
 * src/sync/e2ee (no function bodies were read). Every byte-level formula here
 * (HKDF, HMAC, names, digests) is computed independently from the spec, with
 * WebCrypto only, so a test compares the implementation against the spec and
 * not against itself.
 */
import {
  createVault,
  E2eeSync,
  memoryFiles,
  memoryProvider,
  memoryStateStore,
  unlockVault,
  type SyncProvider,
  type StoredObject,
  type PutCondition,
} from "../../sync/e2ee";
import type { MemoryFiles } from "../../sync/e2ee/localFiles";
import type { MemoryProvider } from "../../sync/e2ee/provider";
import type { KeyAccess } from "../../sync/e2ee/keyring";
import type { VaultKeys } from "../../sync/e2ee/keys";
import type { ConflictResolver } from "../../sync/e2ee/conflict";

/** Cheap PBKDF2 for test vaults; the policy below lets them open. */
export const ITER = 1000;
export const POLICY = { minPbkdf2Iterations: ITER };
export const PASS = "correct horse battery staple 2026";

export const enc = new TextEncoder();
export const dec = new TextDecoder();

export function b64u(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i);
  return out;
}
export async function sha256hex(b: Uint8Array | string): Promise<string> {
  const bytes = typeof b === "string" ? enc.encode(b) : b;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}
/** Spec notation: HKDF(ikm, salt, info), HKDF-SHA256 with a 32-byte output. */
export async function hkdf(ikm: Uint8Array, salt: string, info: string): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey("raw", ikm as Uint8Array<ArrayBuffer>, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: enc.encode(salt), info: enc.encode(info) }, k, 256);
  return new Uint8Array(bits);
}
export async function hmacRaw(key: Uint8Array, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey("raw", key as Uint8Array<ArrayBuffer>, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as Uint8Array<ArrayBuffer>));
}

/**
 * A provider whose backing store can be swapped: the storage showing one
 * device one view and another device another (spec §9), or replaying an old
 * copy. `view` is the MemoryProvider currently served.
 */
export interface SwitchProvider extends SyncProvider {
  view: MemoryProvider;
}
export function switchable(start: MemoryProvider = memoryProvider()): SwitchProvider {
  const sp: SwitchProvider = {
    id: "memory",
    view: start,
    get: (n) => sp.view.get(n),
    put: (n, d, c) => sp.view.put(n, d, c),
    delete: (n) => sp.view.delete(n),
    list: () => sp.view.list(),
  };
  return sp;
}

/** A copy of every object a provider holds (what a storage could keep and serve later). */
export function snapshot(p: MemoryProvider): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  for (const [k, v] of p.objects) m.set(k, new Uint8Array(v.data));
  return m;
}
/** A fresh in-memory provider holding exactly `objects`. */
export async function providerFrom(objects: Map<string, Uint8Array>): Promise<MemoryProvider> {
  const p = memoryProvider();
  for (const [k, v] of objects) await p.put(k, new Uint8Array(v));
  return p;
}
/** Write `data` under `name` unconditionally, as the storage itself can. */
export async function forcePut(p: SyncProvider, name: string, data: Uint8Array): Promise<void> {
  await p.put(name, data);
}

/** Wraps a provider so that its conditional writes are ignored (a misconfigured WebDAV server). */
export function ignoresConditions(inner: SyncProvider): SyncProvider {
  return {
    id: "no-cas",
    get: (n) => inner.get(n),
    put: (n, d, _c?: PutCondition) => inner.put(n, d),
    delete: (n) => inner.delete(n),
    list: () => inner.list(),
  };
}

export interface Device {
  engine: E2eeSync;
  files: MemoryFiles;
  store: ReturnType<typeof memoryStateStore>;
  clock: { t: number };
}

export function deviceOn(
  provider: SyncProvider,
  keys: VaultKeys,
  opts: { resolver?: ConflictResolver; access?: KeyAccess; store?: ReturnType<typeof memoryStateStore>; files?: MemoryFiles; clock?: { t: number } } = {},
): Device {
  const files = opts.files ?? memoryFiles();
  const store = opts.store ?? memoryStateStore();
  const clock = opts.clock ?? { t: Date.UTC(2026, 10, 15, 12, 0, 0) };
  const engine = new E2eeSync({
    provider,
    keys,
    local: files,
    store,
    resolver: opts.resolver,
    access: opts.access,
    now: () => clock.t,
  });
  return { engine, files, store, clock };
}

/** A new vault and the device that created it (verified: "created"). */
export async function newVault<P extends SyncProvider = MemoryProvider>(provider: P = memoryProvider() as unknown as P, passphrase = PASS) {
  const { header, keys, anchor } = await createVault(provider, passphrase, { pbkdf2Iterations: ITER });
  const creator = deviceOn(provider, keys);
  await creator.engine.markCreated(anchor);
  return { provider, header, keys, creator };
}

/** A second device opened with the passphrase (unverified until confirmed or paired). */
export async function passphraseDevice(provider: SyncProvider, opts: { confirm?: boolean; resolver?: ConflictResolver; passphrase?: string } = {}): Promise<Device> {
  const { keys } = await unlockVault(provider, opts.passphrase ?? PASS, POLICY);
  const d = deviceOn(provider, keys, { resolver: opts.resolver });
  if (opts.confirm) {
    await d.engine.sync();
    await d.engine.confirmFreshness();
  }
  return d;
}

export async function getObj(p: SyncProvider, name: string): Promise<StoredObject> {
  const o = await p.get(name);
  if (!o) throw new Error(`no object ${name}`);
  return o;
}

/** The object names a provider holds that are neither the header nor the keyring. */
export async function opaqueNames(p: SyncProvider): Promise<string[]> {
  return (await p.list()).filter((n) => n !== "lumen-e2ee-vault" && n !== "lumen-e2ee-keyring");
}

/** Does `needle` (UTF-8) occur in `hay`? */
export function contains(hay: Uint8Array, needle: string): boolean {
  const n = enc.encode(needle);
  outer: for (let i = 0; i + n.length <= hay.length; i++) {
    for (let j = 0; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

/** Run `f`, return what it threw (or null). */
export async function caught(f: () => Promise<unknown>): Promise<unknown> {
  try {
    await f();
    return null;
  } catch (e) {
    return e;
  }
}
