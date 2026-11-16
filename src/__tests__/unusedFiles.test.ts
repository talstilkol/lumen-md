// @vitest-environment node
/**
 * Plan 0.16 — the unused-file gate (scripts/check-unused-files.mjs): a new
 * production file that nothing imports fails CI; the baseline only shrinks.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  findOrphans,
  compare,
  extractSpecifiers,
  htmlEntries,
  globToRegExp,
  resolveSpecifier,
  isProduction,
  isEntryFile,
  BASELINE,
  LIBRARY,
  isTestFile,
  // @ts-expect-error — plain .mjs script without type declarations
} from "../../scripts/check-unused-files.mjs";

const ROOT = resolve(__dirname, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "lumen-unused-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function repo(name: string, files: Record<string, string>): string {
  const dir = join(tmp, name);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

describe("findOrphans", () => {
  it("a file nobody imports is an orphan; everything reachable from the page is not", () => {
    const dir = repo("basic", {
      "index.html": '<script type="module" src="/src/main.tsx"></script>',
      "src/main.tsx": 'import { a } from "./a";\nimport "@/styles/boot";\nconst B = lazy(() => import("./lazy/B"));\n',
      "src/a.ts": "export const a = 1;\n",
      "src/styles/boot.ts": "export {};\n",
      "src/lazy/B.tsx": 'export { w } from "../w";\n',
      "src/w.ts": 'export const w = new Worker(new URL("./x.worker.ts", import.meta.url));\n',
      "src/x.worker.ts": "self.onmessage = () => {};\n",
      "src/orphan.ts": "export const nobody = 1;\n",
    });
    expect(findOrphans({ root: dir }).orphans).toEqual(["src/orphan.ts"]);
  });

  it("tests and e2e are NOT entry points (audit A3): a module only its test imports is unreachable from the app; scripts are entry points", () => {
    const dir = repo("tests", {
      "index.html": '<script type="module" src="/src/main.ts"></script>',
      "src/main.ts": 'import { d } from "./d";\n',
      "src/d.ts": "export const d = 1;\n",
      "src/__tests__/a.test.ts": 'import { a } from "../a";\n',
      "src/a.ts": "export const a = 1;\n",
      "e2e/x.spec.ts": 'import { b } from "../src/b";\n',
      "src/b.ts": "export const b = 1;\n",
      "tests/helper.ts": 'import { h } from "../src/h";\n',
      "src/h.ts": "export const h = 1;\n",
      "scripts/tool.mjs": 'import { s } from "../src/s.ts";\n',
      "src/s.ts": "export const s = 1;\n",
      "src/c.ts": "export const c = 1;\n",
    });
    const r = findOrphans({ root: dir });
    expect(r.orphans).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/h.ts"]);
    // a, b and h are built and tested but unreachable; c is reached by nothing at all.
    expect(r.testOnly).toEqual(["src/a.ts", "src/b.ts", "src/h.ts"]);
    for (const f of ["src/__tests__/a.test.ts", "e2e/x.spec.ts", "tests/helper.ts", "src/x.eval.ts", "packages/p/test/a.test.ts", "src/__mocks__/m.ts"]) expect(isTestFile(f)).toBe(true);
    expect(isTestFile("scripts/tool.mjs")).toBe(false);
  });

  it("a script that bundles a source file by its path reaches it (mcp-server's build(\"src/types/api.ts\"))", () => {
    const dir = repo("bundled", {
      "mcp-server/scripts/bundle.mjs": 'await build("src/types/api.ts", out);\n',
      "src/types/api.ts": 'import "./dep";\n',
      "src/types/dep.ts": "export {};\n",
      "src/types/other.ts": "export {};\n",
    });
    expect(findOrphans({ root: dir }).orphans).toEqual(["src/types/other.ts"]);
  });

  it("executables and packages outside src/ are roots too (bin/, api-server/, packages/ …)", () => {
    const dir = repo("roots", {
      "bin/lumen.ts": 'import { cli } from "../src/cli/run";\n',
      "api-server/server.ts": 'import { api } from "../src/api/handler";\n',
      "packages/vscode/src/extension.ts": 'import { x } from "../../../src/shared/x";\n',
      "src/cli/run.ts": "export const cli = 1;\n",
      "src/api/handler.ts": "export const api = 1;\n",
      "src/shared/x.ts": "export const x = 1;\n",
      "src/dead.ts": "export const dead = 1;\n",
    });
    expect(findOrphans({ root: dir }).orphans).toEqual(["src/dead.ts"]);
    expect(isEntryFile("bin/lumen.ts")).toBe(true);
    expect(isEntryFile("src/a.ts")).toBe(false);
    expect(isEntryFile("src/__tests__/a.test.ts")).toBe(false);
    expect(isEntryFile("e2e/a.spec.ts")).toBe(false);
  });

  it("import.meta.glob marks every match as used", () => {
    const dir = repo("glob", {
      "index.html": '<script type="module" src="/src/main.ts"></script>',
      "src/main.ts": 'const m = import.meta.glob("./langs/*.ts");\n',
      "src/langs/he.ts": "export {};\n",
      "src/langs/en.ts": "export {};\n",
    });
    expect(findOrphans({ root: dir }).orphans).toEqual([]);
  });

  it("a negative import.meta.glob pattern excludes its file, which is then an orphan (Codex P2, #266)", () => {
    const dir = repo("glob-neg", {
      "index.html": '<script type="module" src="/src/main.ts"></script>',
      "src/main.ts": 'const m = import.meta.glob(["./features/*.ts", "!./features/dead.ts"]);\n',
      "src/features/live.ts": "export {};\n",
      "src/features/dead.ts": "export {};\n",
    });
    expect(findOrphans({ root: dir }).orphans).toEqual(["src/features/dead.ts"]);
    const { globs } = extractSpecifiers('import.meta.glob(["./a/*.ts", "!./a/x.ts"]); import.meta.glob("./b/*.ts");');
    expect(globs).toEqual([["./a/*.ts", "!./a/x.ts"], ["./b/*.ts"]]);
  });
});

describe("the parts", () => {
  it("a Vitest config's setupFiles reach their files, from the repository root (W10.F16 on train 6)", () => {
    expect(extractSpecifiers('defineConfig({ test: { setupFiles: ["src/agents/eval/reproducible.ts", "./local.ts"] } })').specs).toEqual(["/src/agents/eval/reproducible.ts", "./local.ts"]);
    const dir = repo("setup-files", {
      "vitest.eval.config.ts": 'export default { test: { setupFiles: ["src/eval/setup.ts"] } };\n',
      "src/eval/setup.ts": "export {};\n",
      "src/eval/orphan.ts": "export {};\n",
    });
    expect(findOrphans({ root: dir }).orphans).toEqual(["src/eval/orphan.ts"]);
  });

  it("extracts every kind of specifier", () => {
    const { specs, globs } = extractSpecifiers(
      [
        'import a from "./a";',
        "export * from './b';",
        'import "./c.css";',
        'await import("./d");',
        'require("./e");',
        'vi.mock("./f");',
        'new Worker(new URL("./g.worker.ts", import.meta.url));',
        'import.meta.glob(["./h/*.ts", "./i/**/*.ts"]);',
      ].join("\n"),
    );
    expect(specs).toEqual(["./a", "./b", "./c.css", "./d", "./e", "./f", "./g.worker.ts"]);
    expect(globs).toEqual([["./h/*.ts", "./i/**/*.ts"]]);
  });

  it("resolves relative, alias, extensionless, .js-for-.ts, index and ?worker specifiers", () => {
    const files = new Set(["src/a.ts", "src/b/index.tsx", "src/c.ts", "src/d.worker.ts"]);
    expect(resolveSpecifier("./a", "src/x.ts", files)).toBe("src/a.ts");
    expect(resolveSpecifier("@/b", "src/deep/x.ts", files)).toBe("src/b/index.tsx");
    expect(resolveSpecifier("../c.js", "src/deep/x.ts", files)).toBe("src/c.ts");
    expect(resolveSpecifier("./d.worker.ts?worker", "src/x.ts", files)).toBe("src/d.worker.ts");
    expect(resolveSpecifier("react", "src/x.ts", files)).toBeNull();
  });

  it("reads module scripts from HTML, skipping remote ones", () => {
    expect(htmlEntries('<script src="/theme-boot.js"></script><script type="module" src="/src/main.tsx"></script><script src="https://x.y/z.js"></script>')).toEqual([
      "theme-boot.js",
      "src/main.tsx",
    ]);
  });

  it("globs: * stays in one folder, ** crosses folders", () => {
    expect(globToRegExp("src/a/*.ts").test("src/a/b.ts")).toBe(true);
    expect(globToRegExp("src/a/*.ts").test("src/a/x/b.ts")).toBe(false);
    expect(globToRegExp("src/**/*.ts").test("src/a/x/b.ts")).toBe(true);
    expect(globToRegExp("src/*.{ts,tsx}").test("src/b.tsx")).toBe(true);
  });

  it("tests, eval suites and declarations are not production files", () => {
    expect(isProduction("src/a.ts")).toBe(true);
    for (const f of ["src/__tests__/a.ts", "src/a.test.ts", "src/a.spec.tsx", "src/agents/eval/x.eval.ts", "src/types.d.ts", "scripts/a.mjs"]) {
      expect(isProduction(f)).toBe(false);
    }
  });
});

describe("the gate", () => {
  it("a new orphan fails; a baseline entry that is used again must be pruned", () => {
    expect(compare(["src/old.ts", "src/new.ts"], ["src/old.ts"])).toMatchObject({ added: ["src/new.ts"], stale: [] });
    expect(compare([], ["src/old.ts"])).toMatchObject({ added: [], stale: ["src/old.ts"] });
  });

  it("a file only a baseline orphan imports is held by it; a file nothing imports still fails", () => {
    const dir = repo("held", {
      "index.html": '<script type="module" src="/src/main.ts"></script>',
      "src/main.ts": "export {};\n",
      "src/dead.ts": 'import "./deadStrings";\n',
      "src/deadStrings.ts": 'import "./deadDeeper";\n',
      "src/deadDeeper.ts": "export {};\n",
      "src/newOrphan.ts": "export {};\n",
    });
    const { orphans, held } = findOrphans({ root: dir, baseline: ["src/dead.ts"] });
    expect(orphans).toEqual(["src/dead.ts", "src/deadDeeper.ts", "src/deadStrings.ts", "src/newOrphan.ts"]);
    expect(held).toEqual({ "src/deadStrings.ts": "src/dead.ts", "src/deadDeeper.ts": "src/dead.ts" });
    expect(compare(orphans, ["src/dead.ts"], held)).toMatchObject({ added: ["src/newOrphan.ts"], stale: [] });
    // Without the baseline entry nothing is held: all three are new orphans.
    expect(compare(orphans, [], findOrphans({ root: dir }).held).added).toEqual(["src/dead.ts", "src/deadDeeper.ts", "src/deadStrings.ts", "src/newOrphan.ts"]);
  });

  it("an HTML page in a folder of its own is an entry (bench/models.html)", () => {
    const dir = repo("subpage", {
      "index.html": '<script type="module" src="/src/main.ts"></script>',
      "bench/models.html": '<script type="module" src="/src/bench/page.ts"></script>',
      "src/main.ts": "export {};\n",
      "src/bench/page.ts": 'import "./engine";\n',
      "src/bench/engine.ts": "export {};\n",
    });
    expect(findOrphans({ root: dir }).orphans).toEqual([]);
  });

  it("a library-listed file: allowed while only tests reach it; fails once the app reaches it, when no test does, or without a reason", () => {
    const lib = { "src/lib.ts": "An eval harness, run by the eval suite only (test)." };
    expect(compare(["src/lib.ts"], [], {}, lib, ["src/lib.ts"])).toEqual({ added: [], stale: [], libraryReached: [], libraryDead: [], libraryNoReason: [] });
    expect(compare([], [], {}, lib, []).libraryReached).toEqual(["src/lib.ts"]);
    expect(compare(["src/lib.ts"], [], {}, lib, []).libraryDead).toEqual(["src/lib.ts"]);
    expect(compare(["src/lib.ts"], [], {}, { "src/lib.ts": "x" }, ["src/lib.ts"]).libraryNoReason).toEqual(["src/lib.ts"]);
    // A file only a library entry imports is held by it.
    const dir = repo("held-lib", {
      "index.html": '<script type="module" src="/src/main.ts"></script>',
      "src/main.ts": "export {};\n",
      "src/harness.ts": 'import "./harnessData";\n',
      "src/harnessData.ts": "export {};\n",
      "src/__tests__/h.test.ts": 'import "../harness";\n',
    });
    expect(findOrphans({ root: dir, library: ["src/harness.ts"] }).held).toEqual({ "src/harnessData.ts": "src/harness.ts" });
  });

  it("the checked-in tree matches the baseline and the library list exactly", () => {
    const baseline: string[] = JSON.parse(readFileSync(join(ROOT, BASELINE), "utf8")).files;
    const library: Record<string, string> = JSON.parse(readFileSync(join(ROOT, LIBRARY), "utf8")).files;
    const { orphans, held, testOnly } = findOrphans({ root: ROOT, baseline, library: Object.keys(library) });
    expect(compare(orphans, baseline, held, library, testOnly)).toEqual({ added: [], stale: [], libraryReached: [], libraryDead: [], libraryNoReason: [] });
  });
});
