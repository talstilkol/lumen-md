/**
 * The encrypted sync engine (plan 3.4).
 *
 * One round, `E2eeSync.sync()`:
 *
 *   1. Read the manifest and its etag; decrypt and authenticate it; refuse it
 *      if it is older than the newest one this device has verified
 *      (`checkFreshness` — rollback / replay protection).
 *   2. Pull: for every path the manifest changed since this device's base,
 *      apply the change locally, or settle a conflict (conflict.ts).
 *   3. Push: upload every local change as a new immutable blob (a fresh
 *      opaque name per version, so concurrent devices never overwrite each
 *      other's blobs), then write the new manifest — counter + 1 — with
 *      compare-and-swap on the etag read in step 1.
 *   4. If the manifest changed in between (`PreconditionFailedError`), go back
 *      to 1 with the newer manifest: pull, merge, retry. Two devices pushing
 *      from the same version N both end up in the manifest.
 *
 * Plan W1.8: every step is reported through `onEvent` (activity panel, time
 * estimate), the paths held and why are kept for `fileStates()`, and paths
 * this device's rules exclude (`exclude`) are skipped in both directions:
 * an excluded local file is never read for upload.
 *
 * Keys (plan W1.7): at the start of a round the device brings its keys up to
 * the keyring (./keyring.ts): a newer epoch is unwrapped, an older one is a
 * rollback and refused, a missing wrap means this device was revoked.
 * `rekey()` starts a new epoch and re-seals the manifest under it; blobs
 * keep the epoch they were written in (`e` in their manifest entry).
 *
 * Interruption at any point loses nothing: blobs are written before the
 * manifest that references them, the base is saved per file after the local
 * write, and the next round recognises work that was already done (same hash
 * on both sides). Blobs uploaded by an interrupted round are recorded as
 * pending and deleted once they are known to be unreferenced; blobs replaced
 * by a commit are deleted after it.
 */

import { randomBytes, sha256Hex, toB64u } from "./bytes";
import { conflictCopyPath, keepBothResolver, type ConflictResolver } from "./conflict";
import { createHeader, decodeHeader, encodeHeader, HEADER_NAME, rekeyHeader, unlockHeader, type VaultHeader } from "./header";
import { PBKDF2_MIN_ITERATIONS, type KdfPolicy } from "./kdf";
import { blobKey, DecryptError, seal, unseal, type VaultKeys } from "./keys";
import { KEYRING_NAME, keysFromKeyring, readKeyring, refreshKeys, unwrapSecret, writeNewEpoch, type KeyAccess } from "./keyring";
import { isSyncedPath, type LocalFile, type LocalFiles } from "./localFiles";
import {
  blobName,
  checkFreshness,
  emptyManifest,
  HISTORY_LENGTH,
  manifestName,
  pathRecord,
  openManifest,
  RollbackError,
  sealManifest,
  type FreshnessAnchor,
  type Manifest,
  type ManifestEntry,
} from "./manifest";
import { readPairingCode, createPairingCode, PairingError } from "./pairing";
import { PreconditionFailedError, type SyncProvider } from "./provider";
import type { DeviceState, FreshnessSource, SyncStateStore } from "./state";
import type { SyncEvent, SyncEventListener } from "./activity";
import { computeFileStates, liveHash, sameEntry, type ExcludeRule, type FileStatus, type HoldReason } from "./status";

export class VaultExistsError extends Error {
  constructor() {
    super("An encrypted vault already exists at this provider");
    this.name = "VaultExistsError";
  }
}

export class NoVaultError extends Error {
  constructor() {
    super("No encrypted vault at this provider");
    this.name = "NoVaultError";
  }
}

/** A blob the manifest names is missing (replaced by a newer commit meanwhile): the round restarts. */
class BlobMissingError extends Error {}

/** Files above this size keep no ancestor bytes for merges (attachments; plan W1.8). */
export const BASE_BYTES_LIMIT = 4 * 1024 * 1024;

/**
 * Create a vault at `provider`: the header (create-only) and the first,
 * empty manifest (counter 1). Returns the keys and the creator's anchor.
 *
 * Creation can be retried after an interruption: when a header is already
 * there that this passphrase unlocks and the vault is still empty (no
 * manifest, or only the empty first one), creation resumes on it.
 * Otherwise — someone else's vault, or one with data — `VaultExistsError`.
 */
export async function createVault(
  provider: SyncProvider,
  passphrase: string,
  opts: { pbkdf2Iterations?: number } = {},
): Promise<{ header: VaultHeader; keys: VaultKeys; anchor: FreshnessAnchor }> {
  let { header, keys } = await createHeader(passphrase, opts);
  try {
    await provider.put(HEADER_NAME, encodeHeader(header), { ifNoneMatch: "*" });
  } catch (e) {
    if (!(e instanceof PreconditionFailedError)) throw e;
    // The floor never drops below production unless the caller asked for fewer iterations itself.
    const floor = Math.min(PBKDF2_MIN_ITERATIONS, opts.pbkdf2Iterations ?? PBKDF2_MIN_ITERATIONS);
    try {
      ({ header, keys } = await unlockVault(provider, passphrase, { minPbkdf2Iterations: floor }));
    } catch {
      throw new VaultExistsError();
    }
  }
  const name = await manifestName(keys);
  const existing = await provider.get(name);
  if (existing) {
    const { manifest, digest } = await openManifest(keys, existing.data, name);
    if (manifest.counter === 1 && Object.keys(manifest.files).length === 0) {
      return { header, keys, anchor: { counter: 1, digest } };
    }
    throw new VaultExistsError();
  }
  const first: Manifest = { ...emptyManifest(keys.vaultId), counter: 1 };
  const sealed = await sealManifest(keys, first, name);
  try {
    await provider.put(name, sealed.bytes, { ifNoneMatch: "*" });
  } catch (e) {
    if (e instanceof PreconditionFailedError) throw new VaultExistsError();
    throw e;
  }
  return { header, keys, anchor: { counter: 1, digest: sealed.digest } };
}

/** Read the header at `provider` and derive the keys; `WrongPassphraseError` on a wrong passphrase. */
export async function unlockVault(
  provider: SyncProvider,
  passphrase: string,
  policy: KdfPolicy = {},
): Promise<{ header: VaultHeader; keys: VaultKeys }> {
  const obj = await provider.get(HEADER_NAME);
  if (!obj) throw new NoVaultError();
  const header = decodeHeader(obj.data, policy);
  const base = await unlockHeader(header, passphrase);
  // Plan W1.7: a vault with a keyring keeps its current keys there.
  const ring = await readKeyring(provider);
  if (!ring) return { header, keys: base };
  if (ring.file.vaultId !== base.vaultId) throw new DecryptError("The keyring belongs to another vault");
  return { header, keys: await keysFromKeyring(ring.file, await unwrapSecret(ring.file, { wrap: base.wrap! }), base) };
}

/**
 * Open the vault with this device's own key (an age identity enrolled in
 * the keyring), without the passphrase. `RevokedError` once it was revoked.
 */
export async function unlockWithDevice(provider: SyncProvider, device: string, identity: string): Promise<{ keys: VaultKeys }> {
  const ring = await readKeyring(provider);
  if (!ring) throw new NoVaultError();
  const secret = await unwrapSecret(ring.file, { device, identity });
  const placeholder = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"]);
  return { keys: await keysFromKeyring(ring.file, secret, { header: placeholder, wrap: null }) };
}

export interface RekeyResult {
  epoch: number;
  counter: number;
  /** Objects written: the keyring, the manifest, and the header when the passphrase changed. No blob. */
  written: string[];
}

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  deleted: number;
  /** Paths whose conflict was settled (by the resolver or automatically). */
  conflicts: string[];
  /** Paths held for a later round (a cancelled dialog, or a file edited mid-round). */
  held: string[];
  /** Manifest counter after the round. */
  counter: number;
  /** Manifest writes that lost a compare-and-swap and were retried. */
  retries: number;
  /** True when the round gave up after `maxAttempts` lost races; nothing is lost, run it again. */
  incomplete: boolean;
}

export interface E2eeSyncOptions {
  provider: SyncProvider;
  keys: VaultKeys;
  local: LocalFiles;
  store: SyncStateStore;
  resolver?: ConflictResolver;
  /** Manifest compare-and-swap attempts per round (default 8). */
  maxAttempts?: number;
  /** Clock, for conflict-copy names and pairing codes (tests). */
  now?: () => number;
  /** This device's selective-sync rule (plan W1.8): the reason a path is kept out, or null. Read every round. */
  exclude?: ExcludeRule;
  /** Each step of a round, as it happens (plan W1.8). A listener that throws is ignored. */
  onEvent?: SyncEventListener;
  /**
   * How this device opens newer keyrings (plan W1.7). Default: the
   * passphrase's wrap key when the keys have one. A device opened with its
   * own key passes `{device, identity}`.
   */
  access?: KeyAccess;
}

export class E2eeSync {
  private readonly o: Required<Omit<E2eeSyncOptions, "resolver" | "access">> & { resolver: ConflictResolver; access: KeyAccess | null };
  private running: Promise<unknown> = Promise.resolve();
  private state: DeviceState | null = null;
  /** Digest of the manifest `readManifest` returned last (the parent of the next commit). */
  private remoteDigest = "";
  /** Opaque names already computed (HMAC is cheap, but not free over thousands of rounds). */
  private readonly names = new Map<string, string>();
  /** What the last round saw, for `fileStates()` (plan W1.8). */
  private lastLocal: LocalFile[] | null = null;
  private lastRemote: Manifest | null = null;
  /** Paths the last round held, and why. */
  private holds = new Map<string, HoldReason>();

  constructor(opts: E2eeSyncOptions) {
    // `??`, not a spread: an option passed as undefined must still get its default.
    this.o = {
      ...opts,
      resolver: opts.resolver ?? keepBothResolver,
      maxAttempts: opts.maxAttempts ?? 8,
      now: opts.now ?? (() => Date.now()),
      exclude: opts.exclude ?? (() => null),
      onEvent: opts.onEvent ?? (() => undefined),
      access: opts.access ?? (opts.keys.wrap ? { wrap: opts.keys.wrap } : null),
    };
  }

  private emit(e: SyncEvent): void {
    try {
      this.o.onEvent(e);
    } catch {
      /* the activity panel must never break a round */
    }
  }

  private hold(held: Set<string>, path: string, reason: HoldReason): void {
    held.add(path);
    this.holds.set(path, reason);
    this.emit({ kind: "held", at: this.o.now(), path, reason });
  }

  /** The local files, for this round and for `fileStates()`. */
  private async listLocal(): Promise<LocalFile[]> {
    const list = (await this.o.local.list()).filter((f) => isSyncedPath(f.path));
    this.lastLocal = list;
    return list;
  }

  /**
   * The sync state of every file and folder as of the last round (plan
   * W1.8). `rescan` lists the local files again first, so edits made since
   * the round show as pending.
   */
  async fileStates(opts: { rescan?: boolean } = {}): Promise<Map<string, FileStatus>> {
    const s = await this.loadState();
    if (opts.rescan || !this.lastLocal) await this.listLocal();
    return computeFileStates({
      local: new Map((this.lastLocal ?? []).map((f) => [f.path, f])),
      base: s.base,
      remote: this.lastRemote?.files ?? null,
      holds: this.holds,
      exclude: this.o.exclude,
    });
  }

  /** The keys this device uses now (they change at a re-key). */
  keys(): VaultKeys {
    return this.o.keys;
  }

  /** Step 0: bring the keys up to the keyring. */
  private async refresh(): Promise<void> {
    if (!this.o.access) return;
    const s = await this.loadState();
    const next = await refreshKeys(this.o.provider, this.o.keys, this.o.access, Math.max(s.epoch ?? 0, this.o.keys.epoch));
    if (next !== this.o.keys) this.o.keys = next;
    if ((s.epoch ?? 0) < next.epoch) {
      s.epoch = next.epoch;
      await this.save();
    }
  }

  /**
   * Start a new key epoch (plan W1.7): re-key, revoke devices, enroll
   * devices, change the passphrase. Writes the keyring, re-seals the
   * manifest (counter + 1) and, for a new passphrase, the header. No blob is
   * downloaded or uploaded: older blobs keep their epoch's key.
   */
  rekey(opts: { revoke?: string[]; enroll?: Record<string, string>; newPassphrase?: string; pbkdf2Iterations?: number } = {}): Promise<RekeyResult> {
    return this.exclusive(async () => {
      const s = await this.loadState();
      await this.refresh();
      const written: string[] = [];
      let header: { header: VaultHeader; master: Uint8Array } | null = null;
      if (opts.newPassphrase !== undefined) header = await rekeyHeader(this.o.keys.vaultId, opts.newPassphrase, opts.pbkdf2Iterations !== undefined ? { pbkdf2Iterations: opts.pbkdf2Iterations } : {});
      let current = await this.readManifest();
      const previous = this.o.keys;
      const keys = await writeNewEpoch(this.o.provider, previous, { revoke: opts.revoke, enroll: opts.enroll, newPassphraseMaster: header?.master, now: this.o.now });
      written.push(KEYRING_NAME);
      if (header) {
        await this.o.provider.put(HEADER_NAME, encodeHeader(header.header));
        written.push(HEADER_NAME);
      }
      // Re-seal the manifest under the new epoch; a commit that raced in
      // under the old epoch is read with the previous key and carried over.
      for (let attempt = 0; ; attempt++) {
        const m = current.manifest;
        const next: Manifest = {
          ...m,
          counter: m.counter + 1,
          files: pathRecord(m.files),
          history: m.counter > 0 ? [...m.history, [m.counter, this.remoteDigest] as [number, string]].slice(-HISTORY_LENGTH) : [],
        };
        const name = await this.manifestObject();
        const sealed = await sealManifest(keys, next, name);
        try {
          await this.o.provider.put(name, sealed.bytes, current.etag ? { ifMatch: current.etag } : { ifNoneMatch: "*" });
        } catch (e) {
          if (!(e instanceof PreconditionFailedError) || attempt >= this.o.maxAttempts) throw e;
          current = await this.readManifest(previous.manifest);
          continue;
        }
        written.push(name);
        this.o.keys = keys;
        if (keys.wrap && (!this.o.access || "wrap" in this.o.access)) this.o.access = { wrap: keys.wrap };
        s.anchor = { counter: next.counter, digest: sealed.digest };
        s.epoch = keys.epoch;
        await this.save();
        return { epoch: keys.epoch, counter: next.counter, written };
      }
    });
  }

  private async loadState(): Promise<DeviceState> {
    if (this.state) return this.state;
    const loaded = await this.o.store.load();
    this.state = loaded
      ? { ...loaded, base: pathRecord(loaded.base) }
      : { deviceId: toB64u(randomBytes(9)), anchor: null, freshness: "unverified", base: pathRecord(), pending: [] };
    return this.state;
  }

  private async save(): Promise<void> {
    if (this.state) await this.o.store.save(this.state);
  }

  /** Serialise calls: one round (or pairing) at a time per device. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.running.then(fn, fn);
    this.running = next.catch(() => undefined);
    return next;
  }

  /** How this device knows its view of the vault is current. */
  async freshness(): Promise<{ source: FreshnessSource; verified: boolean; counter: number | null }> {
    const s = await this.loadState();
    return { source: s.freshness, verified: s.freshness !== "unverified", counter: s.anchor?.counter ?? null };
  }

  /** The creator of the vault anchors on the manifest it just wrote. */
  markCreated(anchor: FreshnessAnchor): Promise<void> {
    return this.exclusive(async () => {
      const s = await this.loadState();
      s.anchor = anchor;
      s.freshness = "created";
      await this.save();
    });
  }

  /**
   * A pairing code for a new device, carrying this device's newest verified
   * anchor. An unverified (TOFU) device cannot issue one: it would pass on a
   * state nobody verified as if it had been.
   */
  async pairingCode(): Promise<string> {
    const s = await this.loadState();
    if (!s.anchor) throw new PairingError("Sync once before pairing another device");
    if (s.freshness === "unverified") {
      throw new PairingError("This device's freshness is not verified: pair it or confirm it before pairing others");
    }
    return createPairingCode(this.o.keys, s.anchor, this.o.now());
  }

  /** Accept a pairing code from an existing device: anchors the rollback guard. */
  pair(code: string): Promise<void> {
    return this.exclusive(async () => {
      const got = await readPairingCode(this.o.keys, code, this.o.now());
      const s = await this.loadState();
      // Never move the anchor backwards; equal counters must be the same manifest.
      if (s.anchor && got.counter === s.anchor.counter && got.digest !== s.anchor.digest) {
        throw new RollbackError(s.anchor.counter, got.counter, "fork");
      }
      if (s.anchor && got.counter < s.anchor.counter) {
        // An older code cannot vouch for the newer state this device already
        // holds (it may come from another fork). A verified device needs
        // nothing from it; an unverified one needs a current code.
        if (s.freshness !== "unverified") return;
        throw new PairingError("The pairing code is older than this device's state; create a new code on the other device");
      }
      s.anchor = got;
      s.freshness = "paired";
      await this.save();
    });
  }

  /** The user confirmed by hand (e.g. compared with another device) that the vault is current. */
  confirmFreshness(): Promise<void> {
    return this.exclusive(async () => {
      const s = await this.loadState();
      if (!s.anchor) throw new Error("Nothing to confirm yet: sync once first");
      if (s.freshness === "unverified") s.freshness = "confirmed";
      await this.save();
    });
  }

  sync(): Promise<SyncResult> {
    return this.exclusive(async () => {
      this.emit({ kind: "start", at: this.o.now() });
      try {
        const r = await this.round();
        this.emit({ kind: "done", at: this.o.now(), uploaded: r.uploaded, downloaded: r.downloaded, deleted: r.deleted, conflicts: r.conflicts.length, held: r.held.length, incomplete: r.incomplete });
        return r;
      } catch (e) {
        this.emit({ kind: "error", at: this.o.now(), message: (e as Error)?.message ?? String(e) });
        throw e;
      }
    });
  }

  private async setBase(path: string, entry: ManifestEntry, data: Uint8Array | null): Promise<void> {
    const s = await this.loadState();
    // Ancestor bytes are kept for the three-way merge of a note; a large
    // file (an attachment) keeps only its manifest entry, so a first sync of
    // a big vault does not hold a second copy of it (plan W1.8 benchmark).
    await this.o.store.setBase(path, entry.deleted || !data || data.length > BASE_BYTES_LIMIT ? null : data);
    s.base[path] = entry;
    await this.save();
  }

  private async blob(path: string, rev: string): Promise<string> {
    const k = `${path}\u0000${rev}`;
    let n = this.names.get(k);
    if (n === undefined) {
      n = await blobName(this.o.keys, path, rev);
      if (this.names.size > 50_000) this.names.clear();
      this.names.set(k, n);
    }
    return n;
  }

  private async manifestObject(): Promise<string> {
    let n = this.names.get("");
    if (n === undefined) {
      n = await manifestName(this.o.keys);
      this.names.set("", n);
    }
    return n;
  }

  /**
   * The stored ancestor of `path`, only if it is the version `entry` names:
   * bytes and metadata are saved in two steps, and an interruption between
   * them must not hand the merge a wrong ancestor.
   */
  private async baseBytes(path: string, entry: ManifestEntry): Promise<Uint8Array | null> {
    const data = await this.o.store.getBase(path);
    return data && (await sha256Hex(data)) === entry.hash ? data : null;
  }

  private async fetchBlob(path: string, e: ManifestEntry): Promise<Uint8Array> {
    const name = await this.blob(path, e.rev);
    const obj = await this.o.provider.get(name);
    if (!obj) throw new BlobMissingError();
    const data = await unseal(blobKey(this.o.keys, e.e), this.o.keys.vaultId, "blob", name, obj.data);
    if ((await sha256Hex(data)) !== e.hash) throw new DecryptError("A file does not match its manifest entry");
    return data;
  }

  /** `previousKey`: also accept a manifest sealed under the previous epoch (only while re-keying). */
  private async readManifest(previousKey?: CryptoKey): Promise<{ manifest: Manifest; etag: string | null }> {
    const s = await this.loadState();
    const obj = await this.o.provider.get(await this.manifestObject());
    if (!obj) {
      // The manifest vanished: as old as it gets.
      if (s.anchor) throw new RollbackError(s.anchor.counter, 0, "older");
      return { manifest: emptyManifest(this.o.keys.vaultId), etag: null };
    }
    let opened: { manifest: Manifest; digest: string };
    try {
      opened = await openManifest(this.o.keys, obj.data, await this.manifestObject());
    } catch (e) {
      if (!(e instanceof DecryptError) || !previousKey) throw e;
      opened = await openManifest({ ...this.o.keys, manifest: previousKey }, obj.data, await this.manifestObject());
    }
    const { manifest, digest } = opened;
    const got = { counter: manifest.counter, digest };
    if (checkFreshness(s.anchor, got, manifest.history) === "unproven" && s.freshness !== "unverified") {
      // Too far behind to prove this manifest descends from the one we trusted:
      // say so instead of carrying a verification that no longer holds.
      s.freshness = "unverified";
    }
    if (!s.anchor || got.counter > s.anchor.counter) {
      s.anchor = got;
      await this.save();
    }
    this.remoteDigest = digest;
    this.lastRemote = manifest;
    if (s.committing?.length) await this.reconcileCommit(manifest);
    return { manifest, etag: obj.etag };
  }

  /**
   * A manifest write whose outcome is unknown left its replaced blob names in
   * `committing`. A revision, once replaced, is never referenced again, so
   * every name the current manifest does not reference is garbage — whether
   * this device's write landed or another device replaced it since — and goes
   * to `pending`. Names still referenced are live: the write did not land.
   */
  private async reconcileCommit(current: Manifest): Promise<void> {
    const s = await this.loadState();
    const names = new Set(s.committing ?? []);
    const live = new Set<string>();
    for (const [path, e] of Object.entries(current.files)) {
      if (e.deleted) continue;
      const n = await this.blob(path, e.rev);
      if (names.has(n)) live.add(n);
    }
    s.pending.push(...[...names].filter((n) => !live.has(n)));
    s.committing = [];
    await this.save();
  }

  private async round(): Promise<SyncResult> {
    const s = await this.loadState();
    await this.refresh();
    const res: SyncResult = { uploaded: 0, downloaded: 0, deleted: 0, conflicts: [], held: [], counter: 0, retries: 0, incomplete: false };
    const held = new Set<string>();
    this.holds = new Map();
    /** Blobs uploaded in this round, reused when a retry pushes the same content again. */
    const uploads = new Map<string, { hash: string; rev: string; size: number; data: Uint8Array | null; epoch: number }>();

    for (let attempt = 0; attempt < this.o.maxAttempts; attempt++) {
      let remote: Manifest;
      let etag: string | null;
      try {
        ({ manifest: remote, etag } = await this.readManifest());
        await this.pull(remote, res, held);
      } catch (e) {
        if (e instanceof BlobMissingError) {
          res.retries++;
          continue;
        }
        throw e;
      }
      res.counter = remote.counter;

      const changes = await this.collectChanges(remote, held, uploads);
      if (changes.size === 0) {
        await this.collectGarbage(remote);
        res.held = [...held];
        return res;
      }

      const next: Manifest = {
        ...remote,
        counter: remote.counter + 1,
        files: pathRecord(remote.files),
        history: remote.counter > 0 ? [...remote.history, [remote.counter, this.remoteDigest] as [number, string]].slice(-HISTORY_LENGTH) : [],
      };
      for (const [path, c] of changes) next.files[path] = c.entry;
      const sealed = await sealManifest(this.o.keys, next, await this.manifestObject());
      // The blobs this commit replaces. Recorded before the write: if the write
      // succeeds but its answer is lost, the next round finds them unreferenced
      // and queues them (`reconcileCommit`), instead of forgetting them.
      const superseded: string[] = [];
      for (const [path] of changes) {
        const old = remote.files[path];
        if (old && !old.deleted) superseded.push(await this.blob(path, old.rev));
      }
      s.committing = superseded;
      await this.save();
      try {
        await this.o.provider.put(await this.manifestObject(), sealed.bytes, etag ? { ifMatch: etag } : { ifNoneMatch: "*" });
      } catch (e) {
        if (e instanceof PreconditionFailedError) {
          s.committing = []; // certainly not written: the old blobs are still live
          await this.save();
          res.retries++;
          continue;
        }
        throw e;
      }
      // The replaced blobs are queued in the same save as the new anchor, before
      // any base entry forgets them, so an interruption cannot leak them.
      s.anchor = { counter: next.counter, digest: sealed.digest };
      this.lastRemote = next;
      s.pending.push(...superseded);
      s.committing = [];
      await this.save();
      for (const [path, c] of changes) {
        await this.setBase(path, c.entry, c.data);
        if (c.entry.deleted) {
          res.deleted++;
          this.emit({ kind: "delete", at: this.o.now(), path, bytes: 0, direction: "up" });
        } else res.uploaded++;
      }
      await this.collectGarbage(next);
      res.counter = next.counter;
      res.held = [...held];
      return res;
    }
    res.incomplete = true;
    res.held = [...held];
    return res;
  }

  /** Step 2: bring every path the manifest changed into this device. */
  private async pull(remote: Manifest, res: SyncResult, held: Set<string>): Promise<void> {
    const s = await this.loadState();
    const local = new Map((await this.listLocal()).map((f) => [f.path, f.hash]));
    const sorted = [...new Set([...Object.keys(remote.files), ...Object.keys(s.base), ...local.keys()])].sort();
    // Paths this device keeps out (plan W1.8): judged on the version in the vault.
    const excluded = new Set<string>();
    let planFiles = 0;
    let planBytes = 0;
    for (const path of sorted) {
      const r = remote.files[path];
      if (!r || sameEntry(r, s.base[path]) || held.has(path)) continue;
      const why = this.o.exclude(path, r.deleted ? null : r.size);
      if (why) {
        excluded.add(path);
        this.emit({ kind: "excluded", at: this.o.now(), path, reason: why, direction: "down" });
      } else if (!r.deleted && liveHash(r) !== (local.get(path) ?? null)) {
        planFiles++;
        planBytes += r.size;
      }
    }
    this.emit({ kind: "plan", at: this.o.now(), direction: "down", files: planFiles, bytes: planBytes });
    // Deletions first: a folder `a/` replaced by a file `a` (or the reverse)
    // must be cleared before the new entry is written.
    const gone = (p: string) => remote.files[p]?.deleted === true;
    for (const path of [...sorted.filter(gone), ...sorted.filter((p) => !gone(p))]) {
      if (held.has(path) || excluded.has(path)) continue;
      const r = remote.files[path];
      const b = s.base[path];
      if (sameEntry(r, b) || !r) continue;
      const lh = local.get(path) ?? null;
      const rh = liveHash(r);
      const localChanged = lh !== liveHash(b);

      if (!localChanged || lh === rh) {
        // Only the other side changed (or both made the same change).
        if (lh === rh) {
          await this.setBase(path, r, rh === null ? null : await this.o.local.read(path));
          continue;
        }
        if (rh === null) {
          if (!(await this.o.local.remove(path, lh as string))) {
            this.hold(held, path, "retry");
            continue;
          }
          res.deleted++;
          await this.setBase(path, r, null);
          this.emit({ kind: "delete", at: this.o.now(), path, bytes: 0, direction: "down" });
        } else {
          const data = await this.fetchBlob(path, r);
          if (!(await this.o.local.write(path, data, lh))) {
            this.hold(held, path, "retry");
            continue;
          }
          res.downloaded++;
          await this.setBase(path, r, data);
          this.emit({ kind: "download", at: this.o.now(), path, bytes: data.length, direction: "down" });
        }
        continue;
      }

      // Both sides changed, differently. Reported now, before any dialog opens.
      res.conflicts.push(path);
      this.emit({ kind: "conflict", at: this.o.now(), path });
      if (rh === null) {
        // Deleted there, edited here: the edit wins and is pushed as a new version.
        await this.setBase(path, r, null);
        continue;
      }
      const remoteData = await this.fetchBlob(path, r);
      if (lh === null) {
        // Deleted here, edited there: the edit comes back.
        if (!(await this.o.local.write(path, remoteData, null))) {
          this.hold(held, path, "retry");
          continue;
        }
        res.downloaded++;
        await this.setBase(path, r, remoteData);
        this.emit({ kind: "download", at: this.o.now(), path, bytes: remoteData.length, direction: "down" });
        continue;
      }
      const localData = await this.o.local.read(path);
      if (!localData || (await sha256Hex(localData)) !== lh) {
        this.hold(held, path, "retry"); // edited while we looked: next round
        continue;
      }
      const decision = await this.o.resolver({
        path,
        base: b && !b.deleted ? await this.baseBytes(path, b) : null,
        local: localData,
        remote: remoteData,
      });
      switch (decision.kind) {
        case "hold":
          this.hold(held, path, "conflict");
          break;
        case "local":
          await this.setBase(path, r, remoteData);
          break;
        case "remote":
        case "content": {
          const data = decision.kind === "remote" ? remoteData : decision.data;
          if (!(await this.o.local.write(path, data, lh))) {
            this.hold(held, path, "retry");
            break;
          }
          res.downloaded++;
          await this.setBase(path, r, remoteData);
          this.emit({ kind: "download", at: this.o.now(), path, bytes: remoteData.length, direction: "down" });
          break;
        }
        case "keepBoth": {
          const tag = `${new Date(this.o.now()).toISOString().slice(0, 10)} ${s.deviceId.slice(0, 4)}`;
          const copy = conflictCopyPath(path, tag, (p) => p in remote.files || local.has(p) || p in s.base);
          if (!(await this.o.local.write(copy, remoteData, null))) {
            this.hold(held, path, "retry");
            break;
          }
          local.set(copy, r.hash);
          res.downloaded++;
          await this.setBase(path, r, remoteData);
          this.emit({ kind: "download", at: this.o.now(), path: copy, bytes: remoteData.length, direction: "down" });
          break;
        }
      }
    }
  }

  /** Step 3 (blobs): upload every local change; returns the new manifest entries. */
  private async collectChanges(
    remote: Manifest,
    held: Set<string>,
    uploads: Map<string, { hash: string; rev: string; size: number; data: Uint8Array | null; epoch: number }>,
  ): Promise<Map<string, { entry: ManifestEntry; data: Uint8Array | null }>> {
    const s = await this.loadState();
    const listed = await this.listLocal();
    const local = new Map(listed.map((f) => [f.path, f.hash]));
    const sizes = new Map(listed.map((f) => [f.path, f.size ?? null]));
    const out = new Map<string, { entry: ManifestEntry; data: Uint8Array | null }>();
    const paths = [...new Set([...Object.keys(s.base), ...local.keys()])].sort();
    // What goes up, and what this device keeps (plan W1.8): judged before
    // anything is read, so an excluded file never even enters the round.
    const todo: string[] = [];
    let planBytes = 0;
    for (const path of paths) {
      if (held.has(path)) continue;
      const b = s.base[path];
      const lh = local.get(path) ?? null;
      if (lh === liveHash(b)) continue;
      if (!sameEntry(remote.files[path], b)) continue; // not pulled yet (held or raced): next round
      const why = this.o.exclude(path, lh === null ? null : (sizes.get(path) ?? null));
      if (why) {
        this.emit({ kind: "excluded", at: this.o.now(), path, reason: why, direction: "up" });
        continue;
      }
      todo.push(path);
      planBytes += lh === null ? 0 : (sizes.get(path) ?? 0);
    }
    this.emit({ kind: "plan", at: this.o.now(), direction: "up", files: todo.length, bytes: planBytes });
    for (const path of todo) {
      const r = remote.files[path];
      const lh = local.get(path) ?? null;
      const ver = (r?.ver ?? 0) + 1;
      if (lh === null) {
        if (!r || r.deleted) continue; // never existed there, or already deleted
        out.set(path, { entry: { ver, rev: "", hash: "", size: 0, deleted: true, by: s.deviceId }, data: null });
        continue;
      }
      const data = await this.o.local.read(path);
      if (!data) continue;
      // The size was unknown or changed since the listing: judge the bytes about to leave.
      const late = this.o.exclude(path, data.length);
      if (late) {
        this.emit({ kind: "excluded", at: this.o.now(), path, reason: late, direction: "up" });
        continue;
      }
      const hash = await sha256Hex(data);
      let up = uploads.get(path);
      if (!up || up.hash !== hash) {
        const rev = toB64u(randomBytes(12));
        const name = await this.blob(path, rev);
        const sealed = await seal(this.o.keys.blobs, this.o.keys.vaultId, "blob", name, data);
        s.pending.push(name);
        await this.save();
        await this.o.provider.put(name, sealed, { ifNoneMatch: "*" });
        // Kept for the base after the commit only when it will be stored (see setBase).
        up = { hash, rev, size: data.length, data: data.length > BASE_BYTES_LIMIT ? null : data, epoch: this.o.keys.epoch };
        uploads.set(path, up);
        this.emit({ kind: "upload", at: this.o.now(), path, bytes: data.length, direction: "up" });
      }
      out.set(path, { entry: { ver, rev: up.rev, hash, size: up.size, by: s.deviceId, ...(up.epoch ? { e: up.epoch } : {}) }, data: up.data });
    }
    // The manifest must describe a tree a file system can hold: never a live
    // file `x` together with live entries under `x/`. A change that would
    // create that — typically because the other side of the clash is held —
    // is held too, until the clash is settled.
    for (let changed = true; changed; ) {
      changed = false;
      const live = new Set(Object.keys(remote.files).filter((p) => !remote.files[p].deleted));
      for (const [p, c] of out) {
        if (c.entry.deleted) live.delete(p);
        else live.add(p);
      }
      for (const [p, c] of out) {
        if (c.entry.deleted) continue;
        const segs = p.split("/");
        const above = segs.slice(0, -1).some((_, k) => live.has(segs.slice(0, k + 1).join("/")));
        const below = [...live].some((q) => q.startsWith(`${p}/`));
        if (above || below) {
          out.delete(p);
          this.hold(held, p, "clash");
          changed = true;
          break;
        }
      }
    }
    return out;
  }

  /**
   * Delete blobs that are known garbage — every name in `pending` that
   * `current` does not reference: blobs replaced by this device's commits and
   * its own uploads that never got committed. Unknown objects are never
   * touched — they may be another device's upload in flight.
   */
  private async collectGarbage(current: Manifest): Promise<void> {
    const s = await this.loadState();
    if (!s.pending.length) return;
    const referenced = new Set<string>();
    if (s.pending.length) {
      for (const [path, e] of Object.entries(current.files)) {
        if (e.by === s.deviceId && !e.deleted) referenced.add(await this.blob(path, e.rev));
      }
    }
    // Every name stays recorded until its delete succeeded, so an interrupted
    // clean-up is finished by a later round instead of leaking the object.
    const garbage = [...new Set(s.pending.filter((n) => !referenced.has(n)))];
    s.pending = [...garbage];
    await this.save();
    for (const name of garbage) {
      try {
        await this.o.provider.delete(name);
      } catch {
        continue; // costs space, never data; retried after the next round
      }
      s.pending = s.pending.filter((n) => n !== name);
      await this.save();
    }
  }
}
