// @vitest-environment node
/**
 * Plan 14.5 — the public roadmap is generated from plan/plan.json by
 * `npm run plan`: every task's number, title and state, and nothing else.
 * The same check that keeps MASTER_PLAN.md in step (plan:check) keeps it
 * in step, so it updates with every plan change.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildModel,
  renderRoadmap,
  roadmapState,
  publicTitle,
  run,
  ROADMAP_FILE,
  // @ts-expect-error — plain .mjs script without type declarations
} from "../../scripts/plan/build.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { auditClaims } from "../../scripts/security/audit-claims.mjs";

const ROOT = resolve(__dirname, "..", "..");
const plan = () => JSON.parse(readFileSync(join(ROOT, "plan/plan.json"), "utf8"));
type Row = [string, "done" | "partial" | "planned", string];
const data = (html: string): [number, string, Row[]][] => {
  const m = /<script type="application\/json" id="roadmap-data">(.*?)<\/script>/s.exec(html)!;
  return JSON.parse(m[1]);
};

describe("public roadmap (14.5)", () => {
  it("a title loses its PR numbers and commit hashes, and reads without them (audit A4)", () => {
    expect(publicTitle("אשף ייבוא מכל מקור (חיזוק לייבוא הקיים ב-#176)")).toBe("אשף ייבוא מכל מקור (חיזוק לייבוא הקיים)");
    expect(publicTitle("4.2 תיקוני בטיחות העברת כספת מ-#235 \u200f2483bdca")).toBe("4.2 תיקוני בטיחות העברת כספת");
    expect(publicTitle("רכבת 6 — הגרסה המלאה ל-Mac: רכבת 5 + W9.8 + #617, #618, #619 + משימות הקוד האחרונות בענן")).toBe("רכבת 6 — הגרסה המלאה ל-Mac: רכבת 5 + W9.8 + משימות הקוד האחרונות בענן");
    expect(publicTitle("שער על מובי דיק (Gutenberg #2701)")).toBe("שער על מובי דיק (Gutenberg #2701)");
    expect(publicTitle("A title with no reference")).toBe("A title with no reference");
  });

  it("is the checked-in page, regenerated and checked with the board", () => {
    expect(run({ root: ROOT, check: true }).stale).toEqual([]);
    expect(readFileSync(join(ROOT, ROADMAP_FILE), "utf8")).toBe(renderRoadmap(buildModel(plan())));
  });

  it("maps statuses to three states", () => {
    expect(roadmapState("✅ #202")).toBe("done");
    expect(roadmapState("✅* #212 (מודל אמיתי — 15.3)")).toBe("done");
    expect(roadmapState("⏳ #234 (3 לילות)")).toBe("partial");
    expect(roadmapState(undefined)).toBe("planned");
    expect(roadmapState("⬜")).toBe("planned");
  });

  it("carries every phase and task of the plan, by number, title and state, in order", () => {
    const p = plan();
    const rows = data(renderRoadmap(buildModel(p)));
    expect(rows.map(([n, title]) => [n, title])).toEqual(p.phases.map((ph: { title: string }, i: number) => [i, ph.title]));
    p.phases.forEach((ph: { tasks: { id: string; title: string; status?: string }[] }, i: number) => {
      expect(rows[i][2]).toEqual(ph.tasks.map((t) => [t.id, roadmapState(t.status), publicTitle(t.title)]));
    });
  });

  it("publishes titles and states only: no steps, acceptance, estimates, dates, branches or owner items", () => {
    const p = plan();
    const html = renderRoadmap(buildModel(p));
    const tasks = p.phases.flatMap((ph: { tasks: { steps: string[]; acceptance: string[]; branch: string }[] }) => ph.tasks);
    for (const t of tasks.slice(0, 40)) {
      for (const line of [...t.steps, ...t.acceptance]) if (line.length > 25) expect(html).not.toContain(line);
      if (t.branch && t.branch !== "—") expect(html).not.toContain(`\`${t.branch}\``);
    }
    for (const o of p.owner) expect(html).not.toContain(o.title);
    expect(html).not.toMatch(/\d+ ש׳ \d+ דק׳/); // no estimates
    expect(html).not.toContain("#1"); // no PR numbers
    // Audit A4: no internal reference in any title — no PR number, no commit hash (an outside catalogue number, "Gutenberg #2701", stays).
    for (const [, title] of data(html).flatMap((r) => r[2]).map((r) => [r[0], r[2]])) {
      expect(title.replace(/Gutenberg #\d+/g, ""), title).not.toMatch(/#\d/);
      expect(title, title).not.toMatch(/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/);
    }
    // The counts in the hero come from the data.
    const rows = data(html).flatMap((r) => r[2]);
    const done = rows.filter((r) => r[1] === "done").length;
    expect(html).toContain(`${done} הושלמו`);
    expect(html).toContain(`aria-valuenow="${done}"`);
  });

  // INT4a: the rows sat on one line, so the audit-claim scan (W11.S1) read two
  // tasks' titles as one sentence: W13.S5's "ביקורת אבטחה" (audit funding) next
  // to W13.S6's "מוצפנת" was flagged as a claim that the crypto is audited.
  it("puts each task on its own line, so the audit-claim scan reads one title at a time (W11.S1)", () => {
    const p = plan();
    const last = p.phases[p.phases.length - 1].tasks;
    const at = last.length;
    last.push({ ...last[at - 1], id: "X.1", title: "funding for a security audit", dep: [] }, { ...last[at - 1], id: "X.2", title: "encrypted presence in the shared vault", dep: [] });
    const rows = data(renderRoadmap(buildModel(p))).at(-1)![2];
    expect(rows.slice(-2).map((r) => r[0])).toEqual(["X.1", "X.2"]);
    expect(auditClaims(renderRoadmap(buildModel(p)))).toEqual([]);
    expect(auditClaims(renderRoadmap(buildModel(plan())))).toEqual([]);
    expect(auditClaims("a security audit of the encryption")).not.toEqual([]);
  });

  it("renders with the external script under the app's CSP (no inline script, no handlers)", () => {
    const html = readFileSync(join(ROOT, ROADMAP_FILE), "utf8");
    expect(html).toContain('<script src="/roadmap.js" defer></script>');
    expect(html.match(/<script(?![^>]*type="application\/json")(?![^>]*src=)/g)).toBeNull();
    expect(html).not.toMatch(/\son\w+=/);
    expect(html).toMatch(/^<!doctype html>\n<html lang="he" dir="rtl">/);
    const js = readFileSync(join(ROOT, "public/roadmap.js"), "utf8");
    expect(js).toContain('document.getElementById("roadmap-data")');
    expect(js).not.toContain("innerHTML");
  });
});

describe("public roadmap docs", () => {
  it("has an English and a Hebrew page, both in the sidebar", () => {
    for (const p of ["docs/src/content/docs/project/roadmap.md", "docs/src/content/docs/he/project/roadmap.md"]) {
      const md = readFileSync(join(ROOT, p), "utf8");
      expect(md).toMatch(/^---\ntitle: .+\ndescription: .+\n---/);
      for (const s of ["plan/plan.json", "npm run plan:check", "public/roadmap.js"]) expect(md).toContain(s);
    }
    expect(readFileSync(join(ROOT, "docs/astro.config.mjs"), "utf8")).toContain('slug: "project/roadmap"');
  });
});
