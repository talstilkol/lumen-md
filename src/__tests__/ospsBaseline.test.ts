/**
 * W13.X4 — .bestpractices.json: the OSPS Baseline answers with evidence.
 * Every criterion has a status and a justification; every evidence path
 * exists (the check fails when evidence is deleted); a "Met" without
 * evidence is not allowed; what only the owner can confirm, and the Level 2
 * gaps, are named, never hidden; the flat fields bestpractices.dev reads
 * agree with the structured ones.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
type Criterion = { level: 1 | 2; title: string; status: "Met" | "Unmet" | "Unknown"; justification: string; evidence: string[]; owner?: string; gap?: string };
type Baseline = { baseline_version: string; criteria: Record<string, Criterion>; [k: string]: unknown };

/** The problems of a baseline file against a tree (`exists` is injectable so the test can delete evidence). */
function baselineProblems(b: Baseline, exists: (p: string) => boolean): string[] {
  const out: string[] = [];
  const ids = Object.keys(b.criteria ?? {});
  if (!ids.length) out.push("no criteria");
  for (const id of ids) {
    const c = b.criteria[id];
    if (!/^OSPS-[A-Z]{2}-\d{2}\.\d{2}$/.test(id)) out.push(`${id}: not an OSPS id`);
    if (!["Met", "Unmet", "Unknown"].includes(c.status)) out.push(`${id}: status ${c.status}`);
    if (!c.justification?.trim()) out.push(`${id}: no justification`);
    if (c.status === "Met" && !c.evidence.length) out.push(`${id}: Met without evidence`);
    if (c.status !== "Met" && !c.owner && !c.gap) out.push(`${id}: ${c.status} without an owner step or a gap task`);
    for (const e of c.evidence) if (!exists(e)) out.push(`${id}: evidence ${e} does not exist`);
    const key = id.toLowerCase().replace(/[-.]/g, "_");
    if (b[`${key}_status`] !== c.status) out.push(`${id}: ${key}_status differs`);
    if (typeof b[`${key}_justification`] !== "string" || !(b[`${key}_justification`] as string).startsWith(c.justification)) out.push(`${id}: ${key}_justification differs`);
  }
  return out;
}

const file = JSON.parse(readFileSync(join(ROOT, ".bestpractices.json"), "utf8")) as Baseline;
const inRepo = (p: string) => existsSync(join(ROOT, p));

describe(".bestpractices.json (OSPS Baseline)", () => {
  it("is consistent and every evidence path exists", () => {
    expect(file.baseline_version).toBe("2025.10.10");
    expect(baselineProblems(file, inRepo)).toEqual([]);
  });

  it("covers the Level 1 criteria: each is Met with evidence, or names the owner step or the gap", () => {
    const l1 = Object.entries(file.criteria).filter(([, c]) => c.level === 1);
    expect(l1.length).toBeGreaterThanOrEqual(20);
    const met = l1.filter(([, c]) => c.status === "Met");
    const pending = l1.filter(([, c]) => c.status !== "Met").map(([id, c]) => `${id}: ${c.owner ?? c.gap}`);
    // The honest count, kept in the test so a change shows up here.
    expect({ met: met.length, total: l1.length, pending }).toEqual({
      met: 21,
      total: 24,
      pending: [
        "OSPS-AC-01.01: W13.X3: confirm 2FA on the admin account on bestpractices.dev",
        "OSPS-AC-02.01: W13.X3: confirm collaborator default permissions",
        "OSPS-LE-03.02: Ship LICENSE and THIRD_PARTY_NOTICES.md in every release artefact, and make release-gate check it",
      ],
    });
  });

  it("fails when evidence is deleted", () => {
    const gone = new Set(["SECURITY.md", "security/github-ruleset.json"]);
    const p = baselineProblems(file, (x) => !gone.has(x) && inRepo(x));
    expect(p).toContain("OSPS-VM-02.01: evidence SECURITY.md does not exist");
    expect(p).toContain("OSPS-AC-03.01: evidence security/github-ruleset.json does not exist");
    expect(p).toContain("OSPS-AC-03.02: evidence security/github-ruleset.json does not exist");
  });

  it("refuses a Met without evidence, an unexplained Unmet, and an empty file", () => {
    const bad = (c: Partial<Criterion>) => baselineProblems({ baseline_version: "x", criteria: { "OSPS-XX-01.01": { level: 1, title: "t", status: "Met", justification: "j", evidence: [], ...c } }, "osps_xx_01_01_status": c.status ?? "Met", "osps_xx_01_01_justification": "j" } as Baseline, () => true);
    expect(bad({})).toEqual(["OSPS-XX-01.01: Met without evidence"]);
    expect(bad({ status: "Unmet" })).toEqual(["OSPS-XX-01.01: Unmet without an owner step or a gap task"]);
    expect(baselineProblems({ baseline_version: "x", criteria: {} }, () => true)).toEqual(["no criteria"]);
  });

  it("names the Level 2 gaps as tasks", () => {
    const gaps = Object.entries(file.criteria).filter(([, c]) => c.level === 2 && c.status !== "Met");
    expect(gaps.map(([id]) => id).sort()).toEqual(["OSPS-LE-01.01", "OSPS-VM-03.01"]);
    for (const [, c] of gaps) expect(c.gap ?? c.owner).toBeTruthy();
  });
});
