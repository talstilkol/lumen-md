// @vitest-environment node
/**
 * Plan 0.16 (W10.E24): unused files fail in all three gates (Vercel build,
 * ci:local, Buildkite), and knip's unused exports and dependencies run
 * against a baseline that only goes down. The knip report below is a
 * synthetic sample of knip's JSON reporter shape, not a real run.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
// @ts-expect-error — plain .mjs module without type declarations
import { compare, issueKeys, shrink } from "../../scripts/knip-gate.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { findOrphans } from "../../scripts/check-unused-files.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { GATES, PREVIEW_GATES } from "../../scripts/vercel-build.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { planSteps } from "../../scripts/lib/ciLocal.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { buildPipeline, pipelineRules } from "../../scripts/buildkite/lib.mjs";

type Step = { id: string; cmd: string[]; skipReason?: string };
type BkStep = { key: string; command: string; if?: string };
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const ci = () => parse(readFileSync("docs/archive/workflows/ci.yml", "utf8"), { uniqueKeys: false });

describe("a new orphan file fails, in every gate", () => {
  it("check-unused-files finds a src/ file nothing imports", () => {
    const root = mkdtempSync(join(tmpdir(), "orphan-"));
    try {
      const put = (f: string, t: string) => {
        mkdirSync(join(root, f, ".."), { recursive: true });
        writeFileSync(join(root, f), t);
      };
      put("index.html", '<script type="module" src="/src/main.tsx"></script>');
      put("src/main.tsx", 'import { a } from "./a";\nconsole.info(a);\n');
      put("src/a.ts", "export const a = 1;\n");
      expect(findOrphans({ root }).orphans).toEqual([]);
      put("src/orphan.ts", "export const nobody = 2;\n");
      expect(findOrphans({ root }).orphans).toEqual(["src/orphan.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the Vercel preview build runs it", () => {
    expect(PREVIEW_GATES).toContain("unused");
    expect(GATES.unused).toEqual(["run", "-s", "unused"]);
    expect(pkg.scripts.unused).toBe("node scripts/check-unused-files.mjs");
  });

  it("ci:local runs it, and knip where knip is installed (else it says why it did not)", () => {
    const byId = (steps: Step[]) => Object.fromEntries(steps.map((s) => [s.id, s]));
    const without = byId(planSteps({ pkg, exists: (p: string) => p !== "node_modules/knip/package.json", changed: null, flags: {} }));
    expect(without.unused.cmd).toEqual(["npm", "run", "-s", "unused"]);
    expect(without.unused.skipReason).toBeUndefined();
    expect(without.knip.skipReason).toContain("knip is not installed");
    const withKnip = byId(planSteps({ pkg, exists: () => true, changed: null, flags: {} }));
    expect(withKnip.knip.cmd).toEqual(["node", "scripts/knip-gate.mjs"]);
    expect(withKnip.knip.skipReason).toBeUndefined();
  });

  it("Buildkite runs ci.yml's unused-files step in `static` and knip in `deadcode`, on every build", () => {
    const committed = parse(readFileSync(".buildkite/pipeline.yml", "utf8")).steps as BkStep[];
    expect(committed.find((s) => s.key === "static")?.command).toContain("Unused files");
    const dead = committed.find((s) => s.key === "deadcode");
    expect(dead?.command).toContain("node scripts/knip-gate.mjs");
    expect(dead?.if).toBeUndefined();
    expect(pipelineRules(buildPipeline(ci()))).toEqual([]);
    const p = buildPipeline(ci());
    p.steps = p.steps.filter((s: BkStep) => s.key !== "deadcode");
    expect(pipelineRules(p).join("\n")).toContain("no deadcode job");
  });
});

describe("the knip baseline only goes down", () => {
  const report = {
    files: ["src/old.ts"],
    issues: [
      { file: "package.json", dependencies: [{ name: "left-pad" }], devDependencies: [{ name: "old-tool" }] },
      { file: "src/util.ts", exports: [{ name: "unusedHelper", line: 3 }], types: [{ name: "OldType" }] },
      { file: "src/enum.ts", enumMembers: { Color: [{ name: "Teal" }] } },
    ],
  };

  it("flattens knip's issues into stable keys (files are check-unused-files' job)", () => {
    expect(issueKeys(report)).toEqual(["dependencies package.json left-pad", "devDependencies package.json old-tool", "enumMembers src/enum.ts Teal", "exports src/util.ts unusedHelper", "types src/util.ts OldType"]);
  });

  it("a new issue fails; a fixed one lets the baseline shrink; writing never adds", () => {
    const base = issueKeys(report);
    const now = [...base.filter((k: string) => !k.includes("left-pad")), "exports src/new.ts brandNew"].sort();
    const c = compare(now, base);
    expect(c.added).toEqual(["exports src/new.ts brandNew"]);
    expect(c.fixed).toEqual(["dependencies package.json left-pad"]);
    const next = shrink(now, base);
    expect(next).not.toContain("exports src/new.ts brandNew");
    expect(next).not.toContain("dependencies package.json left-pad");
    expect(next.length).toBe(base.length - 1);
  });

  it("knip.json points at the app's real entries", () => {
    const k = JSON.parse(readFileSync("knip.json", "utf8"));
    expect(k.entry).toContain("src/main.tsx");
    expect(k.entry).toContain("index.html");
    expect(pkg.scripts.deadcode).toBe("node scripts/knip-gate.mjs");
  });
});
