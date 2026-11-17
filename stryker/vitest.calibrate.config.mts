// Vitest config for the Stryker calibration (W11.Q9, stryker/stryker.calibrate.json):
// exactly the test files scripts/mutation/targets.json lists for the three
// calibrated modules, so both runners judge the same mutants with the same tests.
// (targets.json's per-file name filters cannot be given to Stryker's runner, so
// whole files run here; the comparison notes it.)
import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
export const CALIBRATED = ["src/sync/gitMerge.ts", "src/sync/e2ee/keyring.ts", "src/storage/zip.ts"];
const targets = JSON.parse(readFileSync(`${root}scripts/mutation/targets.json`, "utf8")) as { modules: Record<string, Array<{ file: string }>> };
const include = [...new Set(CALIBRATED.flatMap((m) => (targets.modules[m] ?? []).map((t) => t.file)))];

export default defineConfig({
  root,
  resolve: { alias: { "@": `${root}src` } },
  test: {
    environment: "jsdom",
    globals: true,
    css: false,
    setupFiles: ["src/__tests__/setup.ts"],
    include,
  },
});
