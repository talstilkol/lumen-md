/**
 * Plan W2.19 acceptance on a real network stack (W10.E44): two devices,
 * 1,000 rounds with 0 lost, and a change reaching the other device with
 * p95 < 2 s. lanSync.test.ts runs the same engine over an in-memory channel.
 * Here the host and the peer talk over a TCP socket on 127.0.0.1
 * (helpers/loopbackChannel.ts), through the real code: lanHost /
 * remoteLanProvider (rpc.ts), the message framing and chunking (channel.ts),
 * the encrypted sync engine (plan 3.4) and liveSync.
 *
 * With LAN_SYNC_REPORT=<file> the measurements are written there as JSON
 * (`LAN_SYNC_REPORT=eval/lan-sync/loopback.json npx vitest run src/__tests__/lanSyncLoopback.test.ts`;
 * the committed eval/lan-sync/loopback.json is one such run).
 * @vitest-environment node
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createVault, unlockVault, E2eeSync } from "../sync/e2ee/engine";
import { memoryProvider } from "../sync/e2ee/provider";
import { memoryFiles } from "../sync/e2ee/localFiles";
import { memoryStateStore } from "../sync/e2ee/state";
import { keepBothResolver } from "../sync/e2ee/conflict";
import { lanHost, liveSync, remoteLanProvider } from "../sync/e2ee/lan/rpc";
import { mulberry32, pairConfirmed, PASSPHRASE, TEST_ITERATIONS, TEST_POLICY } from "./helpers/e2ee";
import { loopbackPair, type LoopbackPair } from "./helpers/loopbackChannel";

const report: Record<string, unknown> = { transport: "TCP over 127.0.0.1 (node:net), [u32 length] framing", node: process.version, platform: `${process.platform}-${process.arch}` };
afterAll(() => {
  const out = process.env.LAN_SYNC_REPORT;
  if (!out) return;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ ...report, at: new Date().toISOString() }, null, 2) + "\n");
});

const realFetch = globalThis.fetch;
let link: LoopbackPair | null = null;
afterEach(async () => {
  globalThis.fetch = realFetch;
  await link?.shutdown();
  link = null;
});

async function pairOverLoopback() {
  link = await loopbackPair();
  const bucket = memoryProvider();
  const { keys, anchor } = await createVault(bucket, PASSPHRASE, { pbkdf2Iterations: TEST_ITERATIONS });
  const host = lanHost({ bucket, keys: () => keys });
  host.attach(link.host, { address: "127.0.0.1" });
  const remote = remoteLanProvider(link.peer);
  const peerKeys = (await unlockVault(remote, PASSPHRASE, TEST_POLICY)).keys;
  await remote.authenticate(peerKeys);
  const hostFiles = memoryFiles();
  const peerFiles = memoryFiles();
  const hostSync = new E2eeSync({ provider: host.provider, keys, local: hostFiles, store: memoryStateStore(), resolver: keepBothResolver });
  await hostSync.markCreated(anchor);
  const peerSync = new E2eeSync({ provider: remote, keys: peerKeys, local: peerFiles, store: memoryStateStore(), resolver: keepBothResolver });
  await peerSync.sync();
  await pairConfirmed({ sync: peerSync }, { sync: hostSync }, await hostSync.pairingCode());
  return { host, remote, hostFiles, peerFiles, hostSync, peerSync, frames: link.frames };
}

const snapshot = (f: ReturnType<typeof memoryFiles>) => [...f.files.keys()].sort().map((p) => [p, f.text(p)]);
const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

describe("LAN sync over a real loopback socket (W2.19 acceptance, W10.E44)", () => {
  it("1,000 rounds of random edits on both devices: 1,000/1,000 rounds with 0 lost, no request off the device, no plaintext on the wire", async () => {
    const fetches: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      fetches.push(String(input));
      return Promise.reject(new Error("no network in a LAN sync"));
    }) as typeof fetch;
    const rand = mulberry32(0x5eed44);
    const d = await pairOverLoopback();
    const truth = { host: new Map<string, string | null>(), peer: new Map<string, string | null>() };
    const shared: string[] = [];
    const t0 = Date.now();
    let rounds = 0;
    let lostAt: number[] = [];
    for (let round = 0; round < 1000; round++) {
      for (const [who, files] of [["host", d.hostFiles], ["peer", d.peerFiles]] as const) {
        if (rand() < 0.6) {
          const path = `${who}/note-${Math.floor(rand() * 12)}.md`;
          if (rand() < 0.15 && files.files.has(path)) {
            files.delete(path);
            truth[who].set(path, null);
          } else {
            const text = `# ${who} ${round}\nשלום ${Math.floor(rand() * 1e6)}`;
            files.set(path, text);
            truth[who].set(path, text);
          }
        }
      }
      if (round % 97 === 13) {
        d.hostFiles.set(`shared-${round}.md`, `shared from host ${round}`);
        d.peerFiles.set(`shared-${round}.md`, `shared from peer ${round}`);
        shared.push(`shared from host ${round}`, `shared from peer ${round}`);
      }
      if (rand() < 0.5) await Promise.all([d.hostSync.sync(), d.peerSync.sync()]);
      else {
        await d.peerSync.sync();
        await d.hostSync.sync();
      }
      rounds++;
      // Every 100 rounds: a full settle, then nothing either device wrote may be missing on the other.
      if (round % 100 === 99) {
        await d.peerSync.sync();
        await d.hostSync.sync();
        await d.peerSync.sync();
        if (JSON.stringify(snapshot(d.peerFiles)) !== JSON.stringify(snapshot(d.hostFiles))) lostAt = [...lostAt, round];
      }
    }
    for (let i = 0; i < 3; i++) {
      await d.hostSync.sync();
      await d.peerSync.sync();
    }
    const ms = Date.now() - t0;
    let lost = 0;
    for (const who of ["host", "peer"] as const)
      for (const [path, text] of truth[who]) {
        const ok = text === null ? !d.hostFiles.files.has(path) && !d.peerFiles.files.has(path) : d.hostFiles.text(path) === text && d.peerFiles.text(path) === text;
        if (!ok) lost++;
      }
    const all = [...d.hostFiles.files.keys()].map((p) => d.hostFiles.text(p) ?? "").join("\n");
    const sharedLost = shared.filter((s) => !all.includes(s)).length;
    const wire = Buffer.concat(d.frames.map((f) => Buffer.from(f)));
    report.rounds = { done: rounds, of: 1000, lost, sharedLost, divergedAtCheckpoints: lostAt, notes: truth.host.size + truth.peer.size, frames: d.frames.length, wireBytes: wire.length, ms };

    expect(rounds).toBe(1000);
    expect(lostAt).toEqual([]);
    expect(lost).toBe(0);
    expect(sharedLost).toBe(0);
    expect(snapshot(d.peerFiles)).toEqual(snapshot(d.hostFiles));
    expect(fetches).toEqual([]);
    expect(wire.includes(Buffer.from("שלום", "utf8"))).toBe(false);
    expect(wire.includes(Buffer.from("# host", "utf8"))).toBe(false);
  }, 600_000);

  it("live sync: 100 changes each way reach the other device with p95 < 2 s", async () => {
    const d = await pairOverLoopback();
    const hostLive = liveSync(() => d.hostSync.sync(), { debounceMs: 50 });
    const peerLive = liveSync(() => d.peerSync.sync(), { debounceMs: 50 });
    d.host.onPeerWrite(hostLive.kick);
    d.remote.onChanged(peerLive.kick);
    const arrives = (files: ReturnType<typeof memoryFiles>, path: string, text: string) =>
      new Promise<number>((resolve, reject) => {
        const t0 = performance.now();
        const poll = () => {
          if (files.text(path) === text) return resolve(performance.now() - t0);
          if (performance.now() - t0 > 10_000) return reject(new Error(`${path} did not arrive in 10 s`));
          setTimeout(poll, 2);
        };
        poll();
      });
    const toPeer: number[] = [];
    const toHost: number[] = [];
    for (let i = 0; i < 100; i++) {
      d.hostFiles.set(`from-host-${i}.md`, `host ${i}`);
      hostLive.kick();
      toPeer.push(await arrives(d.peerFiles, `from-host-${i}.md`, `host ${i}`));
      d.peerFiles.set(`from-peer-${i}.md`, `peer ${i}`);
      peerLive.kick();
      toHost.push(await arrives(d.hostFiles, `from-peer-${i}.md`, `peer ${i}`));
    }
    hostLive.stop();
    peerLive.stop();
    const all = [...toPeer, ...toHost];
    const stat = (xs: number[]) => ({ n: xs.length, p50: Math.round(percentile(xs, 50)), p95: Math.round(percentile(xs, 95)), max: Math.round(Math.max(...xs)) });
    report.live = { hostToPeer: stat(toPeer), peerToHost: stat(toHost), all: stat(all), debounceMs: 50 };

    expect(all).toHaveLength(200);
    expect(percentile(toPeer, 95)).toBeLessThan(2000);
    expect(percentile(toHost, 95)).toBeLessThan(2000);
  }, 600_000);
});
