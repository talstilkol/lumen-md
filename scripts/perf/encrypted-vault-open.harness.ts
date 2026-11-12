/**
 * W6.36 — how long a 10,000-note encrypted vault (plan 11.4) takes to open
 * again, in a real browser: OPFS, WebCrypto and the vault index worker.
 *
 * Runs as a test file in a headless-Chromium harness that bundles the page
 * and serves src/storage/vaultIndex.worker.ts as /worker.js (WORKER=…). Not
 * part of `vitest run` (it is not under src/). The numbers go to the
 * console as one `PERF {…}` line.
 *
 * "before" is a reopen with no snapshot: what every open of an encrypted
 * vault did until W6.36 (#420 turned the snapshot off there) — every note
 * read from OPFS, decrypted and sent to the worker. "after" is a reopen in a
 * fresh worker from the sealed snapshot. Unlocking (the passphrase KDF, ≤ 1 s
 * by W4.20's calibration) comes before both and is not counted.
 *
 * Also times what an embed render asks the index for: every note's text
 * (W2.22) against only the embedded notes (W6.36).
 */
import { describe, expect, it } from "vitest";
import { createOpfsBackend, setVaultBackend } from "../../src/storage/vault";
import * as session from "../../src/storage/vault/encrypted/session";
import * as wsIndex from "../../src/storage/workspaceIndex";
import { writeWorkspaceFile } from "../../src/storage/workspace";
import { workerEngine } from "../../src/storage/vaultIndexProtocol";
import { createEmbedContext } from "../../src/renderer/embeds";
import { embedNotice, loadEmbedContext } from "../../src/renderer/embedContext";

const N = Number(new URLSearchParams(location.search).get("n") ?? 10_000);
const RUNS = 3;
const HE = "שלום עולם הבית הגדול ספר מחברת ירושלים תל אביב פגישה מחר בבוקר רשימת משימות סיכום הרצאה מבחן".split(" ");
const EN = "the quick brown fox project meeting notes summary lumen editor markdown vault search index graph".split(" ");
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
function note(i: number): string {
  const W = i % 3 !== 0 ? HE : EN;
  const words: string[] = [];
  const len = 150 + Math.floor(rnd() * 300);
  for (let k = 0; k < len; k++) words.push(W[Math.floor(rnd() * W.length)]);
  for (let k = 0; k < 3; k++) words.push(`[[note-${Math.floor(rnd() * N)}]]`);
  if (i % 50 === 0) words.push(`![[note-${(i + 1) % N}]]`);
  return `# Note ${i}\n\n${words.join(" ")} unique${i}\n`;
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const worker = () => workerEngine(new Worker("/worker.js", { type: "module" }) as unknown as Parameters<typeof workerEngine>[0]);
const hooks = wsIndex as unknown as {
  __saveSnapshotNow?: () => Promise<void>;
  __resetWorkspaceIndex: (f?: () => ReturnType<typeof worker>, o?: { keepSnapshot?: boolean }) => void;
};

describe(`reopen a ${N}-note encrypted vault`, () => {
  it("before (no snapshot) and after (sealed snapshot in the worker)", async () => {
    session.setKdfPolicyForTests({ minPbkdf2Iterations: 1000, minArgon2CostKiB: 8, argon2: { memoryKiB: 8, iterations: 1, parallelism: 1 } });
    const root = await navigator.storage.getDirectory();
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) await root.removeEntry(name, { recursive: true });
    setVaultBackend(createOpfsBackend());
    await session.enableEncryption("a long enough passphrase", { pbkdf2Iterations: 1000, confirmRecoveryKey: async () => true });
    let t = performance.now();
    for (let i = 0; i < N; i++) await writeWorkspaceFile(`f${i % 100}/note-${i}.md`, note(i));
    const writeMs = performance.now() - t;

    const before: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      hooks.__resetWorkspaceIndex(worker);
      t = performance.now();
      await wsIndex.ensureIndex();
      before.push(performance.now() - t);
      expect(wsIndex.snapshotCounters.read).toBe(N);
    }
    const out: Record<string, unknown> = { notes: N, writeMs: Math.round(writeMs), beforeMs: before.map(Math.round), beforeMedianMs: Math.round(median(before)) };

    if (hooks.__saveSnapshotNow) {
      await hooks.__saveSnapshotNow();
      const after: number[] = [];
      const checked: number[] = [];
      const firstSearch: number[] = [];
      for (let r = 0; r < RUNS; r++) {
        hooks.__resetWorkspaceIndex(worker, { keepSnapshot: true });
        t = performance.now();
        await wsIndex.ensureIndex();
        after.push(performance.now() - t);
        expect(wsIndex.snapshotCounters).toEqual({ fromSnapshot: N, read: 0 });
        const hits = await wsIndex.searchWorkspace(`unique${N - 1}`, { limit: 5 });
        firstSearch.push(performance.now() - t);
        expect(hits.map((h) => h.path)).toContain(`f${(N - 1) % 100}/note-${N - 1}.md`);
        await wsIndex.ensureIndex();
        checked.push(performance.now() - t);
      }
      // "after": the index is open; "firstSearch": the first search answered (it
      // waits for the worker to finish indexing the restored notes).
      out.afterMs = after.map(Math.round);
      out.afterMedianMs = Math.round(median(after));
      out.firstSearchMs = firstSearch.map(Math.round);
      out.firstSearchMedianMs = Math.round(median(firstSearch));
      out.checkedMedianMs = Math.round(median(checked));
      out.speedup = Math.round((median(before) / median(after)) * 10) / 10;
    }

    // Embeds: what a render with one embed asked the index for.
    const host = "![[note-1]] and ![[note-2#Note 2]]";
    const fullMs: number[] = [];
    const targetedMs: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      t = performance.now();
      const all = await wsIndex.indexedNotes();
      createEmbedContext({ hostPath: "host.md", hostText: host, files: all, notice: embedNotice });
      fullMs.push(performance.now() - t);
      t = performance.now();
      await loadEmbedContext(host, "ws:host.md");
      targetedMs.push(performance.now() - t);
    }
    out.embedsAllTextsMs = Math.round(median(fullMs));
    out.embedsTargetedMs = Math.round(median(targetedMs) * 10) / 10;
    console.log("PERF " + JSON.stringify(out));
  });
});
