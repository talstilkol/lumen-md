/**
 * Both vault relays for the role-vault tests (plan W12.S4), each behind a
 * `fetch`: the Node relay (sync-server/vault-relay.js) on a real HTTP
 * server on 127.0.0.1, and the Cloudflare Worker (edge-workers/vault-relay)
 * in the Durable Object simulation. Plus the vault's three clients (admin,
 * writer, reader) on the real engine, and a recorder for captured requests.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
// @ts-expect-error -- plain CommonJS module
import relayModule from "../../../sync-server/vault-relay.js";
// @ts-expect-error -- plain ESM Worker module
import worker, { VaultRelay } from "../../../edge-workers/vault-relay/worker.mjs";
import { FakeStorage, fakeState } from "./durableObject";
import { createVault, E2eeSync, unlockWithDevice } from "../../sync/e2ee/engine";
import { memoryFiles, type MemoryFiles } from "../../sync/e2ee/localFiles";
import { memoryStateStore } from "../../sync/e2ee/state";
import type { FetchLike } from "../../sync/e2ee/providers/http";
import { addMember, memberProvider, newMemberKeys, openRoleSpace, type MemberKeys, type RoleVaultRef } from "../../sync/e2ee/roles/vault";
import type { RoleProvider } from "../../sync/e2ee/roles/provider";
import { PASSPHRASE, TEST_ITERATIONS } from "./e2ee";

export interface RelayHost {
  kind: "node" | "worker";
  url: string;
  fetch: FetchLike;
  close(): Promise<void>;
}

const LIMITS = { ratePerMinute: 1_000_000, newSpacesPerDay: 1_000_000, addressBytesPerDay: 1 << 30 };

/** The Node relay on a real HTTP server. */
export async function nodeRelay(): Promise<RelayHost> {
  const relay = (relayModule as { createVaultRelay(o: object): { handle(req: unknown, res: unknown): boolean; close(): void } }).createVaultRelay({ sweep: false, trustProxy: false, ...LIMITS });
  const server = http.createServer((req, res) => {
    if (!relay.handle(req, res)) (res.writeHead(404), res.end());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    kind: "node",
    url,
    fetch: (input, init) => globalThis.fetch(input, init),
    close: () => new Promise<void>((r) => (relay.close(), server.close(() => r()))),
  };
}

/** The Worker and its Durable Object, in the simulation. */
export async function workerRelay(): Promise<RelayHost> {
  const storage = new FakeStorage();
  let obj: { fetch(r: Request): Promise<Response> } | null = null;
  const state = fakeState(storage);
  const env: Record<string, unknown> = {
    VAULT_RELAY_RATE: "1000000",
    VAULT_RELAY_NEW_SPACES_PER_DAY: "1000000",
    VAULT_RELAY_POW_BITS: "4",
    RELAY: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async (r: Request) => {
          obj ??= new VaultRelay(state, env);
          await state.ready;
          return obj!.fetch(r);
        },
      }),
    },
  };
  const url = "https://relay.example.com";
  const call: FetchLike = async (input, init) => {
    const req = new Request(input, init);
    const headers = new Headers(req.headers);
    headers.set("cf-connecting-ip", "198.51.100.7");
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : new Uint8Array(await req.arrayBuffer());
    return (worker as { fetch(r: Request, e: unknown): Promise<Response> }).fetch(new Request(req.url, { method: req.method, headers, body }), env);
  };
  return { kind: "worker", url, fetch: call, close: async () => undefined };
}

export interface Captured {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

/** A fetch that records every write it sends. */
export function recording(inner: FetchLike): { fetch: FetchLike; writes: Captured[] } {
  const writes: Captured[] = [];
  const fetch: FetchLike = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT" || method === "DELETE") {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
      const body = init?.body instanceof Uint8Array ? new Uint8Array(init.body) : null;
      writes.push({ method, url: String(input), headers, body });
    }
    return inner(input, init);
  };
  return { fetch, writes };
}

/** Send a captured (or crafted) request again, as an attacker holding the space token would. */
export function resend(f: FetchLike, c: Captured, change: Partial<Captured> = {}): Promise<Response> {
  const x = { ...c, ...change };
  return f(x.url, { method: x.method, headers: x.headers, body: (x.body ?? undefined) as BodyInit | undefined });
}

export interface Client {
  keys: MemberKeys;
  provider: RoleProvider;
  files: MemoryFiles;
  sync: E2eeSync;
}

export interface RoleVault {
  relay: RelayHost;
  ref: RoleVaultRef;
  admin: Client;
  writer: Client;
  reader: Client;
  adminCtx: { provider: RoleProvider; signer: NonNullable<MemberKeys["signer"]>; sync: E2eeSync; keys: MemberKeys };
}

/** A member device on the real engine: the read key from its keyring wrap, confirmed by its user after the first pull. */
export async function memberClient(relay: RelayHost, ref: RoleVaultRef, keys: MemberKeys, fetch: FetchLike = relay.fetch): Promise<Client> {
  const provider = memberProvider(ref, keys, { fetch });
  const { keys: vaultKeys } = await unlockWithDevice(provider, keys.id, keys.age.identity);
  const files = memoryFiles();
  const sync = new E2eeSync({ provider, keys: vaultKeys, local: files, store: memoryStateStore(), access: { device: keys.id, identity: keys.age.identity } });
  // A device enrolled without pairing pulls until its user confirms the vault is current (engine, N6).
  await sync.sync();
  await sync.confirmFreshness();
  return { keys, provider, files, sync };
}

/**
 * Three clients, three roles: the admin opens the space and the vault, adds
 * a writer and a reader (ACL, then keyring), and each opens it on its own
 * device key. `fetchOf` lets a test record or tamper with one client's traffic.
 */
export async function threeClients(relay: RelayHost, fetchOf: Partial<Record<"admin" | "writer" | "reader", FetchLike>> = {}, opts: { readerPersonal?: boolean; writerPersonal?: boolean } = {}): Promise<RoleVault> {
  const { ref, admin, provider } = await openRoleSpace(relay.url, { fetch: fetchOf.admin ?? relay.fetch });
  const { keys, anchor } = await createVault(provider, PASSPHRASE, { pbkdf2Iterations: TEST_ITERATIONS });
  const files = memoryFiles();
  const sync = new E2eeSync({ provider, keys, local: files, store: memoryStateStore() });
  await sync.markCreated(anchor);
  const adminCtx = { provider, signer: admin.signer!, sync, keys: admin };
  const w = await newMemberKeys("writer", { id: "writer" });
  const r = await newMemberKeys("reader", { id: "reader", personal: !!opts.readerPersonal });
  const wAcl = await addMember(adminCtx, { id: w.id, role: "writer", sign: w.signer!.pub, recipient: w.age.recipient, personal: !!opts.writerPersonal });
  const rAcl = await addMember(adminCtx, { id: r.id, role: "reader", recipient: r.age.recipient, personal: !!opts.readerPersonal, ...(r.signer ? { sign: r.signer.pub } : {}) });
  const writer = await memberClient(relay, ref, { ...w, scope: wAcl.members.writer?.scope }, fetchOf.writer);
  const reader = await memberClient(relay, ref, { ...r, scope: rAcl.members.reader?.scope }, fetchOf.reader);
  return { relay, ref, admin: { keys: admin, provider, files, sync }, writer, reader, adminCtx };
}
