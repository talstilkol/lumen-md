/**
 * Review 10, M5: the Rust code that builds with std alone, tested here with
 * `rustc --test` (no cargo, no registry), and how a Rust test run is read.
 *
 * A Rust test binary (cargo test or rustc --test) prints "running N tests"
 * per binary and "test result: ok. P passed; F failed; …". A run in which
 * no binary ran a test (`cargo test … <filter>` matching nothing: W13.X1's
 * old dod ran 0 tests and exited 0) is not green: nothing was checked.
 */

/** [id, entry file]: each builds with `rustc --edition 2021 --test <entry>` and std only. */
export const STD_CRATES = [
  ["mcp-stdio", "src-tauri/mcp-stdio/src/lib.rs"],
  ["tectonic", "src-tauri/src/tectonic.rs"],
  ["vault-nesting", "src-tauri/vault/src/nesting.rs"],
  ["update-guard", "src-tauri/src/update_guard.rs"],
  ["whisper-core", "src-tauri/src/whisper_core.rs"],
  ["zotero-local", "src-tauri/src/zotero_local.rs"],
  ["manifest-sig", "src-tauri/src/manifest_sig.rs"],
  ["desktop", "src-tauri/desktop/src/lib.rs"],
];

/**
 * The counts of a Rust test run's output, or null when it printed no
 * "running N tests" line (not a Rust test run).
 * @param {string} out
 * @returns {{ ran: number, passed: number, failed: number, results: number } | null}
 */
export function rustCounts(out) {
  const text = String(out);
  const running = [...text.matchAll(/^running (\d+) tests?$/gm)];
  if (!running.length) return null;
  let passed = 0;
  let failed = 0;
  const results = [...text.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed;/gm)];
  for (const m of results) {
    passed += Number(m[1]);
    failed += Number(m[2]);
  }
  return { ran: running.reduce((n, m) => n + Number(m[1]), 0), passed, failed, results: results.length };
}

/** Green: at least one test ran and passed, none failed, and every binary that ran reported a result. */
export function rustGreen(c) {
  return !!c && c.ran > 0 && c.passed > 0 && c.failed === 0 && c.results > 0;
}
