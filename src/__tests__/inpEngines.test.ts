// @vitest-environment node
/**
 * Plan W13.V1 — INP gated in Chromium, Firefox and WebKit with the same
 * budget (p75 ≤ 200 ms), and every slow interaction in Chromium attributed
 * to the file and function its long animation frame ran (LoAF scripts[]).
 * The fixture is a real headless-Chromium capture of the spec's observers.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { attributeInteraction, engineGate, engineReport, INP_BUDGET_MS, renderEngines } from "../../scripts/perf/inpAttribution.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { gateEngines } from "../../scripts/perf/inp-gate.mjs";

const ROOT = resolve(__dirname, "..", "..");
const chromium = JSON.parse(readFileSync(join(__dirname, "fixtures/inp/chromium-loaf.json"), "utf8"));
const quiet = (engine: string, ms = 24) => ({ engine, loafSupported: false, interactions: Array.from({ length: 20 }, (_, i) => ({ name: `step ${i}`, start: i * 1000, ms })), loafs: [] });

describe("LoAF attribution (a real Chromium capture)", () => {
  it("names the file, the function and the invoker of every slow interaction", () => {
    const r = engineReport(chromium);
    expect(r.slow.length).toBe(3);
    for (const s of r.slow) {
      expect(s.ms).toBeGreaterThan(INP_BUDGET_MS);
      expect(s.top).toMatchObject({ file: "/slow.js", fn: "renderHugeList", invoker: "BUTTON#slow.onclick" });
      expect(s.top.ms).toBeGreaterThan(200);
    }
    expect(r.p75).toBeLessThanOrEqual(INP_BUDGET_MS);
  });

  it("only frames that overlap the interaction count", () => {
    const loafs = [
      { startTime: 0, duration: 60, scripts: [{ sourceURL: "https://x/a.js?v=1", sourceFunctionName: "early", duration: 55 }] },
      { startTime: 100, duration: 300, scripts: [{ sourceURL: "https://x/b.js", sourceFunctionName: "", invoker: "DIV.onclick", duration: 250 }, { sourceURL: "https://x/c.js", sourceFunctionName: "small", duration: 20 }] },
    ];
    const a = attributeInteraction({ name: "x", start: 120, ms: 280 }, loafs);
    expect(a.frames).toBe(1);
    expect(a.top).toEqual({ file: "/b.js", fn: "(anonymous)", invoker: "DIV.onclick", ms: 250 });
    expect(a.scripts.map((s: { fn: string }) => s.fn)).toEqual(["(anonymous)", "small"]);
  });
});

describe("the three-engine gate", () => {
  it("passes when every engine is under the budget with 20 interactions", () => {
    const g = engineGate({ chromium, firefox: quiet("firefox"), webkit: quiet("webkit") });
    expect(g.problems).toEqual([]);
    expect(g.ok).toBe(true);
    expect(renderEngines(g)).toMatch(/\| webkit \| 20 \| 24 \| 200 \| ✓ \|/);
    expect(renderEngines(g)).toMatch(/chromium · slow click: \d+ ms — \/slow\.js › renderHugeList/);
  });

  it("fails on a missing engine, a slow p75, too few interactions, and an unexplained slow frame", () => {
    const slowWebkit = quiet("webkit", 260);
    const unexplained = { ...chromium, loafs: [] };
    const g = engineGate({ chromium: unexplained, firefox: { ...quiet("firefox"), interactions: quiet("firefox").interactions.slice(0, 5) }, webkit: slowWebkit });
    expect(g.ok).toBe(false);
    expect(g.problems.join("\n")).toMatch(/webkit: INP p75 260 ms > 200 ms/);
    expect(g.problems.join("\n")).toMatch(/firefox: 5 interactions, 20 needed/);
    expect(g.problems.join("\n")).toMatch(/chromium: "slow click" took \d+(\.\d+)? ms and no long-animation-frame script explains it/);
    expect(engineGate({ chromium }).problems.join("\n")).toMatch(/firefox: no report[\s\S]*webkit: no report/);
  });

  it("an engine without LoAF says so instead of passing silently", () => {
    const r = engineReport({ ...quiet("webkit"), interactions: [{ name: "slow", start: 0, ms: 300 }] });
    expect(r.slow[0].note).toBe("no LoAF in this engine");
  });

  it("inp-gate --engines reads reports/perf/inp-<engine>.json and writes the table", () => {
    const dir = mkdtempSync(join(tmpdir(), "inp-"));
    writeFileSync(join(dir, "inp-chromium.json"), JSON.stringify(chromium));
    writeFileSync(join(dir, "inp-firefox.json"), JSON.stringify(quiet("firefox")));
    expect(gateEngines(dir)).toBe(1);
    writeFileSync(join(dir, "inp-webkit.json"), JSON.stringify(quiet("webkit")));
    expect(gateEngines(dir)).toBe(0);
    expect(readFileSync(join(dir, "inp-engines.md"), "utf8")).toMatch(/INP in three engines/);
  });

  it("perf:inp runs the three engine projects and gates them", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["perf:inp"]).toMatch(/--project=inp-chromium --project=inp-firefox --project=inp-webkit/);
    expect(pkg.scripts["perf:inp"]).toMatch(/inp-gate\.mjs --engines/);
    const cfg = readFileSync(join(ROOT, "playwright.config.ts"), "utf8");
    for (const e of ["chromium", "firefox", "webkit"]) expect(cfg).toMatch(new RegExp(`name: "inp-${e}", grep: INPX`));
  });
});
