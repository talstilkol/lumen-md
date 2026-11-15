/**
 * Role spaces on the vault relay (plan W12.S4): a family or classroom vault
 * with roles and no accounts. Mounted by vault-relay.js, so the Node relay and
 * the Cloudflare Worker (edge-workers/vault-relay, which runs vault-relay.js
 * unchanged) enforce the same rules.
 *
 *   Bearer r.<t>   the role space of token t. Every member holds t (it only
 *                  names the space); what a member may write is decided by a
 *                  signature, never by the token.
 *
 * The access list (ACL), object `lumen-role-acl`, is the one thing the relay
 * reads in a role space:
 *
 *   body = JSON {"v":1, "acl":"<b64u acl bytes>", "sig":"<b64u Ed25519>"}
 *   sig  = Ed25519(admin, "lumen-role-acl v1\n" ‖ acl bytes)
 *   acl  = JSON {v:1, kind:"lumen-role-acl", space:<hex space id>, seq,
 *                admin:<b64u key>, members:{<id>: {role, sign?, scope?, recipient?}},
 *                revoked:[{id, sign?, seq}]}
 *
 *   - The first ACL opens the space (seq 0, signed by its own admin key:
 *     whoever opens the space is its admin; members pin that key from their
 *     invite). Each next one must be signed by the same admin key, keep it as
 *     the admin, carry seq + 1, keep every revoked key revoked, drop no key
 *     without revoking it, and list no revoked key as a member. So an old ACL
 *     can't be replayed, and a revoked key can't be let back in.
 *
 * Every other write (PUT and DELETE) must carry a writer's signed envelope
 * (src/sync/e2ee/roles/envelope.ts builds it, byte for byte the same):
 *
 *   envelope = "LRS1" ‖ op (0 put, 1 delete) ‖ signer (32) ‖ ctr (8, BE)
 *              ‖ aclSeq (4, BE) ‖ condLen (1) ‖ cond ‖ sig (64) ‖ payload
 *   signed   = "lumen-role v1\n<space>\n<put|del>\n<name>\n<cond>\n<ctr>\n<aclSeq>\n" ‖ SHA-256(payload)
 *   cond     = "" | "none:*" | "match:<etag>": the request's own condition
 *
 * A PUT's body is the envelope (the relay stores it whole, so every reader can
 * check the signature too); a DELETE sends it in `X-Lumen-Role` (base64url).
 * The relay refuses (403) unless:
 *   - the signature verifies, for this space, op, name and condition;
 *   - aclSeq is the current ACL's seq (409 "acl" otherwise: the client reads
 *     the ACL again), so nothing signed under an earlier ACL lands after it;
 *   - the signer is a current member's key and may write this name:
 *       `lumen-e2ee-keyring`, `lumen-e2ee-vault`   the admin only (re-key, passphrase)
 *       `p-<slot>-…`                               the admin, or the member whose scope is `p-<slot>-`
 *       `j-…`                                      a join request: no signature, create-only, small
 *       anything else                              the admin and writers
 *     (a reader may hold a key for its own `p-` folder and nothing else);
 *   - ctr is above the last ctr this signer used (409 "replay", with the last
 *     ctr), so a captured request can't be sent again.
 * The counters live in the space's internal object `~role` (a name no client
 * can address).
 */

const crypto = require("crypto");

const ACL_NAME = "lumen-role-acl";
const STATE_NAME = "~role";
const ADMIN_ONLY = new Set(["lumen-e2ee-keyring", "lumen-e2ee-vault"]);
const MAGIC = Buffer.from("LRS1", "latin1");
const HEAD = 4 + 1 + 32 + 8 + 4 + 1;
const SIG = 64;
const MAX_COND = 100;
const MAX_MEMBERS = 256;
const MAX_REVOKED = 1024;
const MAX_ACL_BYTES = 128 * 1024;
const MAX_JOIN_BYTES = 8 * 1024;
const MAX_JOINS = 64;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const SCOPE = /^p-[A-Za-z0-9_-]{22}-$/;
const ROLES = new Set(["admin", "writer", "reader"]);

const charge = (n) => Math.max(1, Math.ceil(n / 4096)) * 4096;
const subtle = (globalThis.crypto && globalThis.crypto.subtle) || crypto.webcrypto.subtle;
const b64u = (b) => Buffer.from(b).toString("base64url");
const fromB64u = (s) => (typeof s === "string" && /^[A-Za-z0-9_-]*$/.test(s) ? Buffer.from(s, "base64url") : null);

/** The personal-folder prefix of an object name (`p-<22>-`), or null. */
const scopeOf = (name) => (/^p-[A-Za-z0-9_-]{22}-/.test(name) ? name.slice(0, 25) : null);

/** Ed25519 verification through WebCrypto (Node ≥ 20 and Workers both have it). */
async function verifyEd25519(pub, sig, data) {
  try {
    const key = await subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    return await subtle.verify({ name: "Ed25519" }, key, sig, data);
  } catch {
    return false;
  }
}

/** The condition string a request carries, as the envelope must name it. */
function condOf(headers) {
  if (headers["if-none-match"] === "*") return "none:*";
  const m = headers["if-match"];
  return typeof m === "string" && m ? `match:${m}` : "";
}

/** The bytes a writer signs. */
function signedBytes(space, op, name, cond, ctr, aclSeq, payload) {
  const head = Buffer.from(`lumen-role v1\n${space}\n${op === 1 ? "del" : "put"}\n${name}\n${cond}\n${ctr}\n${aclSeq}\n`, "utf8");
  return Buffer.concat([head, crypto.createHash("sha256").update(payload).digest()]);
}

/** An envelope's fields, or null when it isn't one. */
function parseEnvelope(buf) {
  if (!buf || buf.length < HEAD + SIG || !buf.subarray(0, 4).equals(MAGIC)) return null;
  const op = buf[4];
  if (op !== 0 && op !== 1) return null;
  const signer = buf.subarray(5, 37);
  const hi = buf.readUInt32BE(37);
  const lo = buf.readUInt32BE(41);
  if (hi > 0x1fffff) return null; // ctr ≤ 2^53 - 1
  const ctr = hi * 2 ** 32 + lo;
  const aclSeq = buf.readUInt32BE(45);
  const condLen = buf[49];
  if (condLen > MAX_COND || buf.length < HEAD + condLen + SIG) return null;
  const cond = buf.subarray(HEAD, HEAD + condLen).toString("latin1");
  if (!/^[\x20-\x7e]*$/.test(cond)) return null;
  const sig = buf.subarray(HEAD + condLen, HEAD + condLen + SIG);
  return { op, signer, ctr, aclSeq, cond, sig, payload: buf.subarray(HEAD + condLen + SIG) };
}

/** A parsed, shape-checked ACL, or null. */
function parseAcl(bytes) {
  let a;
  try {
    a = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return null;
  }
  if (!a || typeof a !== "object" || a.v !== 1 || a.kind !== ACL_NAME) return null;
  if (typeof a.space !== "string" || !/^[0-9a-f]{64}$/.test(a.space)) return null;
  if (!Number.isInteger(a.seq) || a.seq < 0 || a.seq > 0xffffffff) return null;
  if (typeof a.admin !== "string" || !KEY.test(a.admin)) return null;
  if (!a.members || typeof a.members !== "object" || Array.isArray(a.members) || !Array.isArray(a.revoked)) return null;
  const ids = Object.keys(a.members);
  if (ids.length > MAX_MEMBERS || a.revoked.length > MAX_REVOKED) return null;
  const signs = new Set();
  for (const id of ids) {
    const m = a.members[id];
    if (!ID.test(id) || !m || typeof m !== "object" || !ROLES.has(m.role)) return null;
    if (m.sign !== undefined && (typeof m.sign !== "string" || !KEY.test(m.sign))) return null;
    if (m.scope !== undefined && (typeof m.scope !== "string" || !SCOPE.test(m.scope))) return null;
    if (m.role === "admin" && m.sign !== a.admin) return null;
    if (m.role !== "admin" && m.sign === a.admin) return null;
    if (m.sign !== undefined) {
      if (signs.has(m.sign)) return null;
      signs.add(m.sign);
    }
  }
  for (const r of a.revoked) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !ID.test(r.id) || !Number.isInteger(r.seq)) return null;
    if (r.sign !== undefined && (typeof r.sign !== "string" || !KEY.test(r.sign))) return null;
    // A revoked key is never a member again, and never the admin.
    if (r.sign !== undefined && (signs.has(r.sign) || r.sign === a.admin)) return null;
  }
  return a;
}

/** Who a key is in an ACL: { admin, scope, writer } or null. */
function keyIn(acl, signer) {
  const k = b64u(signer);
  if (k === acl.admin) return { admin: true, writer: true, scope: null };
  for (const m of Object.values(acl.members)) if (m.sign === k) return { admin: false, writer: m.role === "writer", scope: m.scope ?? null };
  return null;
}

/** May this member write (or delete) `name`? */
function allowed(who, name) {
  if (who.admin) return true;
  if (ADMIN_ONLY.has(name) || name === ACL_NAME || name.startsWith("j-")) return false;
  const scope = scopeOf(name);
  if (scope) return who.scope === scope;
  if (name.startsWith("p-")) return false;
  return who.writer;
}

function roleGate(store) {
  const readJson = async (space, name) => {
    const o = await store.get(space, name);
    if (!o) return null;
    try {
      return JSON.parse(Buffer.from(o.data).toString("utf8"));
    } catch {
      return null;
    }
  };
  /** The space's current ACL (as stored, already checked when it was written), or null. */
  const currentAcl = async (space) => {
    const o = await readJson(space, ACL_NAME);
    const bytes = o && fromB64u(o.acl);
    return bytes ? parseAcl(bytes) : null;
  };

  /** Checks a new ACL body against the current one; returns a refusal [status, error] or null. */
  async function checkAcl(space, data) {
    if (data.length > MAX_ACL_BYTES) return [413, "acl too large"];
    let body;
    try {
      body = JSON.parse(Buffer.from(data).toString("utf8"));
    } catch {
      return [400, "acl"];
    }
    const bytes = body && body.v === 1 ? fromB64u(body.acl) : null;
    const sig = body ? fromB64u(body.sig) : null;
    const acl = bytes && parseAcl(bytes);
    if (!acl || !sig || sig.length !== SIG) return [400, "acl"];
    if (acl.space !== space) return [403, "acl space"];
    const prev = await currentAcl(space);
    const signer = Buffer.from(prev ? prev.admin : acl.admin, "base64url");
    if (!(await verifyEd25519(signer, sig, Buffer.concat([Buffer.from("lumen-role-acl v1\n"), bytes])))) return [403, "acl signature"];
    if (!prev) return acl.seq === 0 ? null : [403, "acl seq"];
    if (acl.seq !== prev.seq + 1) return [409, "acl seq"];
    // The admin key is the space's for good (members pin it from their invite): no takeover by a later ACL.
    if (acl.admin !== prev.admin) return [403, "acl admin"];
    const kept = new Set(acl.revoked.map((r) => r.sign).filter(Boolean));
    for (const r of prev.revoked) if (r.sign && !kept.has(r.sign)) return [403, "acl unrevoke"];
    // A key that left the list without being revoked would come back in a later ACL unnoticed: refused.
    const now = new Set([acl.admin, ...Object.values(acl.members).map((m) => m.sign)].filter(Boolean));
    for (const m of [{ sign: prev.admin }, ...Object.values(prev.members)]) if (m.sign && !now.has(m.sign) && !kept.has(m.sign)) return [403, "acl dropped key"];
    return null;
  }

  /**
   * Authorize one write to a role space. Returns { verdict: [status, error, extra?] }
   * for a refusal, or { payload, commit } where commit() records the counter
   * (awaited under the space's lock, just before the object is written) and
   * resolves with the bytes that cost (the relay's total counts them).
   */
  async function authorize(space, method, name, headers, data) {
    if (name === ACL_NAME) {
      if (method !== "PUT") return { verdict: [403, "acl"] };
      const no = await checkAcl(space, data);
      return no ? { verdict: no } : { payload: data, commit: async () => 0 };
    }
    const acl = await currentAcl(space);
    if (!acl) return { verdict: [403, "no acl"] };
    if (name.startsWith("j-") && method === "PUT" && !(data.length >= 4 && data.subarray(0, 4).equals(MAGIC))) {
      // A join request: anyone holding the link may leave one, small and create-only (the admin reads and deletes them).
      if (headers["if-none-match"] !== "*") return { verdict: [403, "join create-only"] };
      if (data.length > MAX_JOIN_BYTES) return { verdict: [413, "join too large"] };
      if ((await store.list(space)).filter((n) => n.startsWith("j-")).length >= MAX_JOINS) return { verdict: [507, "joins full"] };
      return { payload: data, commit: async () => 0 };
    }
    const raw = method === "PUT" ? data : fromB64u(headers["x-lumen-role"]);
    const env = parseEnvelope(raw);
    if (!env) return { verdict: [403, "signature required"] };
    if (env.op !== (method === "PUT" ? 0 : 1)) return { verdict: [403, "signature op"] };
    if (method === "DELETE" && env.payload.length) return { verdict: [403, "signature op"] };
    if (env.cond !== condOf(headers)) return { verdict: [403, "signature condition"] };
    if (env.aclSeq !== acl.seq) return { verdict: [409, "acl", { seq: acl.seq }] };
    const who = keyIn(acl, env.signer);
    if (!who) return { verdict: [403, "not a writer"] };
    if (!allowed(who, name)) return { verdict: [403, "role"] };
    if (!(await verifyEd25519(env.signer, env.sig, signedBytes(space, env.op, name, env.cond, env.ctr, env.aclSeq, env.payload)))) {
      return { verdict: [403, "signature"] };
    }
    const signer = b64u(env.signer);
    const state = (await readJson(space, STATE_NAME)) || { ctr: {} };
    const last = Number(state.ctr?.[signer] ?? 0);
    if (env.ctr <= last) return { verdict: [409, "replay", { ctr: last }] };
    return {
      payload: data,
      commit: async () => {
        // Read again under the space's lock (the caller holds it), drop keys that left the ACL, record this ctr.
        const s = (await readJson(space, STATE_NAME)) || { ctr: {} };
        const live = new Set([acl.admin, ...Object.values(acl.members).map((m) => m.sign)].filter(Boolean));
        const ctr = {};
        for (const [k, v] of Object.entries(s.ctr || {})) if (live.has(k)) ctr[k] = v;
        if (Number(ctr[signer] ?? 0) >= env.ctr) throw Object.assign(new Error("replay"), { status: 409 });
        ctr[signer] = env.ctr;
        const old = await store.get(space, STATE_NAME);
        const next = Buffer.from(JSON.stringify({ ctr }));
        await store.put(space, STATE_NAME, next);
        // What the counters cost on disk, for the relay's own byte total (they are charged like any object).
        return charge(next.length) - (old ? charge(old.data.length) : 0);
      },
    };
  }

  return { authorize, currentAcl };
}

/** Names a role space lists (its internal state is not one). */
const listable = (name) => name !== STATE_NAME;

module.exports = { roleGate, parseEnvelope, parseAcl, signedBytes, condOf, scopeOf, allowed, listable, ACL_NAME, STATE_NAME, ADMIN_ONLY, MAX_JOIN_BYTES };
