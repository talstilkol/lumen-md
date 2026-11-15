// @vitest-environment node
/**
 * Review Z7-L5 and Z7-L6 (#938).
 * L5: the vault relay ignored If-Match on DELETE, though a role envelope signs it as a condition: a stale delete
 * removed a newer version. Both relays (Node, and the Worker that runs the same code) now answer 412 and keep it.
 * L6: the self-hosted collab server deleted a room for anyone holding an edit token, which it hands to anyone with
 * the access key and the room's name. It now also wants the room proof the committed name commits to, and refuses a
 * name committing to another proof than the room's first (adminCommitment, sync-server/collab/roomToken.mjs).
 */
import { afterEach, describe, expect, it } from "vitest";
import { nodeRelay, type RelayHost } from "../helpers/roleRelay";
// @ts-expect-error -- plain ESM Worker module
import worker, { VaultRelay } from "../../../edge-workers/vault-relay/worker.mjs";
import { FakeStorage, fakeState } from "../helpers/durableObject";
// @ts-expect-error -- plain ESM module
import { adminCommitment, splitCommittedRoom } from "../../../sync-server/collab/roomToken.mjs";
import { committedRoomName, roomProof } from "../../collab/roomProof";

const hosts: RelayHost[] = [];
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.close();
});

/** The Worker relay in the Durable Object simulation, without a proof of work. */
function workerNoPow(): RelayHost {
  const storage = new FakeStorage();
  const state = fakeState(storage);
  let obj: { fetch(r: Request): Promise<Response> } | null = null;
  const env: Record<string, unknown> = {
    VAULT_RELAY_RATE: "1000000",
    VAULT_RELAY_NEW_SPACES_PER_DAY: "1000000",
    RELAY: { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => ((obj ??= new VaultRelay(state, env)), await state.ready, obj!.fetch(r)) }) },
  };
  return {
    kind: "worker",
    url: "https://relay.example.com",
    fetch: async (input, init) => {
      const req = new Request(input, init);
      const headers = new Headers(req.headers);
      headers.set("cf-connecting-ip", "198.51.100.9");
      const body = req.method === "GET" || req.method === "DELETE" ? undefined : new Uint8Array(await req.arrayBuffer());
      return (worker as { fetch(r: Request, e: unknown): Promise<Response> }).fetch(new Request(req.url, { method: req.method, headers, body }), env);
    },
    close: async () => undefined,
  };
}

const TOKEN = "z7l5-" + "a".repeat(40);
for (const make of [async () => nodeRelay(), async () => workerNoPow()]) {
  describe("Z7-L5: DELETE honours If-Match", () => {
    it("a stale If-Match is 412 and the newer version stays; a current one deletes", async () => {
      const h = await make();
      hosts.push(h);
      const at = `${h.url}/v1/vault/o/blob`;
      const auth = { Authorization: `Bearer ${TOKEN}` };
      const put = (data: string, extra: Record<string, string> = {}) => h.fetch(at, { method: "PUT", headers: { ...auth, "Content-Type": "application/octet-stream", ...extra }, body: new TextEncoder().encode(data) });
      const first = await put("v1");
      expect(first.status, h.kind).toBeLessThan(300);
      const old = first.headers.get("ETag")!;
      const second = await put("v2", { "If-Match": old });
      expect(second.status, h.kind).toBeLessThan(300);
      const now = second.headers.get("ETag")!;
      expect(now).not.toBe(old);

      const stale = await h.fetch(at, { method: "DELETE", headers: { ...auth, "If-Match": old } });
      expect(stale.status, h.kind).toBe(412);
      const still = await h.fetch(at, { headers: auth });
      expect(still.status, h.kind).toBe(200);
      expect(new TextDecoder().decode(new Uint8Array(await still.arrayBuffer()))).toBe("v2");

      const ok = await h.fetch(at, { method: "DELETE", headers: { ...auth, "If-Match": now } });
      expect(ok.status, h.kind).toBe(204);
      expect((await h.fetch(at, { headers: auth })).status, h.kind).toBe(404);
      // A DELETE with If-Match on a name that is gone removes nothing and says so.
      expect((await h.fetch(at, { method: "DELETE", headers: { ...auth, "If-Match": now } })).status, h.kind).toBe(412);
    });
  });
}

describe("Z7-L6: the Node room delete needs the proof the committed name commits to", () => {
  it("the right proof passes; none, a wrong one, or a name committing to another proof is refused", async () => {
    const room = "havruta-0123456789abcdef0123456789abcdef";
    const name = await committedRoomName(room, "the password");
    const proof = await roomProof("the password", room);
    const commit = splitCommittedRoom(name).commit as string;
    expect(adminCommitment(name, proof, null)).toBe(commit);
    expect(adminCommitment(name, proof, commit)).toBe(commit);
    expect(adminCommitment(name, undefined, null)).toBe(null);
    expect(adminCommitment(name, await roomProof("a guess", room), null)).toBe(null);
    expect(adminCommitment(room, proof, null)).toBe(null); // no commitment in the name
    // Someone with the room's name but not its password commits to a proof of their own: the base is the same,
    // so the server's binding (the room's first commitment) refuses it.
    const theirs = await committedRoomName(room, "not the password");
    const theirProof = await roomProof("not the password", room);
    expect(adminCommitment(theirs, theirProof, null)).not.toBe(null);
    expect(adminCommitment(theirs, theirProof, commit)).toBe(null);
  });
});
