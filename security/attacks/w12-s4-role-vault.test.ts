/**
 * W12.S4 attack suite: family and classroom vaults with roles, no accounts.
 * Three clients (admin, writer, reader) on the real engine, against both
 * relays: the Node relay (sync-server/vault-relay.js over HTTP) and the
 * Cloudflare Worker (edge-workers/vault-relay, Durable Object simulation).
 * Every test asserts the secure outcome: a FAIL means the attack worked.
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from "vitest";
import { concat, toB64u, utf8 } from "../../src/sync/e2ee/bytes";
import { KEYRING_NAME, RevokedError } from "../../src/sync/e2ee/keyring";
import { manifestName, openManifest } from "../../src/sync/e2ee/manifest";
import { DecryptError } from "../../src/sync/e2ee/keys";
import { unlockWithDevice } from "../../src/sync/e2ee/engine";
import { ACL_NAME, signAcl, withMember, type Acl } from "../../src/sync/e2ee/roles/acl";
import { newSigner, parseEnvelope, sealEnvelope, signBytes } from "../../src/sync/e2ee/roles/envelope";
import { RoleRefusedError, RoleSignatureError, roleProvider } from "../../src/sync/e2ee/roles/provider";
import { putPersonal, readPersonal, revokeMember } from "../../src/sync/e2ee/roles/vault";
import { nodeRelay, recording, resend, threeClients, workerRelay, type RelayHost } from "../../src/__tests__/helpers/roleRelay";
import type { FetchLike } from "../../src/sync/e2ee/providers/http";

const hosts: RelayHost[] = [];
afterEach(async () => {
  while (hosts.length) await hosts.pop()!.close();
});
const relays: Array<[string, () => Promise<RelayHost>]> = [
  ["node relay", nodeRelay],
  ["worker relay", workerRelay],
];
const up = async (make: () => Promise<RelayHost>) => {
  const h = await make();
  hosts.push(h);
  return h;
};

/** A raw request with the space token, as anyone holding the invite link could send. */
function raw(f: FetchLike, url: string, token: string, method: string, name: string, body?: Uint8Array, headers: Record<string, string> = {}) {
  return f(`${url}/v1/vault/o/${encodeURIComponent(name)}`, { method, headers: { Authorization: `Bearer r.${token}`, ...headers }, body: body as BodyInit | undefined });
}
const errorOf = async (res: Response) => ((await res.json().catch(() => ({}))) as { error?: string }).error;
const names = async (v: { admin: { provider: { listAll(): Promise<string[]> } } }) => (await v.admin.provider.listAll()).sort();

describe.each(relays)("W12.S4 role vault attacks (%s)", (_label: string, make: () => Promise<RelayHost>) => {
  it("baseline: the writer's note reaches the reader and the admin", async () => {
    const v = await threeClients(await up(make));
    v.writer.files.set("family/shopping.md", "חלב, לחם");
    await v.writer.sync.sync();
    await v.reader.sync.sync();
    await v.admin.sync.sync();
    expect(v.reader.files.text("family/shopping.md")).toBe("חלב, לחם");
    expect(v.admin.files.text("family/shopping.md")).toBe("חלב, לחם");
  });

  it("A1 reader tries to write: its sync is refused at the relay and nothing on the relay changes", async () => {
    const v = await threeClients(await up(make));
    v.writer.files.set("a.md", "from the writer");
    await v.writer.sync.sync();
    await v.reader.sync.sync();
    const before = await names(v);
    const acl = (await v.admin.provider.getRaw(ACL_NAME))!.etag;
    v.reader.files.set("a.md", "the reader's overwrite");
    v.reader.files.set("b.md", "the reader's new note");
    await expect(v.reader.sync.sync()).rejects.toBeInstanceOf(RoleRefusedError);
    expect(await names(v)).toEqual(before);
    expect((await v.admin.provider.getRaw(ACL_NAME))!.etag).toBe(acl);
    // Straight to the relay, unsigned: refused whatever the name.
    for (const name of ["a-blob-name-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", KEYRING_NAME, (await names(v)).find((n) => n.startsWith("p-")) ?? "p-xxxxxxxxxxxxxxxxxxxxxx-a"]) {
      const res = await raw(v.relay.fetch, v.relay.url, v.ref.token, "PUT", name, new Uint8Array(64));
      expect(res.status, name).toBe(403);
      expect(await errorOf(res)).toBe("signature required");
    }
    expect((await raw(v.relay.fetch, v.relay.url, v.ref.token, "DELETE", before.find((n) => n !== ACL_NAME)!)).status).toBe(403);
    expect(await names(v)).toEqual(before);
    // The writer's note is intact for everyone.
    await v.admin.sync.sync();
    expect(v.admin.files.text("a.md")).toBe("from the writer");
  });

  it("A2 reader signs with a key of its own (or its personal-folder key) outside what the ACL allows: refused", async () => {
    const v = await threeClients(await up(make), {}, { readerPersonal: true });
    const space = await v.admin.provider.space();
    const seq = (await v.admin.provider.acl(true)).seq;
    const own = await newSigner();
    const name = "blob-of-the-reader-xxxxxxxxxxxxxxxxxxxxxxxx";
    for (const [signer, expected] of [
      [own, "not a writer"],
      [v.reader.keys.signer!, "role"],
    ] as const) {
      const env = await sealEnvelope(signer, { space, op: "put", name, cond: "", ctr: Date.now() * 1000, aclSeq: seq, payload: utf8("x") });
      const res = await raw(v.relay.fetch, v.relay.url, v.ref.token, "PUT", name, env);
      expect(res.status).toBe(403);
      expect(await errorOf(res)).toBe(expected);
    }
    // The reader's key writes its own folder only; the writer can't write there, the reader not in another's.
    const scope = v.reader.keys.scope!;
    await putPersonal(v.reader.provider, { scope, recipient: v.reader.keys.age.recipient, adminRecipient: v.ref.adminRecipient }, "diary.md", "mine");
    await expect(putPersonal(v.writer.provider, { scope, recipient: v.writer.keys.age.recipient, adminRecipient: v.ref.adminRecipient }, "diary.md", "the writer's")).rejects.toMatchObject({ status: 403, code: "role" });
    await expect(v.reader.provider.put(KEYRING_NAME, new Uint8Array(32))).rejects.toMatchObject({ status: 403, code: "role" });
    await expect(v.writer.provider.put(KEYRING_NAME, new Uint8Array(32))).rejects.toMatchObject({ status: 403, code: "role" });
    // Only the reader and the admin read the folder; the writer (who holds the vault's read key) can't.
    expect((await readPersonal(v.admin.provider, scope, v.admin.keys.age.identity)).map((n) => n.text)).toEqual(["mine"]);
    expect((await readPersonal(v.reader.provider, scope, v.reader.keys.age.identity)).map((n) => n.text)).toEqual(["mine"]);
    expect(await readPersonal(v.writer.provider, scope, v.writer.keys.age.identity)).toEqual([]);
  });

  it("A3 a revoked device tries to write: refused at the relay, and it can't decrypt an update made after", async () => {
    const rec = recording((await up(make)).fetch);
    const v = await threeClients(hosts.at(-1)!, { writer: rec.fetch });
    v.writer.files.set("n.md", "before");
    await v.writer.sync.sync();
    const oldKeys = v.writer.sync.keys();
    await revokeMember(v.adminCtx, "writer");
    v.admin.files.set("n.md", "after the revocation");
    await v.admin.sync.sync();
    // Its signed writes are refused (it reads the new ACL on the 409 and tries again: "not a writer").
    v.writer.files.set("n.md", "the revoked device's write");
    await expect(v.writer.sync.sync()).rejects.toBeTruthy();
    await expect(v.writer.provider.put("blob-from-revoked-xxxxxxxxxxxxxxxxxxxxxxxxx", new Uint8Array(32))).rejects.toMatchObject({ status: 403, code: "not a writer" });
    const space = await v.admin.provider.space();
    const env = await sealEnvelope(v.writer.keys.signer!, { space, op: "put", name: "zz-revoked", cond: "", ctr: Date.now() * 1000 + 99, aclSeq: (await v.admin.provider.acl(true)).seq, payload: new Uint8Array(8) });
    const res = await raw(v.relay.fetch, v.relay.url, v.ref.token, "PUT", "zz-revoked", env);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("not a writer");
    // The keyring has no wrap for it any more, and its old keys don't open the new manifest.
    await expect(unlockWithDevice(v.admin.provider, "writer", v.writer.keys.age.identity)).rejects.toBeInstanceOf(RevokedError);
    const name = await manifestName(v.admin.sync.keys());
    expect(name).not.toBe(await manifestName(oldKeys));
    const sealed = await v.admin.provider.get(name);
    await expect(openManifest(oldKeys, sealed!.data, name)).rejects.toBeInstanceOf(DecryptError);
    // The reader still follows.
    await v.reader.sync.sync();
    expect(v.reader.files.text("n.md")).toBe("after the revocation");
    // And no later ACL can let the revoked key back in.
    const acl = await v.admin.provider.acl(true);
    const back: Acl = { ...acl, seq: acl.seq + 1, members: { ...acl.members, again: { role: "writer", sign: v.writer.keys.signer!.pub } }, revoked: acl.revoked.filter((r) => r.id !== "writer") };
    const r2 = await raw(v.relay.fetch, v.relay.url, v.ref.token, "PUT", ACL_NAME, await signAcl(back, v.adminCtx.signer));
    expect(r2.status).toBe(403);
    expect(await errorOf(r2)).toBe("acl unrevoke");
  });

  it("A4 replay: a captured signed write, delete or ACL sent again is refused", async () => {
    const rec = recording((await up(make)).fetch);
    const v = await threeClients(hosts.at(-1)!, { writer: rec.fetch });
    rec.writes.length = 0;
    v.writer.files.set("r.md", "one");
    await v.writer.sync.sync();
    const put = rec.writes.find((w) => w.method === "PUT" && w.body && parseEnvelope(w.body) && (w.headers["if-match"] || w.headers["if-none-match"]))!;
    expect(put).toBeTruthy();
    // A conditional write sent again: its condition no longer holds (412), and it is not stored twice.
    let res = await resend(v.relay.fetch, put);
    expect(res.status).toBe(412);
    // An unconditional signed write, sent again as it was: the counter was used (409 replay).
    const blind = "unconditional-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    await v.writer.provider.put(blind, utf8("v1"));
    const once = rec.writes.at(-1)!;
    await v.writer.provider.put(blind, utf8("v2"));
    res = await resend(v.relay.fetch, once);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("replay");
    expect(new TextDecoder().decode((await v.admin.provider.get(blind))!.data)).toBe("v2");
    // To another name: the signature doesn't hold.
    res = await resend(v.relay.fetch, once, { url: once.url.replace(/o\/[^/]+$/, "o/another-name-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx") });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("signature");
    // With its condition taken off: refused (the condition is signed).
    const h = { ...put.headers };
    delete h["if-none-match"];
    delete h["if-match"];
    res = await resend(v.relay.fetch, put, { headers: h });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("signature condition");
    // A captured delete, sent again after the object came back.
    const blob = "replayed-delete-xxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    await v.writer.provider.put(blob, new Uint8Array(16), { ifNoneMatch: "*" });
    await v.writer.provider.delete(blob);
    const del = rec.writes.filter((w) => w.method === "DELETE").at(-1)!;
    await v.admin.provider.put(blob, new Uint8Array(16), { ifNoneMatch: "*" });
    res = await resend(v.relay.fetch, del);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("replay");
    expect(await v.admin.provider.get(blob)).not.toBeNull();
    // An older ACL sent again (it listed the reader before the change below).
    const old = (await v.admin.provider.getRaw(ACL_NAME))!.data;
    const acl = await v.admin.provider.acl(true);
    await v.admin.provider.putAcl(withMember(acl, "guest", { role: "reader" }), v.adminCtx.signer);
    res = await raw(v.relay.fetch, v.relay.url, v.ref.token, "PUT", ACL_NAME, old);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("acl seq");
    // A write signed under the earlier ACL (its seq) lands no more.
    const space = await v.admin.provider.space();
    const stale = await sealEnvelope(v.writer.keys.signer!, { space, op: "put", name: "stale-acl-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", cond: "", ctr: Date.now() * 1000 + 7, aclSeq: acl.seq, payload: new Uint8Array(4) });
    res = await raw(v.relay.fetch, v.relay.url, v.ref.token, "PUT", "stale-acl-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", stale);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("acl");
  });

  it("A5 forged signatures: a changed byte, a flipped signature bit, a raised counter or a forged ACL are refused", async () => {
    const rec = recording((await up(make)).fetch);
    const v = await threeClients(hosts.at(-1)!, { writer: rec.fetch });
    const space = await v.admin.provider.space();
    const seq = (await v.admin.provider.acl(true)).seq;
    const name = "forged-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const good = await sealEnvelope(v.writer.keys.signer!, { space, op: "put", name, cond: "", ctr: Date.now() * 1000 + 5, aclSeq: seq, payload: utf8("the writer's bytes") });
    const variants: Array<[string, Uint8Array]> = [];
    const payload = good.slice();
    payload[payload.length - 1] ^= 1;
    variants.push(["payload", payload]);
    const sig = good.slice();
    sig[50 + 0 + 3] ^= 0x80; // inside the signature (cond is empty: the signature starts at 50)
    variants.push(["signature bit", sig]);
    const ctr = good.slice();
    ctr[44] = (ctr[44]! + 1) & 0xff; // the counter's low byte
    variants.push(["counter", ctr]);
    const signer = good.slice();
    signer[5] ^= 1; // the signer key: no longer a member's (or not a point)
    variants.push(["signer", signer]);
    for (const [what, body] of variants) {
      const res = await raw(v.relay.fetch, v.relay.url, v.ref.token, "PUT", name, body);
      expect(res.status, what).toBe(403);
      expect(["signature", "not a writer"], what).toContain(await errorOf(res));
    }
    expect(await v.admin.provider.getRaw(name)).toBeNull();
    // The good one lands (the forgeries burned nothing).
    expect((await raw(v.relay.fetch, v.relay.url, v.ref.token, "PUT", name, good)).status).toBe(201);
    // ACLs: signed by the writer; claiming a new admin; a self-made admin of the attacker's own.
    const acl = await v.admin.provider.acl(true);
    const promote: Acl = { ...acl, seq: acl.seq + 1, members: { ...acl.members, writer: { ...acl.members.writer!, role: "writer" }, mallory: { role: "writer", sign: (await newSigner()).pub } } };
    const promoteBytes = utf8(JSON.stringify(promote));
    const writerSig = await signBytes(v.writer.keys.signer!, concat(utf8("lumen-role-acl v1\n"), promoteBytes));
    const asWriter = utf8(JSON.stringify({ v: 1, acl: toB64u(promoteBytes), sig: toB64u(writerSig) }));
    let res = await raw(v.relay.fetch, v.relay.url, v.ref.token, "PUT", ACL_NAME, asWriter);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("acl signature");
    const mallory = await newSigner();
    const takeover: Acl = { ...acl, seq: acl.seq + 1, admin: mallory.pub, members: { mallory: { role: "admin", sign: mallory.pub } }, revoked: acl.revoked };
    res = await raw(v.relay.fetch, v.relay.url, v.ref.token, "PUT", ACL_NAME, await signAcl(takeover, mallory));
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("acl signature");
    expect((await v.admin.provider.acl(true)).seq).toBe(acl.seq);
  });

  it("A6 a relay (or a reader with it) that serves an object no writer signed: the client refuses it", async () => {
    const v = await threeClients(await up(make));
    v.writer.files.set("x.md", "real");
    await v.writer.sync.sync();
    const target = (await v.writer.provider.list())[0]!;
    const mallory = await newSigner();
    const space = await v.admin.provider.space();
    const forged = await sealEnvelope(mallory, { space, op: "put", name: target, cond: "", ctr: 1, aclSeq: 0, payload: utf8("forged") });
    const evil: FetchLike = async (input, init) => {
      const res = await v.relay.fetch(input, init);
      if ((init?.method ?? "GET") === "GET" && String(input).endsWith(`/o/${encodeURIComponent(target)}`) && res.ok) return new Response(forged as BodyInit, { status: 200, headers: { ETag: '"evil"' } });
      return res;
    };
    const p = roleProvider({ url: v.relay.url, token: v.ref.token, admin: v.ref.admin }, { fetch: evil });
    await expect(p.get(target)).rejects.toBeInstanceOf(RoleSignatureError);
    // A forged ACL (not the pinned admin's) is refused too.
    const evilAcl: FetchLike = async (input, init) => {
      if ((init?.method ?? "GET") === "GET" && String(input).endsWith(`/o/${ACL_NAME}`)) {
        const a = await v.admin.provider.acl(true);
        return new Response((await signAcl({ ...a, admin: mallory.pub, members: { m: { role: "admin", sign: mallory.pub } } }, mallory)) as BodyInit, { status: 200, headers: { ETag: '"evil"' } });
      }
      return v.relay.fetch(input, init);
    };
    await expect(roleProvider({ url: v.relay.url, token: v.ref.token, admin: v.ref.admin }, { fetch: evilAcl }).acl()).rejects.toMatchObject({ code: "admin" });
  });

  it("A7 a role space can't be written before its ACL, and join requests are create-only and small", async () => {
    const h = await up(make);
    const token = toB64u(crypto.getRandomValues(new Uint8Array(32)));
    let res = await raw(h.fetch, h.url, token, "PUT", "first-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", new Uint8Array(16), { "X-Lumen-Pow": "0" });
    expect([403, 428]).toContain(res.status);
    const v = await threeClients(h);
    res = await raw(h.fetch, h.url, v.ref.token, "PUT", "j-request", new Uint8Array(100));
    expect(res.status).toBe(403); // not create-only
    res = await raw(h.fetch, h.url, v.ref.token, "PUT", "j-request", new Uint8Array(9 * 1024), { "If-None-Match": "*" });
    expect(res.status).toBe(413);
    expect((await raw(h.fetch, h.url, v.ref.token, "PUT", "j-request", new Uint8Array(100), { "If-None-Match": "*" })).status).toBe(201);
    expect((await raw(h.fetch, h.url, v.ref.token, "PUT", "j-request", new Uint8Array(100), { "If-None-Match": "*" })).status).toBe(412);
    expect((await raw(h.fetch, h.url, v.ref.token, "DELETE", "j-request")).status).toBe(403);
    await expect(v.writer.provider.delete("j-request")).rejects.toMatchObject({ status: 403, code: "role" });
    // The relay's counters are not an object anyone can name or list.
    expect((await v.admin.provider.listAll()).some((n) => n.startsWith("~"))).toBe(false);
    expect((await raw(h.fetch, h.url, v.ref.token, "GET", "~role")).status).toBe(400);
  });
});
