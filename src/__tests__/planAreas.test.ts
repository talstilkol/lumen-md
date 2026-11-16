// @vitest-environment node
/**
 * Plan W6.44 — the "works for the user" board: a score per area from signed
 * receipts against the bar for 10 (scripts/plan/areas.mjs, area-bars.mjs).
 */
import { describe, it, expect, afterAll } from "vitest";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { BARS } from "../../scripts/plan/area-bars.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { checkAreas, computeBoard, credit, loadReceipts, renderHtml, valueOf } from "../../scripts/plan/areas.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { canonical } from "../../scripts/nightly/receipt.mjs";

const ROOT = resolve(__dirname, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "lumen-areas-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type Obj = Record<string, unknown>;
const plan = JSON.parse(readFileSync(join(ROOT, "plan/plan.json"), "utf8"));
const areas = JSON.parse(readFileSync(join(ROOT, "plan/areas.json"), "utf8"));

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, pem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}
/** Seal like scripts/nightly/receipt.mjs (#455). */
function seal(report: Obj, k: ReturnType<typeof keyPair>) {
  const text = canonical(report);
  return {
    ...report,
    receipt: {
      sha256: createHash("sha256").update(text).digest("hex"),
      alg: "ed25519",
      signature: sign(null, new TextEncoder().encode(text), k.privateKey).toString("base64"),
      key: createHash("sha256").update(createPublicKey(k.pem).export({ type: "spki", format: "pem" }).toString()).digest("hex").slice(0, 16),
    },
  };
}
const sha = (c: string) => c.repeat(40);

describe("plan/areas.json and the bars", () => {
  it("has the 19 areas, each with its bar for 10 as code", () => {
    expect(areas.areas.map((a: Obj) => a.id)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    for (let n = 1; n <= 19; n++) expect(BARS[n].length).toBeGreaterThan(0);
  });

  it("maps every task of this branch's plan and passes the check", () => {
    const r = checkAreas(plan, areas);
    expect(r.problems).toEqual([]);
  });

  it("fails on a task without an entry, an unknown area and a malformed entry; ids not in the plan only warn", () => {
    const tasks = { ...areas.tasks };
    const first = plan.phases[0].tasks[0].id;
    delete tasks[first];
    tasks["X.1"] = [20];
    tasks["X.2"] = [3, 3];
    const r = checkAreas(plan, { ...areas, tasks });
    expect(r.problems.join("\n")).toContain(first);
    expect(r.problems.join("\n")).toContain("X.1");
    expect(r.problems.join("\n")).toContain("X.2");
    const ok = checkAreas(plan, { ...areas, tasks: { ...areas.tasks, "Z.9": [1] } });
    expect(ok.problems).toEqual([]);
    expect(ok.unknown).toContain("Z.9");
  });

  it("fails when an area has no metric or a metric has no single source", () => {
    const r = checkAreas(plan, areas, { ...BARS, 7: [], 8: [{ ...BARS[8][0], from: {} }] });
    expect(r.problems.some((p: string) => p.startsWith("area 7"))).toBe(true);
    expect(r.problems.some((p: string) => p.includes(BARS[8][0].id))).toBe(true);
  });
});

describe("credit and values", () => {
  it("gives full, partial and no credit", () => {
    expect(credit(0.995, { op: ">=", value: 0.995 })).toBe(1);
    expect(credit(0.5, { op: ">=", value: 1 })).toBe(0.5);
    expect(credit(200, { op: "<=", value: 100 })).toBe(0.5);
    expect(credit(1, { op: "<=", value: 0 })).toBe(0);
    expect(credit(0, { op: "<=", value: 0 })).toBe(1);
    expect(credit(true, { op: "true" })).toBe(1);
    expect(credit(false, { op: "true" })).toBe(0);
    expect(credit(undefined, { op: ">=", value: 1 })).toBe(0);
  });

  it("reads metric, factory suite, owner check and real receipts", () => {
    expect(valueOf({ metrics: { "a.b": 3 } }, { metric: "a.b" })).toBe(3);
    expect(valueOf({ metrics: {} }, { metric: "a.b" })).toBeUndefined();
    const full = { kind: "full", suites: { drill: { ok: true }, "drill-webkit": { ok: false } } };
    expect(valueOf(full, { suite: "drill" })).toBe(false);
    expect(valueOf({ kind: "full", suites: { build: { ok: true } } }, { suite: "drill" })).toBeUndefined();
    const owner = { kind: "owner", step: "accounts/github", checks: [{ id: "secret-scanning", ok: true }, { id: "label", ok: null }] };
    expect(valueOf(owner, { owner: "accounts/github", check: "secret-scanning" })).toBe(true);
    expect(valueOf(owner, { owner: "accounts/github", check: "label" })).toBeUndefined();
    expect(valueOf(owner, { owner: "accounts/hosts", check: "secret-scanning" })).toBeUndefined();
    expect(valueOf({ kind: "safari", platforms: [{ ok: true }, { ok: true }] }, { real: "safari" })).toBe(true);
    expect(valueOf({ kind: "real", real: { type: "obsidian" }, checks: [{ ok: false }] }, { real: "obsidian" })).toBe(false);
  });
});

describe("the board from receipts", () => {
  const k = keyPair();
  const stranger = keyPair();
  const dir = join(tmp, "metrics");
  mkdirSync(join(dir, "m"), { recursive: true });
  writeFileSync(join(dir, "PUBLIC_KEY.pem"), k.pem);
  const put = (name: string, r: Obj) => writeFileSync(join(dir, "m", name), JSON.stringify(r));
  put("old.json", seal({ kind: "metric", commit: { sha: sha("a") }, measuredAt: "2026-11-10T10:00:00Z", metrics: { "perf.startup-kb": 300 } }, k));
  put("new.json", seal({ kind: "metric", commit: { sha: sha("b") }, measuredAt: "2026-11-12T10:00:00Z", metrics: { "perf.startup-kb": 240, "perf.budget-overruns": 0 } }, k));
  put("forged.json", seal({ kind: "metric", commit: { sha: sha("c") }, measuredAt: "2026-11-13T10:00:00Z", metrics: { "perf.inp-p75-ms": 50 } }, stranger));
  const changed = seal({ kind: "metric", commit: { sha: sha("d") }, measuredAt: "2026-11-13T10:00:00Z", metrics: { "perf.fcp-mid-phone-ms": 500 } }, k);
  put("changed.json", { ...changed, metrics: { "perf.fcp-mid-phone-ms": 400 } });
  put("undated.json", seal({ kind: "metric", commit: { sha: sha("e") }, metrics: { "perf.search-100k-ms": 10 } }, k));

  const loaded = loadReceipts({ metrics: dir });
  const board = computeBoard({ areas, receipts: loaded.receipts });
  const perf = board.areas.find((a: Obj) => a.id === 14);

  it("counts only signed, untampered, dated receipts", () => {
    expect(loaded.receipts.length).toBe(2);
    expect(loaded.rejected.length).toBe(3);
  });

  it("takes the newest receipt per metric and points each score at it", () => {
    const startup = perf.metrics.find((x: Obj) => x.id === "perf.startup-kb");
    expect(startup.value).toBe(240);
    expect(startup.status).toBe("met");
    expect(startup.receipt.commit).toBe(sha("b"));
    expect(startup.receipt.at).toBe("2026-11-12T10:00:00Z");
    expect(perf.met).toBe(2);
    expect(perf.score).toBe(4); // 2 of 5 metrics met
  });

  it("shows a metric without a receipt as not measured, never as passed", () => {
    const inp = perf.metrics.find((x: Obj) => x.id === "perf.inp-p75-ms");
    expect(inp.status).toBe("not measured");
    expect(inp.receipt).toBeNull();
    expect(board.areas.find((a: Obj) => a.id === 1).score).toBe(0);
    expect(renderHtml({ ...board, generatedAt: "2026-11-12T00:00:00Z", sources: { counted: 2, rejected: [] } })).toContain("לא נמדד");
  });

  it("with no receipts at all every area scores 0", () => {
    const empty = computeBoard({ areas, receipts: [] });
    expect(empty.average).toBe(0);
    expect(empty.measured).toBe(0);
  });

  it("counts the computed levels of each area's tasks from plan/verified-receipts.json", () => {
    const id = Object.entries(areas.tasks).find(([, v]) => (v as number[]).includes(3))![0];
    const b = computeBoard({ areas, receipts: [], levels: { tasks: { [id]: { computed: "browser" } } } });
    const vault = b.areas.find((a: Obj) => a.id === 3);
    expect(vault.tasks.computed.browser).toBe(1);
    expect(vault.tasks.computed.none).toBe(vault.tasks.count - 1);
  });
});

describe("reliability per area (W4.24): from each task's verified level", () => {
  const mini = {
    areas: [
      { id: 1, key: "a", en: "A", he: "א" },
      { id: 2, key: "b", en: "B", he: "ב" },
    ],
    tasks: { t1: [1], t2: [1], t3: [1], t4: [2], t5: [2], t6: [1] },
  };
  const miniPlan = {
    phases: [
      {
        tasks: [
          { id: "t1", status: "✅ #1", verified: "real" },
          { id: "t2", status: "✅ #2", verified: "node" },
          { id: "t3", status: "⏳ #3", verified: "built" },
          { id: "t4", status: "⏳", verified: "owner" },
          { id: "t5", status: "⏳" },
          { id: "t6" },
        ],
      },
    ],
  };

  it("scores 10 × the mean level weight of the tasks with a status, and names the gap", () => {
    const board = computeBoard({ areas: mini, receipts: [], plan: miniPlan });
    const [a, b] = board.areas;
    // (1 + 0.5 + 0.25) / 3 = 0.583 → 5.8; t6 has no status and is not rated
    expect(a.reliability.score).toBe(5.8);
    expect(a.reliability.rated).toBe(3);
    expect(a.reliability.levels).toMatchObject({ real: 1, node: 1, built: 1, browser: 0, owner: 0, none: 0 });
    expect(a.reliability.gap.doneBelowBrowser).toEqual(["t2"]);
    expect(a.reliability.gap.doneNotReal).toBe(1);
    // waiting on the owner and no level both weigh 0
    expect(b.reliability.score).toBe(0);
    expect(b.reliability.gap.noLevel).toBe(1);
    expect(board.reliability).toBe(2.9);
  });

  it("shows the score and the gap on the page, and no score without the plan", () => {
    const html = renderHtml({ ...computeBoard({ areas: mini, receipts: [], plan: miniPlan }), generatedAt: "2026-11-16T00:00:00Z", sources: { counted: 0, rejected: [] } });
    expect(html).toContain("אמינות 5.8");
    expect(html).toContain("1 ✅ מתחת לדפדפן (t2)");
    expect(html).toContain("אמינות ממוצעת 2.9");
    const bare = computeBoard({ areas: mini, receipts: [] });
    expect(bare.reliability).toBeNull();
    expect(bare.areas[0].reliability).toBeNull();
    expect(renderHtml({ ...bare, sources: { counted: 0, rejected: [] } })).not.toContain("אמינות");
  });

  it("rates every area of the real plan, with the same levels as plan:check", async () => {
    // @ts-expect-error — plain .mjs script without type declarations
    const { RELIABILITY_LEVELS } = await import("../../scripts/plan/reliability.mjs");
    // @ts-expect-error — plain .mjs script without type declarations
    const { VERIFIED_LEVELS } = await import("../../scripts/plan/build.mjs");
    expect([...RELIABILITY_LEVELS]).toEqual([...VERIFIED_LEVELS]);
    const board = computeBoard({ areas, receipts: [], plan });
    for (const a of board.areas) {
      expect(a.reliability.rated, `area ${a.id}`).toBeGreaterThan(0);
      expect(a.reliability.score).toBeGreaterThanOrEqual(0);
      expect(a.reliability.score).toBeLessThanOrEqual(10);
    }
  });
});
