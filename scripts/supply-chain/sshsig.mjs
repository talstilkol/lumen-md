/**
 * SSH signatures (the SSHSIG format of OpenSSH's PROTOCOL.sshsig), as git
 * makes them with `gpg.format=ssh` (plan W13.T4). Verified here in Node, so
 * `npm run release:verify` checks a release tag on any machine, with or
 * without ssh-keygen; where ssh-keygen exists, `git verify-tag` is run too.
 *
 * Ed25519 keys only (what `ssh-keygen -t ed25519` makes, and what the
 * allowed_signers file of this repository lists).
 *
 *   signed data = "SSHSIG" ‖ string(namespace) ‖ string(reserved) ‖ string(hash) ‖ string(H(message))
 *   blob        = "SSHSIG" ‖ uint32(1) ‖ string(publickey) ‖ string(namespace) ‖ string(reserved) ‖ string(hash) ‖ string(signature)
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

const MAGIC = Buffer.from("SSHSIG");
const BEGIN = "-----BEGIN SSH SIGNATURE-----";
const END = "-----END SSH SIGNATURE-----";

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const str = (b) => Buffer.concat([u32(b.length), Buffer.isBuffer(b) ? b : Buffer.from(b)]);

function reader(buf) {
  let i = 0;
  return {
    u32() {
      if (i + 4 > buf.length) throw new Error("truncated");
      const n = buf.readUInt32BE(i);
      i += 4;
      return n;
    },
    bytes(n) {
      if (i + n > buf.length) throw new Error("truncated");
      const b = buf.subarray(i, i + n);
      i += n;
      return b;
    },
    string() {
      return this.bytes(this.u32());
    },
    done: () => i === buf.length,
  };
}

/** The 32-byte Ed25519 key of an SSH public key blob ("ssh-ed25519" ‖ key). */
export function ed25519FromBlob(blob) {
  const r = reader(blob);
  const type = r.string().toString();
  if (type !== "ssh-ed25519") throw new Error(`only ssh-ed25519 keys are accepted, not ${type}`);
  const key = r.string();
  if (key.length !== 32) throw new Error("an ssh-ed25519 key is 32 bytes");
  return key;
}

/** "ssh-ed25519 AAAA… comment" → the key blob. */
export function blobFromPublicLine(line) {
  const [type, b64] = String(line).trim().split(/\s+/);
  if (type !== "ssh-ed25519" || !b64) throw new Error(`not an ssh-ed25519 public key: ${String(line).slice(0, 40)}`);
  const blob = Buffer.from(b64, "base64");
  if (ed25519FromBlob(blob) && blob.length) return blob;
  throw new Error("bad key");
}

const nodeKey = (raw) => createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" });

function signedData(namespace, hashAlg, message) {
  const h = createHash(hashAlg === "sha512" ? "sha512" : "sha256").update(message).digest();
  return Buffer.concat([MAGIC, str(namespace), str(""), str(hashAlg), str(h)]);
}

/** Parse an armored SSH signature → { publicKey (blob), namespace, hashAlg, signature (64 bytes) }. */
export function parseSshSig(armored) {
  const text = String(armored);
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error("no SSH SIGNATURE block");
  const blob = Buffer.from(text.slice(a + BEGIN.length, b).replace(/\s+/g, ""), "base64");
  const r = reader(blob);
  if (!r.bytes(6).equals(MAGIC)) throw new Error("not an SSHSIG blob");
  const version = r.u32();
  if (version !== 1) throw new Error(`SSHSIG version ${version}`);
  const publicKey = r.string();
  const namespace = r.string().toString();
  r.string(); // reserved
  const hashAlg = r.string().toString();
  const sigBlob = r.string();
  if (!r.done()) throw new Error("trailing bytes after the signature");
  const s = reader(sigBlob);
  const sigType = s.string().toString();
  if (sigType !== "ssh-ed25519") throw new Error(`signature type ${sigType}`);
  const signature = s.string();
  if (signature.length !== 64) throw new Error("an Ed25519 signature is 64 bytes");
  if (!["sha256", "sha512"].includes(hashAlg)) throw new Error(`hash ${hashAlg}`);
  return { publicKey, namespace, hashAlg, signature };
}

/** Does `armored` sign `message` in `namespace`? → { ok, publicKey, problem } */
export function verifySshSig(message, armored, namespace = "git") {
  let p;
  try {
    p = parseSshSig(armored);
  } catch (e) {
    return { ok: false, publicKey: null, problem: e.message };
  }
  if (p.namespace !== namespace) return { ok: false, publicKey: p.publicKey, problem: `signed for namespace "${p.namespace}", not "${namespace}"` };
  let raw;
  try {
    raw = ed25519FromBlob(p.publicKey);
  } catch (e) {
    return { ok: false, publicKey: p.publicKey, problem: e.message };
  }
  const ok = verify(null, signedData(namespace, p.hashAlg, message), nodeKey(raw), p.signature);
  return { ok, publicKey: p.publicKey, problem: ok ? null : "the signature does not match the tag" };
}

/** Make an armored SSH signature with an Ed25519 private key (PEM, node:crypto): tests and the dry run only. */
export function signSshSig(message, privatePem, namespace = "git") {
  const key = createPrivateKey(privatePem);
  const raw = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32);
  const pub = Buffer.concat([str("ssh-ed25519"), str(raw)]);
  const sig = sign(null, signedData(namespace, "sha512", message), key);
  const blob = Buffer.concat([MAGIC, u32(1), str(pub), str(namespace), str(""), str("sha512"), str(Buffer.concat([str("ssh-ed25519"), str(sig)]))]);
  const b64 = blob.toString("base64").match(/.{1,70}/g).join("\n");
  return { armored: `${BEGIN}\n${b64}\n${END}\n`, publicLine: `ssh-ed25519 ${pub.toString("base64")}` };
}

/**
 * git's allowed_signers file: `principals [namespaces="…"] [valid-after=…] ssh-ed25519 KEY [comment]`.
 * → [{ principals, namespaces: string[] | null, validAfter, validBefore, key (blob) }]; other key types are skipped.
 */
export function parseAllowedSigners(text) {
  const out = [];
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const principals = m[1].split(",");
    let rest = m[2];
    const opts = {};
    while (!/^(ssh-|ecdsa-|sk-)/.test(rest)) {
      const o = /^([\w-]+)(?:="([^"]*)")?,?\s*/.exec(rest);
      if (!o || !o[0]) break;
      opts[o[1]] = o[2] ?? true;
      rest = rest.slice(o[0].length);
    }
    try {
      out.push({ principals, namespaces: typeof opts.namespaces === "string" ? opts.namespaces.split(",") : null, validAfter: opts["valid-after"] ?? null, validBefore: opts["valid-before"] ?? null, key: blobFromPublicLine(rest) });
    } catch {
      // why: not an ssh-ed25519 line (this repository signs with Ed25519 only)
    }
  }
  return out;
}

/** Split a raw tag object (`git cat-file tag X`) into the signed payload and its SSH signature. */
export function splitSignedTag(raw) {
  const text = String(raw);
  const at = text.indexOf(BEGIN);
  if (at < 0) return { payload: text, signature: null };
  return { payload: text.slice(0, at), signature: text.slice(at) };
}

/**
 * Is this tag object signed by an allowed signer, for git?
 * → { ok, signer (principals), problems }
 */
export function verifyTag(raw, allowedText, { now = new Date() } = {}) {
  const problems = [];
  const { payload, signature } = splitSignedTag(raw);
  if (!/^object [0-9a-f]{40,64}\ntype commit\ntag \S+\n/.test(payload)) problems.push("not a tag object of a commit");
  if (!signature) return { ok: false, signer: null, problems: [...problems, "the tag is not signed (git tag -s with gpg.format=ssh)"] };
  const allowed = parseAllowedSigners(allowedText);
  if (!allowed.length) return { ok: false, signer: null, problems: [...problems, "security/allowed_signers lists no ssh-ed25519 key"] };
  const v = verifySshSig(Buffer.from(payload), signature, "git");
  if (!v.ok) return { ok: false, signer: null, problems: [...problems, v.problem] };
  const stamp = (s) => (s ? Date.parse(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`) : NaN);
  const who = allowed.find((a) => a.key.equals(v.publicKey) && (!a.namespaces || a.namespaces.includes("git")) && !(stamp(a.validAfter) > now.getTime()) && !(stamp(a.validBefore) <= now.getTime()));
  if (!who) return { ok: false, signer: null, problems: [...problems, "signed by a key that security/allowed_signers does not allow for git"] };
  return { ok: problems.length === 0, signer: who.principals.join(","), problems };
}
