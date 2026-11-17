// @vitest-environment node
/**
 * Plan W1.31: a production build has no window.__lumen.agentReview.
 *
 * The full `npm run build && npm run check:test-surface` runs on the Mac
 * and in CI; this test bundles src/agents/reviewBridge.ts the way a
 * production build sees it — every set key of import.meta.env as a
 * literal, an unset VITE_* as `({}).VITE_…` (what Vite leaves for it), the
 * vite.config defines as literals — minifies it, and runs the dist gate
 * (scripts/check-test-surface.mjs) on the result. The e2e-prod build
 * (VITE_LUMEN_TEST_SURFACE=1) must keep the surface, so the check is not
 * passing by accident.
 *
 * Before W1.31's fix the module read the flag into a top-level const and
 * `import.meta.env.VITE_LUMEN_TEST_SURFACE`, which no minifier folds: the
 * surface stayed in the production bundle.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { findTestSurface } from "../../scripts/check-test-surface.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { loadEsbuild } from "../../scripts/lib/esbuild.mjs";

const ROOT = process.cwd();
const FILE = join(ROOT, "src/agents/reviewBridge.ts");

async function bundle(testSurface: boolean): Promise<string> {
  const env: Record<string, unknown> = { BASE_URL: "/", MODE: "production", DEV: false, PROD: true, SSR: false, ...(testSurface ? { VITE_LUMEN_TEST_SURFACE: "1" } : {}) };
  const asVite = (src: string) =>
    src
      .replace(/import\.meta\.env\.(\w+)/g, (_m, k: string) => (k in env ? JSON.stringify(env[k]) : `({}).${k}`))
      .replace(/\b__LUMEN_TEST_SURFACE__\b/g, String(testSurface));
  const { build } = await loadEsbuild();
  const out = await build({
    entryPoints: [FILE],
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "as-vite",
        setup(b: { onLoad: (o: object, f: (a: { path: string }) => object) => void; onResolve: (o: object, f: (a: { kind: string; path: string }) => object | undefined) => void }) {
          b.onLoad({ filter: /reviewBridge\.ts$/ }, (a) => ({ contents: asVite(readFileSync(a.path, "utf8")), loader: "ts" }));
          b.onResolve({ filter: /.*/ }, (a) => (a.kind === "entry-point" ? undefined : { path: a.path, external: true }));
        },
      },
    ],
  });
  return out.outputFiles[0].text as string;
}

describe("the agentReview test surface in a production bundle (W1.31)", () => {
  it("a normal production build: the dist gate finds nothing", async () => {
    const js = await bundle(false);
    expect(js.length).toBeGreaterThan(500);
    expect(findTestSurface(js)).toEqual([]);
  }, 60_000);

  it("the e2e-prod build (VITE_LUMEN_TEST_SURFACE=1) keeps it, so the check above can fail", async () => {
    const rules = (findTestSurface(await bundle(true)) as Array<{ rule: string }>).map((h) => h.rule);
    expect(rules).toContain("agentReview-property");
    expect(rules).toContain("withdrawRun-member");
  }, 60_000);

  it("vite.config defines the literal from the same variable the e2e-prod job sets", () => {
    const vite = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
    expect(vite).toContain('__LUMEN_TEST_SURFACE__: JSON.stringify(process.env.VITE_LUMEN_TEST_SURFACE === "1")');
  });
});
