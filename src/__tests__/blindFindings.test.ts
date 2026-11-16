// @vitest-environment node
/**
 * Plan W6.15 — "the number of bugs the blind suites found is recorded (also 0)".
 *
 * src/__tests__/blind/findings.json is that record: per module, its blind
 * suites and how many bugs they found; per finding, its module, kind, severity
 * and whether it is fixed. This file holds the record to the suites, so it
 * cannot drift from them:
 *   - all 12 sensitive modules the plan names have a blind suite that exists
 *     and says it is one; no blind suite is left out of the record;
 *   - every finding id a suite mentions is recorded, and every recorded one
 *     (but the two the PRs only noted in prose) is mentioned by its module's suite;
 *   - an open bug has an `it.fails` naming it, a fixed one has none, and no
 *     `it.fails` names an id that is not an open bug;
 *   - each module's bugsFound / open is what its findings add up to.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const BLIND = join(ROOT, "src/__tests__/blind");
type Mod = { suites: string[]; sensitive: boolean; bugsFound: number; open: number };
type Finding = { id: string; module: string; kind: "bug" | "ambiguity" | "info"; severity: string; status: "open" | "fixed" | "noted"; pr: number; fixedIn?: string; also?: string[]; inSuite?: boolean };
const ledger = JSON.parse(readFileSync(join(BLIND, "findings.json"), "utf8")) as { modules: Record<string, Mod>; findings: Finding[] };

/** The 12 modules plan W6.15 names (its second step). */
const SENSITIVE = ["keyring", "engine", "manifest", "header", "lockedNote", "redaction", "imageMetadata", "airplane", "workerLedger", "vault-relay", "linkShare", "privacyLedger"];

/** Finding ids in a text: F-<n> (not PDF-1.7 or UTF-16) and X-BL-<n>. */
function findingIds(text: string): string[] {
  return [...new Set([...text.matchAll(/(?<![A-Za-z-])(F-\d+|X-BL-\d+)\b/g)].map((m) => m[1]))].sort();
}

/** The ids named by each `it.fails(` case: its title and the comment lines right above it. */
function failsIds(text: string): string[] {
  const lines = text.split("\n");
  const out = new Set<string>();
  lines.forEach((l, i) => {
    if (!/\bit\.fails\s*\(/.test(l)) return;
    let j = i - 1;
    const ctx = [l];
    while (j >= 0 && /^\s*\/\//.test(lines[j])) ctx.push(lines[j--]);
    for (const id of findingIds(ctx.join("\n"))) out.add(id);
    if (!findingIds(ctx.join("\n")).length) out.add(`<unnamed it.fails at line ${i + 1}>`);
  });
  return [...out].sort();
}

const suiteText = (f: string) => readFileSync(join(BLIND, f), "utf8");
const suitesOf = (m: string) => ledger.modules[m]?.suites ?? [];

describe("blind suites: the findings record (W6.15)", () => {
  it("the id parsers: F-n and X-BL-n, not PDF-1.7 or UTF-16; it.fails ids come from the title and the comment above", () => {
    expect(findingIds("F-1 (Medium) … %PDF-1.7 … UTF-16 … X-BL-2, (F-10)")).toEqual(["F-1", "F-10", "X-BL-2"]);
    expect(failsIds("  // F-3 (Low): x\n  it.fails(\"y\", () => {});\n  it(\"(F-9) fine\", () => {});\n  it.fails(\"no id\", () => {});")).toEqual(["<unnamed it.fails at line 4>", "F-3"]);
  });

  it("all 12 sensitive modules have a blind suite that exists and says it is one; every suite is recorded", () => {
    expect(Object.keys(ledger.modules).filter((m) => ledger.modules[m].sensitive).sort()).toEqual([...SENSITIVE].sort());
    for (const m of SENSITIVE) {
      expect(suitesOf(m).length, m).toBeGreaterThan(0);
      for (const f of suitesOf(m)) {
        expect(existsSync(join(BLIND, f)), `${m}: ${f}`).toBe(true);
        expect(suiteText(f).slice(0, 400), f).toMatch(/Blind tests \(plan W6\.15/);
      }
    }
    const recorded = new Set(Object.values(ledger.modules).flatMap((m) => m.suites));
    const onDisk = readdirSync(BLIND).filter((f) => f.endsWith(".test.ts"));
    expect(onDisk.filter((f) => !recorded.has(f))).toEqual([]);
  });

  it("every id a suite mentions is recorded, and every recorded one is mentioned by its module's suites", () => {
    const known = new Set(ledger.findings.map((f) => f.id));
    expect(known.size).toBe(ledger.findings.length);
    const mentioned = new Set<string>();
    for (const f of readdirSync(BLIND).filter((x) => x.endsWith(".test.ts"))) for (const id of findingIds(suiteText(f))) mentioned.add(id);
    expect([...mentioned].filter((id) => !known.has(id))).toEqual([]);
    for (const f of ledger.findings) {
      expect(Object.keys(ledger.modules), f.id).toContain(f.module);
      expect(["bug", "ambiguity", "info"], f.id).toContain(f.kind);
      expect(f.kind === "bug" ? ["open", "fixed"] : ["noted"], f.id).toContain(f.status);
      if (f.status === "fixed") expect(f.fixedIn, f.id).toBeTruthy();
      if (f.inSuite === false) continue;
      const text = [f.module, ...(f.also ?? [])].flatMap(suitesOf).map(suiteText).join("\n");
      expect(findingIds(text), `${f.id} in the ${f.module} suites`).toContain(f.id);
    }
  });

  it("an open bug has an it.fails naming it; a fixed one has none; no it.fails is unaccounted for", () => {
    const open = new Set(ledger.findings.filter((f) => f.kind === "bug" && f.status === "open").map((f) => f.id));
    const fails = new Set<string>();
    for (const f of readdirSync(BLIND).filter((x) => x.endsWith(".test.ts"))) for (const id of failsIds(suiteText(f))) fails.add(id);
    expect([...fails].filter((id) => !open.has(id)).sort()).toEqual([]);
    expect([...open].filter((id) => !fails.has(id)).sort()).toEqual([]);
  });

  it("each module's bugsFound and open are what its findings add up to (recorded even when 0)", () => {
    for (const [m, mod] of Object.entries(ledger.modules)) {
      const bugs = ledger.findings.filter((f) => f.kind === "bug" && (f.module === m || (f.also ?? []).includes(m)));
      expect({ m, bugsFound: mod.bugsFound, open: mod.open }).toEqual({ m, bugsFound: bugs.length, open: bugs.filter((b) => b.status === "open").length });
    }
    // The totals, as the plan wants them recorded: 10 bugs across the suites (7 from #507, 3 from #756), 0 open.
    const bugs = ledger.findings.filter((f) => f.kind === "bug");
    expect([bugs.length, bugs.filter((b) => b.status === "open").length]).toEqual([10, 0]);
  });
});
