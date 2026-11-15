/**
 * Plan 10.3 (W10.E23): the visual gate fails without baselines, or with
 * baselines rendered by another Chromium, and says why (scripts/visual-stamp.mjs).
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
// @ts-expect-error — plain .mjs module without type declarations
import { BASELINES, STAMP, baselineDir, makeStamp, stampProblems } from "../../scripts/lib/visualStamp.mjs";

const here = { platform: "darwin", chromium: "141.0.7390.37" };

describe("visual baselines stamp", () => {
  it("no folder, an empty folder, or PNGs without a stamp: the gate fails, naming visual:approve", () => {
    for (const files of [null, [], [STAMP]]) {
      const p = stampProblems(here, files, null);
      expect(p).toHaveLength(1);
      expect(p[0]).toContain("no baselines for darwin");
      expect(p[0]).toContain("npm run visual:approve -- visual");
    }
    expect(stampProblems(here, ["split--en-light.png"], null)[0]).toContain(`${STAMP} is missing`);
  });

  it("baselines from another Chromium or platform are not compared", () => {
    const stamp = makeStamp({ platform: "darwin", chromium: "140.0.0.0", os: "darwin 25 arm64", renderedAt: "2026-11-15T00:00:00Z" }, 1);
    expect(stampProblems(here, ["a.png", STAMP], stamp)).toEqual([expect.stringContaining("Chromium 140.0.0.0, this run has 141.0.7390.37")]);
    const linux = makeStamp({ ...here, platform: "linux", os: "linux", renderedAt: "x" }, 1);
    expect(stampProblems(here, ["a.png", STAMP], linux)).toEqual([expect.stringContaining("written on linux, this is darwin")]);
  });

  it("the same platform and Chromium: nothing in the way", () => {
    const stamp = makeStamp({ ...here, os: "darwin 25 arm64", renderedAt: "2026-11-15T00:00:00Z" }, 44);
    expect(stamp).toMatchObject({ platform: "darwin", chromium: here.chromium, pngs: 44 });
    expect(stampProblems(here, ["a.png", STAMP], stamp)).toEqual([]);
  });

  it("the folder is playwright.visual.config.ts's snapshot folder", () => {
    const config = readFileSync("playwright.visual.config.ts", "utf8");
    expect(config).toContain('snapshotPathTemplate: "{testDir}/__baselines__/{platform}/{arg}{ext}"');
    expect(config).toContain('testDir: "./visual"');
    expect(BASELINES).toBe("visual/__baselines__");
    expect(baselineDir("darwin")).toBe("visual/__baselines__/darwin");
  });

  it("this tree has no baselines yet, so the gate's first step fails here (they come from the Mac)", () => {
    expect(existsSync(baselineDir(process.platform))).toBe(false);
  });

  it("visual:approve stamps the visual suite after a successful run, and only then", () => {
    const src = readFileSync("scripts/visual-approve.mjs", "utf8");
    expect(src).toMatch(/suite === "visual" && r\.status === 0\) spawnSync\(process\.execPath, \["scripts\/visual-stamp\.mjs", "--write"\]/);
  });

  it("the CLI without a mode prints usage and exits 1", () => {
    const r = spawnSync(process.execPath, ["scripts/visual-stamp.mjs"], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage:");
  });
});
