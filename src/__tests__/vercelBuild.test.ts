/**
 * W1.35: the Vercel build is the gate. A preview runs every check; a
 * production build only builds; the deploy config calls the script.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { GATES, PREVIEW_GATES, PRODUCTION_GATES, gatesFor } from "../../scripts/vercel-build.mjs";

const ROOT = resolve(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };

describe("scripts/vercel-build.mjs", () => {
  it("runs every gate on a preview, and only build + budget in production", () => {
    expect(gatesFor({ VERCEL_ENV: "preview" })).toEqual(["build", "budget", "vitest", "i18n:check", "hygiene", "docs:sync", "licenses"]);
    expect(gatesFor({ VERCEL_ENV: "production" })).toEqual(["build", "budget"]);
    // Not on Vercel: a local run reproduces a preview build.
    expect(gatesFor({})).toEqual(PREVIEW_GATES);
    expect(gatesFor({ VERCEL_ENV: "preview" }, ["--production"])).toEqual(PRODUCTION_GATES);
  });

  it("every gate is an npm script that exists", () => {
    for (const gate of PREVIEW_GATES) {
      const args = GATES[gate] as string[];
      const script = args[args.length - 1];
      expect(pkg.scripts[script], gate).toBeDefined();
    }
  });

  it("deploy/vercel.base.json builds through it", () => {
    const base = JSON.parse(readFileSync(resolve(ROOT, "deploy/vercel.base.json"), "utf8")) as { buildCommand?: string };
    expect(base.buildCommand).toBe("node scripts/vercel-build.mjs");
  });
});
