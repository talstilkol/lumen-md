#!/usr/bin/env node
/**
 * Group-key prototypes for the ADR docs/adr/005-group-keys.md (plan W13.S3).
 * An experiment, not product code: nothing in src/ imports it, and it is not
 * an implementation of MLS (RFC 9420) or BeeKEM (ePrint 2026/1434) — it is
 * the smallest model of each that measures the two numbers the decision
 * turns on, with real X25519 / HKDF / AES-256-GCM from node:crypto:
 *
 *   - the bytes a device writes to remove one member of an n-member vault;
 *   - what happens when c members change keys at the same time (a split
 *     or offline period: the state Lumen's providers produce, since most of
 *     them cannot order writes).
 *
 *   shared   Lumen's keyring today (spec §5): a new epoch secret, wrapped
 *            for every remaining device (an age X25519 stanza each).
 *   treekem  MLS's ratchet tree: the committer refreshes its direct path and
 *            encrypts each path secret to the copath node's resolution. Needs
 *            a total order of commits (a delivery service); a concurrent
 *            commit loses and is redone.
 *   beekem   BeeKEM: TreeKEM whose concurrent updates merge instead of
 *            losing — a node that two updates touched holds both ("conflict")
 *            keys until a later update on that path replaces them; encrypting
 *            to it costs one ciphertext per key.
 *
 *   node scripts/experiments/group-keys/proto.mjs [--json]
 */
import { createCipheriv, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";

/** One ciphertext of a path secret / epoch secret to one X25519 public key: ephemeral key ‖ AES-GCM(32-byte secret). */
export const WRAP_BYTES = 32 + 32 + 16 + 12;
/** An age X25519 recipient stanza for a 16-byte file key, plus Lumen's per-device JSON fields (spec §5: id, recipient, wrap). */
export const AGE_STANZA_BYTES = 3 + 7 + 43 + 1 + 43 + 1;
export const AGE_FIXED_BYTES = 22 + 4 + 43 + 1 + 16 + 32 + 16;
const KEYRING_DEVICE_JSON = 2 + 22 + 3 + 62 + 3; // "<22-char id>":{"recipient":"age1…", plus quoting
const PUBKEY_BYTES = 32;

/** Real crypto for one wrap, so the timing is honest. */
function wrapOnce(pub) {
  const eph = generateKeyPairSync("x25519");
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: pub });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), "proto/wrap", 32));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const out = Buffer.concat([c.update(randomBytes(32)), c.final(), c.getAuthTag()]);
  return 32 + iv.length + out.length;
}

const depth = (n) => Math.ceil(Math.log2(Math.max(2, n)));

/** Lumen today: remove one of n → a new epoch wrapped for n − 1 devices (base64 in JSON: ×4/3). */
export function sharedRemove(n) {
  const per = Math.ceil(((AGE_FIXED_BYTES + AGE_STANZA_BYTES + 32) * 4) / 3) + KEYRING_DEVICE_JSON;
  return { bytes: (n - 1) * per, ciphertexts: n - 1 };
}

/**
 * A complete binary tree of `n` leaves (n a power of two here). `keys[node]`
 * = how many public keys the node holds (0 blank, 1 normal, >1 conflict).
 * Node ids: heap order, root 1, leaves n..2n-1.
 */
function tree(n) {
  const size = 1 << depth(n);
  const keys = new Array(2 * size).fill(1);
  return { size, keys };
}

/** Public keys a sender must encrypt to for `node`: its keys, or the resolution of its children when blank. */
function resolution(t, node) {
  if (node >= 2 * t.size) return 0;
  if (t.keys[node] > 0) return t.keys[node];
  if (node >= t.size) return 0;
  return resolution(t, 2 * node) + resolution(t, 2 * node + 1);
}

/** The cost of one path update from leaf `leaf`: a ciphertext per copath resolution key, a new public key per path node. */
function pathUpdate(t, leaf, { merge = false } = {}) {
  let node = t.size + leaf;
  let ciphertexts = 0;
  let pubs = 0;
  while (node > 1) {
    const sib = node ^ 1;
    ciphertexts += resolution(t, sib);
    node >>= 1;
    pubs++;
    // A path update replaces the node's keys (conflicts resolve) — or, merged concurrently, adds one (BeeKEM).
    t.keys[node] = merge ? t.keys[node] + 1 : 1;
  }
  return { ciphertexts, pubs, bytes: ciphertexts * WRAP_BYTES + pubs * PUBKEY_BYTES };
}

/** MLS remove: the committer blanks the removed leaf's path and refreshes its own. */
export function treekemRemove(n, removed = 1, committer = 0) {
  const t = tree(n);
  for (let node = t.size + removed; node >= 1; node >>= 1) t.keys[node] = 0;
  return pathUpdate(t, committer);
}

/**
 * c members update at once. TreeKEM (a delivery service orders them): one
 * wins, c − 1 are refused and redone one after another — total bytes.
 * BeeKEM: all merge; then a removal costs the conflict keys left on the copath.
 */
export function concurrent(n, c, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const leaves = [];
  while (leaves.length < c) {
    const l = 1 + Math.floor(rnd() * (n - 1));
    if (!leaves.includes(l)) leaves.push(l);
  }
  const tk = tree(n);
  // The c − 1 losers' first attempts are wasted (computed against the same starting tree)…
  let tkBytes = leaves.slice(1).reduce((sum, l) => sum + pathUpdate(tree(n), l).bytes, 0);
  // …and every update is then applied one after the other.
  for (const l of leaves) tkBytes += pathUpdate(tk, l).bytes;
  const tkRemove = (() => {
    for (let node = tk.size + 0; node >= 1; node >>= 1) tk.keys[node] = 0;
    return pathUpdate(tk, n - 1).bytes;
  })();
  const bk = tree(n);
  let bkBytes = 0;
  // Concurrent: every update is computed against the same starting tree, then merged (conflict keys add up).
  const start = bk.keys.slice();
  for (const l of leaves) {
    const tmp = { size: bk.size, keys: start.slice() };
    bkBytes += pathUpdate(tmp, l).bytes;
  }
  for (const l of leaves) for (let node = (bk.size + l) >> 1; node >= 1; node >>= 1) bk.keys[node] = bk.keys[node] + 1;
  for (let node = 1; node < bk.size; node++) if (bk.keys[node] > 1) bk.keys[node] -= 1; // the original key is superseded; c updates leave c keys where paths met
  const bkRemove = (() => {
    for (let node = bk.size + 0; node >= 1; node >>= 1) bk.keys[node] = 0;
    return pathUpdate(bk, n - 1).bytes;
  })();
  return { treekem: { updatesBytes: tkBytes, redone: c - 1, removeAfter: tkRemove }, beekem: { updatesBytes: bkBytes, redone: 0, removeAfter: bkRemove } };
}

/** Wall-clock of the real crypto for one removal at size n (ms), each scheme. */
export function timeRemove(n) {
  const pub = generateKeyPairSync("x25519").publicKey;
  const t0 = performance.now();
  for (let i = 0; i < sharedRemove(n).ciphertexts; i++) wrapOnce(pub);
  const t1 = performance.now();
  for (let i = 0; i < treekemRemove(n).ciphertexts; i++) wrapOnce(pub);
  const t2 = performance.now();
  return { shared: t1 - t0, treekem: t2 - t1 };
}

export const SIZES = [4, 8, 16, 32, 64, 128, 256, 1024];

export function table() {
  return SIZES.map((n) => ({ n, shared: sharedRemove(n).bytes, treekem: treekemRemove(n).bytes, concurrent4: n >= 8 ? concurrent(n, 4) : null }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = table();
  if (process.argv.includes("--json")) console.log(JSON.stringify({ rows, timing1024: timeRemove(1024) }, null, 1));
  else {
    console.log("n\tshared (B)\ttreekem/beekem remove (B)\t4 concurrent: treekem total (B, 3 redone)\tbeekem total (B)\tremove after: treekem\tbeekem");
    for (const r of rows) console.log([r.n, r.shared, r.treekem, r.concurrent4?.treekem.updatesBytes ?? "-", r.concurrent4?.beekem.updatesBytes ?? "-", r.concurrent4?.treekem.removeAfter ?? "-", r.concurrent4?.beekem.removeAfter ?? "-"].join("\t"));
    const t = timeRemove(1024);
    console.log(`\ncrypto time to remove one of 1024: shared ${t.shared.toFixed(0)} ms, tree ${t.treekem.toFixed(1)} ms (this machine)`);
  }
}
