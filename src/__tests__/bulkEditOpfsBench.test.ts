/**
 * W10.E51 (plan W7.4): 1,000 notes edited in bulk on a real OPFS, in
 * headless Chromium (V4=browser), with the time per phase and per backend
 * call. The acceptance is ≤ 3 s, measured on OPFS. The time is logged, not
 * asserted, because it depends on the machine. What is asserted does not: the
 * batch reaches the store as one readMany and one writeMany.
 * The notes are SYNTHETIC (a short frontmatter and a line of text each).
 * Skipped where there is no OPFS (Node).
 */
import { describe, expect, it } from "vitest";
import { createOpfsBackend } from "../storage/vault/opfs";
import { setVaultBackend } from "../storage/vault";
import { writeWorkspaceFile, readWorkspaceFile } from "../storage/workspace";
import { runBulkEdit } from "../views/bulkEditRun";

const hasOpfs = typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
const N = 1000;

// skip-reason: the bench needs a real OPFS (navigator.storage.getDirectory), which Node and happy-dom do not have; it runs in the Chromium runner | task: W10.E51 | until: 2027-05-16
describe.skipIf(!hasOpfs)("bulk edit on a real OPFS (W10.E51)", () => {
  it("1,000 notes: every one changed, the time per phase reported", async () => {
    const root = await navigator.storage.getDirectory();
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) await root.removeEntry(name, { recursive: true });
    const backend = createOpfsBackend();
    const timing: Record<string, number> = {};
    for (const k of ["readMany", "writeMany", "read", "stat", "write", "list"] as const) {
      const f = (backend as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[k];
      if (typeof f !== "function") continue;
      (backend as unknown as Record<string, unknown>)[k] = async (...a: unknown[]) => {
        const t = performance.now();
        try {
          return await f.apply(backend, a);
        } finally {
          timing[k] = (timing[k] ?? 0) + performance.now() - t;
        }
      };
    }
    setVaultBackend(backend);
    const paths: string[] = [];
    for (let i = 0; i < N; i++) {
      const p = `bench/${String(i % 10)}/note-${i}.md`;
      paths.push(p);
      await writeWorkspaceFile(p, `---\nstatus: draft\ntags: [a]\n---\nNote ${i}.\n`);
    }
    for (const k of Object.keys(timing)) delete timing[k];
    const t0 = performance.now();
    const r = await runBulkEdit(paths, { kind: "set", key: "status", value: "done" } as never);
    const ms = performance.now() - t0;
    console.log(`bulk edit ${N} notes on OPFS: ${Math.round(ms)} ms; phases ${JSON.stringify(Object.fromEntries(Object.entries(r.phases).map(([k, v]) => [k, Math.round(v as number)])))}; changed ${r.changes.length}, skipped ${r.skipped.length}; backend ms ${JSON.stringify(Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, Math.round(v)])))}`);
    expect(r.changes).toHaveLength(N);
    // The batch reached the store (W10.E51): one readMany, one writeMany, and not a read, stat or write per note.
    expect(Object.keys(timing).sort()).toEqual(["readMany", "writeMany"]);
    expect(await readWorkspaceFile(paths[N - 1])).toContain("status: done");
    setVaultBackend(null);
  }, 600_000);
});
