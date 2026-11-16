import { test, expect } from "@playwright/test";
import { testHooks, type LumenTestWindow } from "./_lumen";
import { opfsWritable, vaultOrSkip } from "./_opfs";

/**
 * Plan W7.4 acceptance 1 and 2, in every engine: a bulk edit of 1,000 notes
 * finishes in ≤ 3 s and one Undo takes all of them back; 0 changes outside
 * the frontmatter. The UI scenarios are e2e/bulk-properties.spec.ts (30
 * notes); this spec times the same run the table's "Set a value" starts
 * (views/bulkEditRun.runBulkEdit), on the browser's real OPFS. The audit's
 * last number was 12.1 s on a loaded cloud host (bulkEditOpfsBench.test.ts),
 * so the Mac run on a quiet machine decides it; the budget is not loosened
 * here. The result is attached as a "W7.4" annotation (JSON) for the Mac
 * pack (plan/mac-pack/L6.json).
 *
 * The notes are SYNTHETIC.
 */

const N = 1000;
const BUDGET_MS = 3000;

test("1,000 notes: set a field in ≤ 3 s, bodies untouched, one Undo restores every note", async ({ page, browserName }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => localStorage.setItem("lumen-tour-done", "1"));
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
  await testHooks(page);
  vaultOrSkip(await opfsWritable(page), browserName);

  const r = await page.evaluate(async ({ n }) => {
    const ws = await (window as unknown as LumenTestWindow).__lumenTest.load("storage/workspace");
    const bulk = await (window as unknown as LumenTestWindow).__lumenTest.load("views/bulkEditRun");
    const paths: string[] = [];
    const body = (i: number) => `Note ${i}. status: draft in the body stays.\n`;
    for (let i = 0; i < n; i += 50) {
      await Promise.all(
        Array.from({ length: Math.min(50, n - i) }, (_, k) => {
          const j = i + k;
          const p = `bulk1k/${j % 10}/note-${j}.md`;
          paths.push(p);
          return ws.writeWorkspaceFile(p, `---\nstatus: draft\ntags: [a]\n---\n${body(j)}`);
        }),
      );
    }
    const before = new Map<string, string>();
    for (const p of paths) before.set(p, await ws.readWorkspaceFile(p));

    const t0 = performance.now();
    const res = await bulk.runBulkEdit(paths, { kind: "set", key: "status", value: "done" });
    const ms = performance.now() - t0;

    let changed = 0;
    let bodyChanged = 0;
    for (const p of paths) {
      const now = await ws.readWorkspaceFile(p);
      if (/status: "?done/.test(now)) changed++;
      const b0 = before.get(p)!.split("\n---\n")[1];
      const b1 = now.split("\n---\n")[1];
      if (b0 !== b1) bodyChanged++;
    }

    const u0 = performance.now();
    const undo = await bulk.undoLastBulkEdit();
    const undoMs = performance.now() - u0;
    let restored = 0;
    for (const p of paths) if ((await ws.readWorkspaceFile(p)) === before.get(p)) restored++;
    return { ms, phases: res.phases, changes: res.changes.length, skipped: res.skipped.length, changed, bodyChanged, undoMs, undone: !!undo, restored };
  }, { n: N });

  test.info().annotations.push({ type: "W7.4", description: JSON.stringify({ browser: browserName, notes: N, budgetMs: BUDGET_MS, ...r, ms: Math.round(r.ms), undoMs: Math.round(r.undoMs) }) });
  expect(r.changes).toBe(N);
  expect(r.changed).toBe(N);
  expect(r.bodyChanged).toBe(0);
  expect(r.undone).toBe(true);
  expect(r.restored).toBe(N);
  expect(r.ms, `bulk edit of ${N} notes took ${Math.round(r.ms)} ms (phases ${JSON.stringify(r.phases)})`).toBeLessThanOrEqual(BUDGET_MS);
});
