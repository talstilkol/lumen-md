/**
 * W13.T2: the support policy and its check. The check must fail on an API
 * newer than the supported floor that is used without feature detection,
 * pass on the repository as it is, and refuse an empty or broken matrix
 * (a check with nothing to check is not a pass).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detected, matrixProblems, missingAt, scan, stripComments } from "../../scripts/lib/supportPolicy.mjs";
import { browserslistFor, problems } from "../../scripts/support-policy.mjs";
import { missingFeatures, shouldNotify } from "../boot/supportCheck";

const ROOT = process.cwd();
const matrix = JSON.parse(readFileSync(join(ROOT, "docs/support-matrix.json"), "utf8"));
const file = (text: string, path = "src/x.ts") => [{ path, text }];

describe("the repository keeps to its policy", () => {
  it("npm run support:check finds no problem", () => {
    expect(problems(ROOT)).toEqual([]);
  });

  it("the policy is in both languages and quotes the security period of security/disclosure.json", () => {
    const d = JSON.parse(readFileSync(join(ROOT, "security/disclosure.json"), "utf8"));
    const en = readFileSync(join(ROOT, "docs/support-policy.md"), "utf8");
    const he = readFileSync(join(ROOT, "docs/support-policy.he.md"), "utf8");
    expect(en).toContain(d.supportPeriod.en);
    expect(he).toContain(d.supportPeriod.he);
    expect(he).toMatch(/(?:[א-ת]+[\s,.]+){10}/);
    expect(en).toContain("Safari (macOS, iOS, iPadOS) | 26 and later");
  });
});

describe("the check fails on an API newer than the floor without feature detection", () => {
  it("Temporal (no Safari yet) used bare is flagged, with the engines that lack it", () => {
    const v = scan(file("export const now = () => Temporal.Now.instant();\n"), matrix);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ path: "src/x.ts", line: 1, feature: "Temporal" });
    expect(v[0].missing).toContain("safari");
  });

  it("the same use behind a capability check passes", () => {
    expect(scan(file('export const now = () => (typeof Temporal !== "undefined" ? Temporal.Now.instant() : null);'), matrix)).toEqual([]);
    expect(scan(file('if ("showDirectoryPicker" in window) await window.showDirectoryPicker();'), matrix)).toEqual([]);
    expect(scan(file("await window.showDirectoryPicker?.();"), matrix)).toEqual([]);
    expect(scan(file("if (window.showOpenFilePicker) { await window.showOpenFilePicker(); }"), matrix)).toEqual([]);
    expect(scan(file("// support-policy: guarded — the caller checks first\nawait window.showSaveFilePicker();"), matrix)).toEqual([]);
  });

  it("each kind of too-new use is caught", () => {
    for (const code of ["await window.showDirectoryPicker();", "requestIdleCallback(run);", "await scheduler.yield();", "const s = await LanguageModel.create();", "el.setHTML(html);", "const d = new EyeDropper();"]) {
      expect(scan(file(code), matrix), code).toHaveLength(1);
    }
  });

  it("an API inside the floor is never flagged; nor is one named only in a comment or a string", () => {
    expect(scan(file("const c = structuredClone(x); const s = a.union(b); const u = URL.parse(h);"), matrix)).toEqual([]);
    expect(scan(file("/* Temporal.Now.instant() later */\n// requestIdleCallback(f)\nconst s = 'scheduler.yield()';"), matrix)).toEqual([]);
  });

  it("raising the floor's demands flags what was fine: Safari 17 lacks URL.parse", () => {
    const old = { ...matrix, floor: { ...matrix.floor, safari: 17.0 } };
    expect(scan(file("const u = URL.parse(h);"), old)).toHaveLength(1);
    expect(missingAt({ chrome: 126, firefox: 126, safari: 18 }, old.floor)).toEqual(["safari"]);
    expect(missingAt({ chrome: 126, firefox: 126, safari: 18 }, matrix.floor)).toEqual([]);
    expect(missingAt({ chrome: 145, firefox: 126, safari: 18 }, matrix.floor)).toEqual(["chrome", "edge"]);
  });
});

describe("a check with nothing to check fails", () => {
  it("an empty or broken matrix is refused", () => {
    expect(matrixProblems({})).not.toEqual([]);
    expect(matrixProblems({ ...matrix, features: [] })).toEqual(expect.arrayContaining([expect.stringMatching(/too short/)]));
    expect(matrixProblems({ ...matrix, features: [...matrix.features, { id: "bad", use: "(", chrome: 1, firefox: 1, safari: 1 }] })).toEqual(expect.arrayContaining([expect.stringMatching(/regular expression/)]));
    expect(matrixProblems({ ...matrix, floor: { chrome: 140 } })).not.toEqual([]);
    expect(matrixProblems(matrix)).toEqual([]);
  });

  it("browserslist follows the floor", () => {
    expect(browserslistFor(matrix)).toEqual(["chrome >= 140", "edge >= 140", "firefox >= 140", "safari >= 18", "ios_saf >= 18", "and_chr >= 140"]);
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.browserslist).toEqual(browserslistFor(matrix));
  });
});

describe("helpers", () => {
  it("stripComments keeps lines and strings", () => {
    expect(stripComments("a // b\n/* c\nd */ 'e // f'")).toBe("a     \n    \n     'e // f'");
  });
  it("detected sees typeof, in, if (x.y), !x.y and optional checks", () => {
    expect(detected("typeof window.gpu", ["gpu"])).toBe(true);
    expect(detected("if (!navigator.gpu) return", ["gpu"])).toBe(true);
    expect(detected("navigator.gpu.requestAdapter()", ["gpu"])).toBe(false);
  });
});

describe("the in-app notice", () => {
  it("a current engine (this one) misses nothing", () => {
    expect(missingFeatures()).toEqual([]);
  });

  it("an old engine is named by what it lacks", () => {
    const old = { URL: function () {}, Promise: {}, Set: { prototype: {} }, Intl: {} } as unknown as typeof globalThis;
    expect(missingFeatures(old)).toEqual(["URL.parse", "Promise.withResolvers", "Set.prototype.union", "Intl.Segmenter"]);
  });

  it("is shown once per version, never when supported, and always when storage is blocked", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null };
    expect(shouldNotify([], "1.5.0", s)).toBe(false);
    expect(shouldNotify(["URL.parse"], "1.5.0", s)).toBe(true);
    m.set("lumen-support-notice", "1.5.0");
    expect(shouldNotify(["URL.parse"], "1.5.0", s)).toBe(false);
    expect(shouldNotify(["URL.parse"], "1.6.0", s)).toBe(true);
    expect(shouldNotify(["URL.parse"], "1.5.0", { getItem: () => { throw new Error("blocked"); } })).toBe(true);
  });
});
