#!/usr/bin/env node
/**
 * The second implementation of Lumen's encrypted sync format, in
 * JavaScript (plan W13.S4): written from docs/sync-protocol.md, with
 * node:crypto (PBKDF2, HKDF, HMAC, AES-256-GCM, X25519, ChaCha20-Poly1305,
 * scrypt, SHA-256) and the RFC 7693 / 9106 code next to it (argon2ref.mjs,
 * since Node 22 has no Argon2). It imports nothing of Lumen's src/: an
 * auditor can read the spec, this file and the vectors, and nothing else.
 *
 * The Python reader (check_vectors.py + agepy.py) is the first independent
 * implementation; this one is the second, in another language family's
 * crypto library (OpenSSL through node:crypto instead of pyca/cryptography).
 *
 *   node scripts/sync-protocol/ref-impl.mjs [vectors.json] [--json]
 *
 * Exit 0 when 100% of the vectors decode identically.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, pbkdf2Sync, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { argon2id } from "./argon2ref.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const enc = new TextEncoder();
const B = (x, encoding) => Buffer.from(x, encoding);
const b64u = (b) => B(b).toString("base64url");
const unb64u = (s) => Buffer.from(s, "base64url");
const sha256 = (b) => createHash("sha256").update(b).digest();
const hmac256 = (k, d) => createHmac("sha256", k).update(d).digest();
const same = (a, b) => a.length === b.length && timingSafeEqual(a, b);
/** JSON as the spec writes it: no spaces, non-ASCII as is (Python's ensure_ascii=False, separators=(",",":")). */
const jdump = (v) => JSON.stringify(v);

class RefError extends Error {}
const fail = (m) => {
  throw new RefError(m);
};

// ── Keys (spec §3) ──────────────────────────────────────────────────────

/** Argon2id in plain JS takes seconds at production parameters: one derivation per (passphrase, KDF) per run. */
const masterMemo = new Map();
function masterKey(passphrase, kdf) {
  const memo = jdump([passphrase, kdf]);
  if (!masterMemo.has(memo)) masterMemo.set(memo, deriveMaster(passphrase, kdf));
  return masterMemo.get(memo);
}

function deriveMaster(passphrase, kdf) {
  const pw = B(enc.encode(passphrase.normalize("NFC")));
  const salt = unb64u(kdf.salt);
  if (kdf.alg === "pbkdf2-sha256") return pbkdf2Sync(pw, salt, kdf.iterations, 32, "sha256");
  if (kdf.alg === "argon2id") return B(argon2id({ password: pw, salt, memoryKiB: kdf.memoryKiB, iterations: kdf.iterations, parallelism: kdf.parallelism }));
  return fail("unknown KDF " + kdf.alg);
}

const hkdf = (ikm, salt, info, n = 32) => B(hkdfSync("sha256", ikm, salt, info, n));
const subkey = (secret, vaultId, purpose) => hkdf(secret, B(vaultId), B(`lumen-e2ee/1/${purpose}`));
const objectName = (namesKey, label) => b64u(hmac256(namesKey, B(label)));

function aesGcmOpen(key, nonce, sealed, aad) {
  const d = createDecipheriv("aes-256-gcm", key, nonce);
  d.setAAD(aad);
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
}

// ── Sealed objects (spec §4) ────────────────────────────────────────────

function unseal(key, vaultId, kind, name, sealed) {
  if (sealed[0] !== 1) fail("unknown sealed format");
  const pt = aesGcmOpen(key, sealed.subarray(1, 13), sealed.subarray(13), B(`lumen-e2ee/1/${kind}/${vaultId}/${name}`));
  const n = pt.readUInt32BE(0);
  if (n > pt.length - 4) fail("bad padding");
  return pt.subarray(4, 4 + n);
}

// ── age v1 (spec §7, https://age-encryption.org/v1): decrypt only ────────

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values) {
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = (((chk & 0x1ffffff) << 5) ^ v) >>> 0;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk = (chk ^ gen[i]) >>> 0;
  }
  return chk;
}
const hrpExpand = (h) => [...[...h].map((c) => c.charCodeAt(0) >> 5), 0, ...[...h].map((c) => c.charCodeAt(0) & 31)];
function convertBits(data, from, to, pad) {
  let acc = 0;
  let bits = 0;
  const out = [];
  const maxv = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >>> bits) & maxv);
    }
    acc &= (1 << bits) - 1;
  }
  if (pad && bits) out.push((acc << (to - bits)) & maxv);
  else if (!pad && (bits >= from || ((acc << (to - bits)) & maxv))) fail("bech32: bad padding");
  return out;
}
export function bech32Encode(hrp, data) {
  const words = convertBits([...data], 8, 5, true);
  const chk = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  return hrp + "1" + [...words, ...[0, 1, 2, 3, 4, 5].map((i) => (chk >>> (5 * (5 - i))) & 31)].map((w) => CHARSET[w]).join("");
}
export function bech32Decode(s) {
  const low = s.toLowerCase();
  const pos = low.lastIndexOf("1");
  const hrp = low.slice(0, pos);
  const words = [...low.slice(pos + 1)].map((c) => CHARSET.indexOf(c));
  if (words.some((w) => w < 0) || polymod([...hrpExpand(hrp), ...words]) !== 1) fail("bech32: bad checksum");
  return { hrp, data: B(convertBits(words.slice(0, -6), 5, 8, false)) };
}

const X25519_PKCS8 = B("302e020100300506032b656e04220420", "hex");
const X25519_SPKI = B("302a300506032b656e032100", "hex");
const x25519Priv = (raw) => createPrivateKey({ key: Buffer.concat([X25519_PKCS8, raw]), format: "der", type: "pkcs8" });
const x25519Pub = (raw) => createPublicKey({ key: Buffer.concat([X25519_SPKI, raw]), format: "der", type: "spki" });
const rawPub = (priv) => createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(X25519_SPKI.length);
const x25519 = (privRaw, pubRaw) => diffieHellman({ privateKey: x25519Priv(privRaw), publicKey: x25519Pub(pubRaw) });

function chachaOpen(key, nonce, sealed) {
  const d = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
}
function chachaSeal(key, nonce, pt) {
  const c = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  return Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
}
const unb64Strict = (s) => {
  if (/[^A-Za-z0-9+/]/.test(s)) fail("age: bad base64");
  const b = Buffer.from(s, "base64");
  if (b.toString("base64").replace(/=+$/, "") !== s) fail("age: non-canonical base64");
  return b;
};
const CHUNK = 64 * 1024;
const ageNonce = (i, last) => {
  const n = Buffer.alloc(12);
  n.writeUIntBE(i, 5, 6);
  n[11] = last ? 1 : 0;
  return n;
};

export function ageDecrypt(data, { identity, passphrase } = {}) {
  const text = data.toString("latin1");
  const lines = text.split("\n");
  if (lines[0] !== "age-encryption.org/v1") fail("age: not v1");
  let i = 1;
  const stanzas = [];
  while (!lines[i].startsWith("--- ")) {
    if (!lines[i].startsWith("-> ")) fail("age: malformed");
    const [t, ...args] = lines[i].slice(3).split(" ");
    let body = "";
    for (;;) {
      i++;
      body += lines[i];
      if (lines[i].length < 64) break;
    }
    stanzas.push({ t, args, body: unb64Strict(body) });
    i++;
  }
  const mac = unb64Strict(lines[i].slice(4));
  const headerLen = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + 3;
  const payloadStart = lines.slice(0, i + 1).reduce((n, l) => n + l.length + 1, 0);
  if (stanzas.some((s) => s.t === "scrypt") && stanzas.length !== 1) fail("age: scrypt must be alone");
  let fileKey = null;
  for (const s of stanzas) {
    try {
      if (s.t === "scrypt" && passphrase !== undefined) {
        const salt = unb64Strict(s.args[0]);
        const logN = Number(s.args[1]);
        if (logN > 20) fail("age: work factor too high");
        const key = scryptSync(B(passphrase), Buffer.concat([B("age-encryption.org/v1/scrypt"), salt]), 32, { N: 2 ** logN, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
        fileKey = chachaOpen(key, Buffer.alloc(12), s.body);
      } else if (s.t === "X25519" && identity !== undefined) {
        const raw = bech32Decode(identity).data;
        const share = unb64Strict(s.args[0]);
        const shared = x25519(raw, share);
        const wrap = hkdf(shared, Buffer.concat([share, rawPub(x25519Priv(raw))]), B("age-encryption.org/v1/X25519"));
        fileKey = chachaOpen(wrap, Buffer.alloc(12), s.body);
      }
    } catch (e) {
      if (e instanceof RefError) throw e;
      fileKey = null;
    }
    if (fileKey) break;
  }
  if (!fileKey) fail("age: no identity matched");
  if (!same(hmac256(hkdf(fileKey, Buffer.alloc(0), B("header")), data.subarray(0, headerLen)), mac)) fail("age: bad header MAC");
  const nonce = data.subarray(payloadStart, payloadStart + 16);
  const pk = hkdf(fileKey, nonce, B("payload"));
  let rest = data.subarray(payloadStart + 16);
  const out = [];
  for (let k = 0; ; k++) {
    const last = rest.length <= CHUNK + 16;
    out.push(chachaOpen(pk, ageNonce(k, last), rest.subarray(0, CHUNK + 16)));
    rest = rest.subarray(CHUNK + 16);
    if (last) break;
  }
  return Buffer.concat(out);
}

/** age to one X25519 recipient (only for the "a wrap the storage made" forgery check). */
function ageEncrypt(plaintext, recipient) {
  const fileKey = randomBytes(16);
  const pub = bech32Decode(recipient).data;
  const eph = randomBytes(32);
  const share = rawPub(x25519Priv(eph));
  const wrap = hkdf(x25519(eph, pub), Buffer.concat([share, pub]), B("age-encryption.org/v1/X25519"));
  const body = chachaSeal(wrap, Buffer.alloc(12), fileKey).toString("base64").replace(/=+$/, "");
  const lines = body.match(/.{1,64}/g) ?? [""];
  if (body.length % 64 === 0) lines.push("");
  const head = B(`age-encryption.org/v1\n-> X25519 ${share.toString("base64").replace(/=+$/, "")}\n${lines.join("\n")}\n---`);
  const mac = hmac256(hkdf(fileKey, Buffer.alloc(0), B("header")), head).toString("base64").replace(/=+$/, "");
  const nonce = randomBytes(16);
  const sealed = chachaSeal(hkdf(fileKey, nonce, B("payload")), ageNonce(0, true), plaintext);
  return Buffer.concat([head, B(` ${mac}\n`), nonce, sealed]);
}

// ── Keyring (spec §5, §5a, §5b) ──────────────────────────────────────────

const KEYRING_PROTOCOLS = [2, 3];
const RECOVERY_PROTOCOL = 3;
const keyringOpen = (key, field, vid, epoch, role, protocol) => aesGcmOpen(key, unb64u(field.n), unb64u(field.c), B(`lumen-e2ee-keyring/${protocol}/${vid}/${epoch}/${role}`));
const keyringDigest = (r) => sha256(B(jdump([r.format, r.protocol, r.vaultId, r.epoch, r.passphrase.n, r.passphrase.c, r.sealed.n, r.sealed.c, r.header ?? null, r.prev ?? null]))).toString("hex");
const orderedKdf = (k) => Object.fromEntries((k.alg === "pbkdf2-sha256" ? ["alg", "iterations", "salt"] : ["alg", "memoryKiB", "iterations", "parallelism", "salt"]).map((x) => [x, k[x]]));

function headerMaster(header, passphrase) {
  const kdf = orderedKdf(header.kdf);
  const master = masterKey(passphrase, kdf);
  const macIn = B(jdump([header.format, header.protocol, header.vaultId, kdf]));
  return same(hmac256(subkey(master, header.vaultId, "header"), macIn), unb64u(header.mac)) ? master : null;
}

function openContents(ring, secret) {
  if (!KEYRING_PROTOCOLS.includes(ring.protocol)) fail("a pre-release keyring (protocol 1): refused");
  const { vaultId: vid, epoch } = ring;
  const c = JSON.parse(keyringOpen(subkey(secret, vid, "keyring"), ring.sealed, vid, epoch, "sealed", ring.protocol).toString("utf8"));
  if (("recovery" in c || "recovery" in ring) && ring.protocol < RECOVERY_PROTOCOL) fail("a recovery wrap needs keyring protocol 3");
  if (!c.devices || typeof c.devices !== "object" || Array.isArray(c.devices)) fail("no sealed device list: refused");
  if (!c.manifest.startsWith(`manifest/${epoch}/`)) fail("bad manifest label");
  const chain = c.chain;
  if ((c.parent === null) !== (chain.length === 0) || (chain.length && chain.at(-1)[2] !== c.parent)) fail("the chain doesn't end at the parent");
  if (c.rev > 0 && (chain.at(-1)[0] !== epoch || chain.at(-1)[1] !== c.rev - 1)) fail("a same-epoch revision whose parent isn't the revision before");
  return c;
}

function openManifest(key, vid, name, data) {
  const m = JSON.parse(unseal(key, vid, "manifest", name, data).toString("utf8"));
  if (![1, 2].includes(m.protocol) || (m.protocol === 2) !== "frozen" in m) fail("unsupported manifest protocol");
  if (m.vaultId !== vid) fail("the manifest belongs to another vault");
  return m;
}

function recoverySecret(ring, key, passkey) {
  const { vaultId: vid, epoch } = ring;
  const w = passkey === undefined ? ring.recovery : (ring.passkeys ?? {})[passkey];
  if (ring.protocol < RECOVERY_PROTOCOL || !w) fail(passkey === undefined ? "no recovery wrap" : "no wrap for this passkey");
  const kind = passkey === undefined ? "recovery" : "passkey";
  const x = subkey(key, vid, `${kind}-x25519`);
  const mac = subkey(key, vid, `${kind}-mac`);
  const identity = bech32Encode("age-secret-key-", x).toUpperCase();
  const recipient = bech32Encode("age", rawPub(x25519Priv(x)));
  if (recipient !== w.recipient) fail("the recovery wrap is for another key");
  const label = passkey === undefined ? ["lumen-e2ee-recovery/1", vid, epoch, keyringDigest(ring), w.recipient, w.wrap] : ["lumen-e2ee-passkey/1", vid, epoch, keyringDigest(ring), passkey, w.recipient, w.wrap];
  if (!same(hmac256(mac, B(jdump(label))), unb64u(w.check))) fail("the recovery check doesn't verify: not made by the vault");
  const secret = ageDecrypt(unb64u(w.wrap), { identity });
  const contents = openContents(ring, secret);
  const sealed = passkey === undefined ? contents.recovery : (contents.passkeys ?? {})[passkey];
  if (!sealed || sealed.recipient !== recipient || sealed.mac !== b64u(mac) || Object.keys(sealed).length !== 2) fail("the sealed part doesn't name this key");
  return { secret, contents };
}

export function readVault(objects, { passphrase, device, recovery, passkey } = {}) {
  const header = JSON.parse(objects["lumen-e2ee-vault"].toString("utf8"));
  const vid = header.vaultId;
  let ring = objects["lumen-e2ee-keyring"] ? JSON.parse(objects["lumen-e2ee-keyring"].toString("utf8")) : null;
  if (ring && ring.vaultId !== vid) fail("the keyring belongs to another vault");
  let contents = null;
  let epoch;
  let secret;
  if (passphrase !== undefined) {
    let master = headerMaster(header, passphrase);
    if (master === null) {
      if (!ring || !("header" in ring)) fail("header MAC: wrong passphrase or changed header");
      const pending = JSON.parse(unb64u(ring.header).toString("utf8"));
      master = headerMaster(pending, passphrase);
      if (master === null || pending.vaultId !== vid) fail("header MAC: wrong passphrase or changed header");
    }
    if (!ring) {
      epoch = 0;
      secret = master;
    } else {
      const wrapKey = subkey(master, vid, "keyring-wrap");
      try {
        secret = keyringOpen(wrapKey, ring.passphrase, vid, ring.epoch, "passphrase", ring.protocol);
      } catch {
        if (!("header" in ring) || !("prev" in ring)) fail("the keyring doesn't open with this passphrase");
        const prev = JSON.parse(unb64u(ring.prev).toString("utf8"));
        if (prev.vaultId !== vid || prev.epoch !== ring.epoch - 1) fail("prev is not the epoch before");
        ring = prev;
        secret = keyringOpen(wrapKey, ring.passphrase, vid, ring.epoch, "passphrase", ring.protocol);
      }
      epoch = ring.epoch;
      contents = openContents(ring, secret);
      if ("header" in ring && contents.header !== sha256(unb64u(ring.header)).toString("hex")) fail("the pending header doesn't match the sealed part");
      if ("prev" in ring && contents.parent !== keyringDigest(JSON.parse(unb64u(ring.prev).toString("utf8")))) fail("prev is not this keyring's parent");
    }
  } else if (recovery !== undefined) {
    epoch = ring.epoch;
    ({ secret, contents } = recoverySecret(ring, recovery, passkey));
  } else {
    epoch = ring.epoch;
    const wrap = ring.devices[device.id];
    secret = ageDecrypt(unb64u(wrap.wrap), { identity: device.identity });
    contents = openContents(ring, secret);
    if (contents.devices[device.id] !== wrap.recipient || contents.revoked.some((r) => r.device === device.id)) fail("the device is not on the sealed device list");
  }
  const secrets = new Map(contents ? Object.entries(contents.older).map(([k, v]) => [Number(k), unb64u(v)]) : []);
  if (contents && !secrets.has(epoch - 1)) fail("the keyring lacks the epoch before");
  secrets.set(epoch, secret);
  const names = subkey(secrets.get(0), vid, "names");
  const mname = objectName(names, contents ? contents.manifest : "manifest");
  const manifest = openManifest(subkey(secret, vid, "manifest"), vid, mname, objects[mname]);
  const files = {};
  for (const [path, e] of Object.entries(manifest.files)) {
    if (e.deleted) continue;
    const bname = objectName(names, `blob\0${path}\0${e.rev}`);
    const data = unseal(subkey(secrets.get(e.e ?? 0), vid, "blobs"), vid, "blob", bname, objects[bname]);
    if (sha256(data).toString("hex") !== e.hash) fail(`${path}: hash does not match the manifest`);
    files[path] = data.toString("utf8");
  }
  return { epoch, files, secret, manifest, ring: contents ? [keyringDigest(ring), contents.rev] : null };
}

// ── Pairing (spec §6, §6a) ───────────────────────────────────────────────

const FIELDS = {
  code: ["kind", "vaultId", "counter", "digest", "epoch", "ringRev", "ringDigest", "issuedAt", "nonce", "commit"],
  request: ["kind", "vaultId", "epoch", "ringRev", "ringDigest", "counter", "digest", "requestedAt", "nonce", "commit"],
  answer: ["kind", "vaultId", "request", "nonce", "counter", "digest", "epoch", "ringRev", "ringDigest", "answeredAt", "pub"],
};
const VERSIONS = { code: 4, request: 3, answer: 3 };
const PREFIXES = { code: "lumen-pair:4:", request: "lumen-pair-request:3:", answer: "lumen-pair-answer:3:" };

function readPairing(text, kind, epoch, key) {
  const prefix = `${PREFIXES[kind]}${epoch}:`;
  if (!text.startsWith(prefix)) return null;
  const raw = unb64u(text.slice(prefix.length));
  if (raw.length < 33 || !same(hmac256(key, Buffer.concat([B(`lumen-pair/${kind}/${VERSIONS[kind]}\0`), raw.subarray(32)])), raw.subarray(0, 32))) return null;
  const body = JSON.parse(raw.subarray(32).toString("utf8"));
  const keys = Object.keys(body).sort().join();
  return body.kind === kind && keys === [...FIELDS[kind]].sort().join() ? body : null;
}

// ── The vectors ──────────────────────────────────────────────────────────

export function checkVectors(v, log = () => undefined) {
  const results = [];
  const check = (label, cond) => {
    results.push({ label, ok: !!cond });
    log(`${cond ? "ok    " : "FAIL  "}${label}`);
  };
  const refused = (label, fn) => {
    try {
      fn();
      check(label, false);
    } catch (e) {
      check(label, e instanceof RefError || e instanceof Error);
    }
  };
  const objectsOf = (vault) => Object.fromEntries(Object.entries(vault.objects).map(([n, d]) => [n, Buffer.from(d, "base64")]));
  const sameFiles = (a, b) => jdump(Object.entries(a).sort()) === jdump(Object.entries(b).sort());

  for (const vault of v.vaults) {
    const objects = objectsOf(vault);
    const r = readVault(objects, { passphrase: vault.passphrase });
    check(`${vault.name}: epoch ${r.epoch} with the passphrase`, r.epoch === vault.expect.epoch);
    check(`${vault.name}: ${Object.keys(r.files).length} files identical`, sameFiles(r.files, vault.expect.files));
    if (vault.frozen) check(`${vault.name}: the manifest is frozen for the next epoch (protocol 2)`, r.manifest.protocol === 2 && r.manifest.frozen.epoch === r.epoch + 1);
    if (vault.pending) {
      const p = vault.pending;
      const o = readVault(objects, { passphrase: p.oldPassphrase });
      check(`${vault.name}: the old passphrase opens epoch ${o.epoch} through prev, never the new one`, o.epoch === p.oldEpoch && jdump(Object.keys(o.manifest.files).sort()) === jdump([...p.oldFiles].sort()));
    }
    if (vault.recovery) {
      const rkey = Buffer.from(vault.recovery.key, "hex");
      const rr = readVault(objects, { recovery: rkey });
      check(`${vault.name}: the recovery key alone opens epoch ${rr.epoch}, the passphrase's secret, every file`, rr.epoch === r.epoch && same(rr.secret, r.secret) && sameFiles(rr.files, vault.expect.files));
      const ring = JSON.parse(objects["lumen-e2ee-keyring"].toString("utf8"));
      check(`${vault.name}: keyring protocol 3 with the recovery wrap`, ring.protocol === 3 && "recovery" in ring);
      refused(`${vault.name}: another recovery key is refused`, () => readVault(objects, { recovery: Buffer.alloc(32) }));
      const forged = { ...ring, recovery: { ...ring.recovery, wrap: b64u(ageEncrypt(randomBytes(32), ring.recovery.recipient)) } };
      refused(`${vault.name}: a wrap the storage made to the public recipient fails the check`, () => readVault({ ...objects, "lumen-e2ee-keyring": B(jdump(forged)) }, { recovery: rkey }));
    }
    if (vault.passkey) {
      const pk = vault.passkey;
      const rp = readVault(objects, { recovery: Buffer.from(pk.prf, "hex"), passkey: pk.id });
      check(`${vault.name}: the passkey's PRF output alone opens epoch ${rp.epoch} and every file`, rp.epoch === r.epoch && same(rp.secret, r.secret) && sameFiles(rp.files, vault.expect.files));
      refused(`${vault.name}: another PRF output is refused`, () => readVault(objects, { recovery: Buffer.alloc(32), passkey: pk.id }));
    }
    if (vault.device) {
      const rd = readVault(objects, { device: vault.device });
      check(`${vault.name}: the enrolled device opens it with its own key (age)`, rd.epoch === r.epoch && sameFiles(rd.files, vault.expect.files));
    }
    refused(`${vault.name}: a wrong passphrase is refused`, () => readVault(objects, { passphrase: vault.passphrase + "x" }));
  }

  for (const a of v.argon2id) {
    const tag = argon2id({ password: Buffer.from(a.password, "base64"), salt: Buffer.from(a.salt, "base64"), memoryKiB: a.memoryKiB, iterations: a.iterations, parallelism: a.parallelism });
    check(`argon2id m=${a.memoryKiB} t=${a.iterations} p=${a.parallelism}`, B(tag).toString("base64") === a.tag);
  }
  for (const a of v.age) {
    const pt = ageDecrypt(Buffer.from(a.file, "base64"), { identity: a.identity, passphrase: a.passphrase });
    check(`age (${"passphrase" in a ? "scrypt" : "X25519"}, ${pt.length} bytes)`, pt.toString("base64") === a.plaintext);
  }

  const vaultKeys = (index) => {
    const vault = v.vaults[index];
    const objects = objectsOf(vault);
    const vid = JSON.parse(objects["lumen-e2ee-vault"].toString("utf8")).vaultId;
    const r = readVault(objects, { passphrase: vault.passphrase });
    return { vid, epoch: r.epoch, key: subkey(r.secret, vid, "pairing"), ring: r.ring };
  };
  const ringOk = (body, epoch, ring, want) => body.epoch === epoch && (ring === null || (body.ringDigest === ring[0] && body.ringRev === ring[1])) && body.ringDigest === want.ring.digest;
  const shaHex = (s) => sha256(B(s.trim())).toString("hex");

  for (const pv of v.pairing) {
    const { vid, epoch, key, ring } = vaultKeys(pv.vault);
    const body = readPairing(pv.code, "code", epoch, key) ?? {};
    const want = pv.body;
    check(
      `pairing code at epoch ${epoch}: HMAC with the code label under that epoch's key, body, keyring anchor and the issuer's commitment as stated`,
      body.vaultId === vid && body.counter === want.counter && body.digest === want.digest && ringOk(body, epoch, ring, want) && body.commit === want.sas.commit && body.nonce === want.sas.nonce && shaHex(pv.code) === want.sas.session,
    );
  }
  for (const pv of v.pairingTwoWay ?? []) {
    const { vid, epoch, key, ring } = vaultKeys(pv.vault);
    const req = readPairing(pv.request, "request", epoch, key) ?? {};
    const rw = pv.requestBody;
    check(`pairing request at epoch ${epoch}: request label, nonce, manifest and keyring as stated`, req.vaultId === vid && req.nonce === rw.nonce && req.counter === (rw.manifest ?? {}).counter && req.requestedAt === rw.issuedAt && ringOk(req, epoch, ring, rw) && req.commit === rw.commit);
    const ans = readPairing(pv.answer, "answer", epoch, key) ?? {};
    const want = pv.answerBody;
    const sha = shaHex(pv.request);
    check(
      `pairing answer at epoch ${epoch}: answer label, names the request's SHA-256 and nonce, anchors as stated`,
      sha === rw.hash && ans.request === sha && ans.nonce === rw.nonce && ans.counter === want.counter && ans.digest === want.digest && ringOk(ans, epoch, ring, want) && ans.pub === want.sas.pub && shaHex(pv.answer) === want.sas.answer,
    );
    const tail = pv.request.slice(`${PREFIXES.request}${epoch}:`.length);
    check(`pairing request at epoch ${epoch} relabelled as an answer or a code is refused`, readPairing(`${PREFIXES.answer}${epoch}:${tail}`, "answer", epoch, key) === null && readPairing(`${PREFIXES.code}${epoch}:${tail}`, "code", epoch, key) === null);
  }
  for (const sv of v.sas ?? []) {
    const ki = Buffer.from(sv.issuerKey, "hex");
    const kj = Buffer.from(sv.joinerKey, "hex");
    const pubI = rawPub(x25519Priv(ki));
    const pubJ = rawPub(x25519Priv(kj));
    const t = JSON.parse(sv.transcript);
    const shared = x25519(ki, pubJ);
    const agree = same(shared, x25519(kj, pubI));
    const th = sha256(B(sv.transcript));
    const hk = (info, n) => hkdf(shared, th, B(`lumen-pair-sas/1/${info}`), n);
    const n = hk("sas", 4).readUInt32BE(0);
    const symbols = [0, 1, 2, 3, 4].map((i) => (n >>> (26 - 6 * i)) & 63);
    const commit = (pub) => sha256(Buffer.concat([B("lumen-pair-sas/1/commit\0"), pub])).toString("hex");
    const tag = (role, w) => b64u(hmac256(hk(`confirm/${role}`, 32), Buffer.concat([B("lumen-pair-sas/1/confirm-window\0"), th, B(`\0${w}`)])));
    const commits = (sv.commitI == null || sv.commitI === commit(pubI)) && (sv.commitJ == null || sv.commitJ === commit(pubJ));
    const layout = t[0] === "lumen-pair-sas/1" && t[1] === sv.flow && t[11] === b64u(pubI) && t[12] === b64u(pubJ) && t.length === 13;
    check(
      `comparison (${sv.flow}, vault ${sv.vault}): transcript layout, commitments, the five symbols [${symbols.join(", ")}] and both confirmations`,
      agree && layout && commits && jdump(symbols) === jdump(sv.symbols) && tag("issuer", sv.windowIssuer) === sv.confirmIssuer && tag("joiner", sv.windowJoiner) === sv.confirmJoiner,
    );
  }
  const pairs = v.pairing.map((pv, i) => [pv, (v.pairingTwoWay ?? [])[i]]).filter(([, tw]) => tw);
  for (const [pv, tw] of pairs)
    for (const sv of v.sas ?? [])
      if (sv.vault === pv.vault) {
        const t = JSON.parse(sv.transcript);
        const want = sv.flow === "one-way" ? pv.body.sas : tw.answerBody.sas;
        check(`comparison (${sv.flow}, vault ${sv.vault}) is the session of the pairing vector`, t[8] === want.session && t[9] === want.answer && t[10] === want.nonce);
      }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--")) ?? join(HERE, "../../docs/sync-protocol-vectors.json");
  const json = args.includes("--json");
  const results = checkVectors(JSON.parse(readFileSync(file, "utf8")), json ? () => undefined : console.log);
  const ok = results.filter((r) => r.ok).length;
  if (json) console.log(JSON.stringify({ ok, total: results.length, failed: results.filter((r) => !r.ok).map((r) => r.label) }));
  else console.log(`\n${ok}/${results.length} vectors decoded identically (second implementation, node:crypto)`);
  process.exit(ok === results.length && results.length > 0 ? 0 : 1);
}
