/**
 * Deterministic source maps at the end of a build (plan W4.16, W10.D21).
 *
 * A release ships no maps (plan 11.5). When LUMEN_SOURCEMAP=1 turns them on
 * for an investigation, this plugin rewrites every `.map` in the output
 * folder once the bundle is written (scripts/supply-chain/normalize-maps.mjs:
 * relative posix sources, sources and names sorted with the mappings
 * rewritten, fixed key order), so that two builds of one commit give the
 * same bytes and `npm run repro -- --sourcemap` can compare them.
 *
 * Build tooling: imported by vite.config.ts and tests, never by the app.
 */
import path from "node:path";
import type { Plugin } from "vite";
import { normalizeMapsIn } from "../../scripts/supply-chain/normalize-maps.mjs";

export function deterministicMapsPlugin(enabled: boolean, root: string): Plugin {
  let outDir = path.resolve(root, "dist");
  return {
    name: "lumen:deterministic-maps",
    apply: "build",
    enforce: "post",
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir);
    },
    closeBundle: {
      order: "post",
      sequential: true,
      handler() {
        if (!enabled) return;
        normalizeMapsIn(outDir, root);
      },
    },
  };
}
