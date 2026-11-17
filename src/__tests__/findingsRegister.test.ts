/**
 * Plan W9.5 acceptance: "0 findings without a fix or a documented decision",
 * checked in the repository instead of a PR table. docs/security/findings-w95.json
 * lists every low and info finding of reviews 6–34 with what was done:
 *   fixed          a test (file + the words of its case) and the fixing commit
 *   accepted       an entry in accepted-risks.md, English and Hebrew
 *   closed         a line in that page's "Closed without a change"
 *   fixed-earlier  the review that confirmed it, or a commit on the train
 * And the other way: every entry of accepted-risks.md is in the register.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(__dirname, "..", "..");
interface Finding {
  id: string;
  /** The name in the Hebrew part, when it differs. */
  he?: string;
  reviews: string;
  severity: string;
  action: "fixed" | "accepted" | "closed" | "fixed-earlier";
  test?: { file: string; case: string };
  commit?: string;
  evidence?: string;
}
const register = JSON.parse(readFileSync(join(ROOT, "docs/security/findings-w95.json"), "utf8")) as { findings: Finding[] };
const F = register.findings;
const doc = readFileSync(join(ROOT, "docs/security/accepted-risks.md"), "utf8");
const [en, he] = doc.split(/\n---\n/);
/** The bold ids that open each entry of a part ("- **X6 / RR11-451-2** (…"). */
const entryIds = (part: string) => [...part.matchAll(/^- \*\*([^*]+)\*\*/gm)].map((m) => m[1]);
const closedSection = (part: string) => part.split(/^## (?:Closed without a change|נסגרו בלי שינוי)$/m)[1] ?? "";
const git = (...args: string[]) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });

describe("the W9.5 findings register", () => {
  it("is not empty, and every finding has one known action, a review and a severity", () => {
    expect(F.length).toBeGreaterThanOrEqual(100);
    for (const f of F) {
      expect(["fixed", "accepted", "closed", "fixed-earlier"], f.id).toContain(f.action);
      expect(f.reviews, f.id).toMatch(/\S/);
      expect(["low", "info"], f.id).toContain(f.severity);
    }
    expect(F.map((f) => f.id).filter((id, i, a) => a.indexOf(id) !== i)).toEqual([]);
  });

  it("a fixed finding names a test file that holds its case, and the fixing commit", () => {
    const fixed = F.filter((f) => f.action === "fixed" || f.test);
    expect(fixed.length).toBeGreaterThanOrEqual(6);
    for (const f of fixed) {
      expect(f.test, f.id).toBeDefined();
      const file = join(ROOT, f.test!.file);
      expect(existsSync(file), `${f.id}: ${f.test!.file}`).toBe(true);
      expect(readFileSync(file, "utf8").includes(f.test!.case), `${f.id}: "${f.test!.case}" in ${f.test!.file}`).toBe(true);
      expect(f.commit, f.id).toMatch(/^[0-9a-f]{10,40}$/);
    }
  });

  it("an accepted finding is an entry of accepted-risks.md in both languages", () => {
    const enIds = entryIds(en).join("\n");
    const heIds = entryIds(he).join("\n");
    const missing = F.filter((f) => f.action === "accepted").filter((f) => !enIds.includes(f.id) || !heIds.includes(f.he ?? f.id));
    expect(missing.map((f) => f.id)).toEqual([]);
  });

  it("a closed finding is named under 'Closed without a change' in both languages", () => {
    const missing = F.filter((f) => f.action === "closed").filter((f) => !closedSection(en).includes(f.id) || !closedSection(he).includes(f.he ?? f.id));
    expect(missing.map((f) => f.id)).toEqual([]);
  });

  it("a finding fixed earlier says which review or which commit confirmed it", () => {
    for (const f of F.filter((x) => x.action === "fixed-earlier")) {
      expect(!!f.commit || /\b(?:r\d+|#\d+)\b/.test(f.evidence ?? ""), f.id).toBe(true);
    }
  });

  it("every entry of accepted-risks.md is in the register (none is documented and forgotten)", () => {
    const ids = F.map((f) => f.id);
    const orphan = entryIds(en).filter((entry) => !ids.some((id) => entry.includes(id)));
    expect(entryIds(en).length).toBeGreaterThanOrEqual(25);
    expect(orphan).toEqual([]);
  });

  it("every named commit is on this branch (in a full clone)", () => {
    const shallow = git("rev-parse", "--is-shallow-repository").stdout.trim();
    const commits = [...new Set(F.map((f) => f.commit).filter((c): c is string => !!c))];
    expect(commits.length).toBeGreaterThanOrEqual(10);
    if (shallow !== "false") return; // a shallow CI checkout can't see history; the format check above still ran
    const missing = commits.filter((c) => git("merge-base", "--is-ancestor", c, "HEAD").status !== 0);
    expect(missing).toEqual([]);
  });
});
