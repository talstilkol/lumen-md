/**
 * W12.S4: family and classroom vaults with roles, without accounts. Three
 * clients in memory, three roles, on the real engine and on BOTH relays the
 * app ships: the Node relay (sync-server/vault-relay.js over HTTP on
 * 127.0.0.1) and the Cloudflare Worker (edge-workers/vault-relay, in the
 * Durable Object simulation). Invites by link,
 * join requests, the per-device sealed read key, personal folders, and the
 * client's envelope and ACL formats against the relay's own parser.
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { ageDecrypt } from "../sync/e2ee/age";
import { fromB64u, utf8 } from "../sync/e2ee/bytes";
import { createVault, E2eeSync } from "../sync/e2ee/engine";
import { KEYRING_NAME } from "../sync/e2ee/keyring";
import { memoryFiles } from "../sync/e2ee/localFiles";
import { memoryStateStore } from "../sync/e2ee/state";
import { AclError, checkNext, firstAcl, openAcl, signAcl, withMember, withoutMember } from "../sync/e2ee/roles/acl";
import { newSigner, parseEnvelope, sealEnvelope, verifyEnvelope } from "../sync/e2ee/roles/envelope";
import { acceptJoin, inviteHash, newInvite, newMemberKeys, openRoleSpace, parseInviteHash, pendingJoins, putPersonal, readPersonal, requestJoin } from "../sync/e2ee/roles/vault";
import { memberClient, nodeRelay, workerRelay, type RelayHost } from "./helpers/roleRelay";
import { PASSPHRASE, TEST_ITERATIONS } from "./helpers/e2ee";

const require = createRequire(import.meta.url);
const server = require("../../sync-server/vault-relay-roles.js") as {
  parseEnvelope(b: Buffer): { op: number; signer: Buffer; ctr: number; aclSeq: number; cond: string; sig: Buffer; payload: Buffer } | null;
  signedBytes(space: string, op: number, name: string, cond: string, ctr: number, aclSeq: number, payload: Buffer): Buffer;
  parseAcl(b: Uint8Array): unknown;
};

const hosts: RelayHost[] = [];
afterEach(async () => {
  while (hosts.length) await hosts.pop()!.close();
});

describe("role vault: invites, joins and three roles", () => {
  for (const [kind, makeRelay] of [["Node relay", nodeRelay], ["Worker relay", workerRelay]] as const)
  it(`${kind}: an admin invites a writer and a reader by link; each joins with its own keys; the roles hold`, async () => {
    const relay = await makeRelay();
    hosts.push(relay);
    const { ref, admin, provider } = await openRoleSpace(relay.url, { fetch: relay.fetch });
    const { keys, anchor } = await createVault(provider, PASSPHRASE, { pbkdf2Iterations: TEST_ITERATIONS });
    const sync = new E2eeSync({ provider, keys, local: memoryFiles(), store: memoryStateStore() });
    await sync.markCreated(anchor);
    const ctx = { provider, signer: admin.signer!, sync, keys: admin };

    // Two links: one per role and use. No name, no e-mail: the fragment carries the space and the admin's keys.
    const writerInvite = newInvite(ref, "writer");
    const readerInvite = newInvite(ref, "reader", { personal: true });
    const wLink = inviteHash(writerInvite);
    expect(wLink).toMatch(/^#rolevault=[A-Za-z0-9_-]+$/);
    expect(parseInviteHash(wLink)).toEqual(writerInvite);
    expect(() => parseInviteHash("#rolevault=bm90LWpzb24")).toThrow(RangeError);

    // On the joining devices: their own keys, and a join request each.
    const w = await newMemberKeys("writer", { id: "dana" });
    const r = await newMemberKeys("reader", { id: "noa", personal: true });
    await requestJoin(parseInviteHash(wLink), w, { fetch: relay.fetch });
    await requestJoin(parseInviteHash(inviteHash(readerInvite)), r, { fetch: relay.fetch });
    // Someone who has the space token but no invite secret: a forged request, and one asking for a role the link doesn't give.
    await requestJoin({ ...readerInvite, secret: "x".repeat(43) }, await newMemberKeys("writer", { id: "mallory" }), { fetch: relay.fetch });

    // On the admin's device: the checked requests, with the roles the invites name.
    const joins = await pendingJoins({ provider, keys: admin }, [writerInvite, readerInvite]);
    expect(joins.map((j) => [j.request.member, j.invite.role]).sort()).toEqual([
      ["dana", "writer"],
      ["noa", "reader"],
    ]);
    for (const j of joins) await acceptJoin(ctx, j);
    expect((await provider.listAll()).filter((n) => n.startsWith("j-"))).toEqual([]);
    let acl = await provider.acl(true);
    expect(Object.fromEntries(Object.entries(acl.members).map(([id, m]) => [id, m.role]))).toEqual({ admin: "admin", dana: "writer", noa: "reader" });
    expect(acl.members.noa?.scope).toMatch(/^p-[A-Za-z0-9_-]{22}-$/);
    expect(acl.members.mallory).toBeUndefined();
    // A plain reader's link: the joiner sends a signing key anyway, and gets none (the role is the invite's).
    const plain = newInvite(ref, "reader");
    await requestJoin(plain, await newMemberKeys("writer", { id: "eli" }), { fetch: relay.fetch });
    for (const j of await pendingJoins({ provider, keys: admin }, [plain])) await acceptJoin(ctx, j);
    const eli = (await provider.acl(true)).members.eli;
    expect(eli).toEqual({ role: "reader", recipient: eli!.recipient });
    acl = await provider.acl(true);

    // The read key, sealed per device: each wrap in the keyring opens with that device's age key only.
    const ring = JSON.parse(new TextDecoder().decode((await provider.get(KEYRING_NAME))!.data)) as { devices: Record<string, { wrap: string }> };
    expect(Object.keys(ring.devices).sort()).toEqual(["dana", "eli", "noa"]);
    const open = (id: string, identity: string) => ageDecrypt(fromB64u(ring.devices[id]!.wrap), [{ identity }]).then(() => true, () => false);
    expect(await open("dana", w.age.identity)).toBe(true);
    expect(await open("dana", r.age.identity)).toBe(false);
    expect(await open("noa", r.age.identity)).toBe(true);

    // Three clients on the engine: the writer writes, the reader reads, the admin reads.
    const writer = await memberClient(relay, ref, w);
    const reader = await memberClient(relay, ref, { ...r, scope: acl.members.noa!.scope });
    writer.files.set("class/plan.md", "# תוכנית שבועית");
    await writer.sync.sync();
    await reader.sync.sync();
    await sync.sync();
    expect(reader.files.text("class/plan.md")).toBe("# תוכנית שבועית");
    expect(sync.keys().epoch).toBeGreaterThan(0);

    // Noa's personal folder: she and the admin read it; Dana (a writer, with the vault's read key) can't.
    const scope = acl.members.noa!.scope!;
    await putPersonal(reader.provider, { scope, recipient: r.age.recipient, adminRecipient: ref.adminRecipient }, "homework.md", "שיעורי בית", 1000);
    await putPersonal(provider, { scope, recipient: r.age.recipient, adminRecipient: ref.adminRecipient }, "homework.md", "הערת המורה", 2000);
    expect((await readPersonal(reader.provider, scope, r.age.identity)).map((n) => n.text)).toEqual(["הערת המורה"]);
    expect((await readPersonal(provider, scope, admin.age.identity)).map((n) => n.text)).toEqual(["הערת המורה"]);
    expect(await readPersonal(writer.provider, scope, w.age.identity)).toEqual([]);
    // The engine never sees the ACL, the join requests or the personal folders.
    expect((await writer.provider.list()).some((n) => n === "lumen-role-acl" || n.startsWith("p-") || n.startsWith("j-"))).toBe(false);
  });
});

describe("role vault formats: the client and the relay agree", () => {
  it("an envelope the client signs parses and verifies with the relay's own code, byte for byte", async () => {
    const s = await newSigner();
    const space = "ab".repeat(32);
    const payload = utf8("שלום");
    const env = await sealEnvelope(s, { space, op: "put", name: "obj-1", cond: 'match:"0123"', ctr: 2 ** 40 + 5, aclSeq: 7, payload });
    const srv = server.parseEnvelope(Buffer.from(env))!;
    expect(srv).not.toBeNull();
    expect([srv.op, srv.ctr, srv.aclSeq, srv.cond, Buffer.from(srv.payload).toString("utf8")]).toEqual([0, 2 ** 40 + 5, 7, 'match:"0123"', "שלום"]);
    const key = await crypto.subtle.importKey("raw", new Uint8Array(srv.signer), { name: "Ed25519" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "Ed25519" }, key, new Uint8Array(srv.sig), new Uint8Array(server.signedBytes(space, srv.op, "obj-1", srv.cond, srv.ctr, srv.aclSeq, srv.payload)))).toBe(true);
    const mine = parseEnvelope(env)!;
    expect(await verifyEnvelope(mine, space, "obj-1")).toBe(true);
    expect(await verifyEnvelope(mine, space, "obj-2")).toBe(false);
    expect(await verifyEnvelope(mine, "cd".repeat(32), "obj-1")).toBe(false);
    expect(parseEnvelope(env.subarray(0, 60))).toBeNull();
    expect(server.parseEnvelope(Buffer.from(env.subarray(0, 60)))).toBeNull();
  });

  it("the ACL rules: the relay's parser takes what the client signs; the client refuses what the relay refuses", async () => {
    const admin = await newSigner();
    const space = "ef".repeat(32);
    const a0 = firstAcl(space, "admin", admin, "age1" + "q".repeat(58));
    const body = JSON.parse(new TextDecoder().decode(await signAcl(a0, admin))) as { acl: string };
    expect(server.parseAcl(fromB64u(body.acl))).not.toBeNull();
    const w = await newSigner();
    const a1 = withMember(a0, "w", { role: "writer", sign: w.pub });
    expect(() => checkNext(a0, a1)).not.toThrow();
    const a2 = withoutMember(a1, "w");
    expect(a2.revoked).toEqual([{ id: "w", sign: w.pub, seq: 2, role: "writer" }]);
    expect(() => checkNext(a1, a2)).not.toThrow();
    // Back in after a revocation, an old seq again, another admin: refused.
    expect(() => withMember(a2, "w2", { role: "writer", sign: w.pub })).toThrow(AclError);
    expect(() => checkNext(a2, { ...a1, seq: 3 })).toThrow(AclError);
    expect(() => checkNext(a1, { ...a2, admin: w.pub })).toThrow(AclError);
    // Opening: the pinned admin, this space, and never below what was seen.
    const stored = await signAcl(a2, admin);
    expect((await openAcl(stored, { space, admin: admin.pub })).seq).toBe(2);
    await expect(openAcl(stored, { space, admin: w.pub })).rejects.toMatchObject({ code: "admin" });
    await expect(openAcl(stored, { space: "00".repeat(32), admin: admin.pub })).rejects.toMatchObject({ code: "space" });
    await expect(openAcl(await signAcl(a1, admin), { space, admin: admin.pub, seen: 2 })).rejects.toMatchObject({ code: "rollback" });
  });
});
