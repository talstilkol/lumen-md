/**
 * Mutation testing of the critical modules (plan 0.15), with Stryker
 * (Apache-2.0) and its Vitest runner.
 *
 *   npm run mutation              this set, then scripts/mutation-gate.mjs
 *   npm run mutation -- --mutate "src/storage/**\/*.ts"   any wider set (the weekly run)
 *
 * The set: the modules where a bug loses or leaks the user's data —
 * encryption and the vault, the workspace file layer and the trash, the
 * secret store, the HTML sanitizer, the agent runtime and the Hebrew text
 * utilities. The weekly workflow (mutation.yml) runs all of src/storage/
 * as well; the PR gate runs this set.
 *
 * The gate (scripts/mutation-gate.mjs) reads reports/mutation/mutation.json:
 * the score of each security module must stay ≥ 70 %, and a surviving
 * mutant that is not in scripts/mutation.baseline.json fails.
 */
export const CRITICAL = [
  "src/storage/encryption.ts",
  "src/storage/vault.ts",
  "src/storage/workspace.ts",
  "src/storage/trash.ts",
  "src/storage/fileOps.ts",
  "src/lib/secretStore.ts",
  "src/renderer/rehypeSanitizeRaw.ts",
  "src/agents/runtime.ts",
  "src/text/hebrew.ts",
];

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: { configFile: "vite.config.ts", related: true },
  mutate: CRITICAL,
  // One vitest per mutant would take hours: per-test coverage runs only the
  // tests that reach the mutated code.
  coverageAnalysis: "perTest",
  concurrency: 2,
  timeoutMS: 20_000,
  timeoutFactor: 2,
  ignoreStatic: true,
  thresholds: { high: 85, low: 70, break: null },
  reporters: ["clear-text", "progress", "json", "html"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  htmlReporter: { fileName: "reports/mutation/index.html" },
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
};
