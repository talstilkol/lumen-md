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
  ["pandoc", "src-tauri/src/pandoc.rs"],
  ["vault-nesting", "src-tauri/vault/src/nesting.rs"],
  ["update-guard", "src-tauri/src/update_guard.rs"],
  ["whisper-core", "src-tauri/src/whisper_core.rs"],
  ["zotero-local", "src-tauri/src/zotero_local.rs"],
  ["manifest-sig", "src-tauri/src/manifest_sig.rs"],
  ["desktop", "src-tauri/desktop/src/lib.rs"],
];

/**
 * Is `cmd` a Rust test run (`cargo test`, `cargo +toolchain test`, `cargo nextest run`,
 * or `rustc … --test`)? Review 11, L8: such a command is judged by its output even
 * when that output shows no "running N tests" (`--no-run`, output sent elsewhere).
 */
export function isRustTestCommand(cmd) {
  const c = String(cmd ?? "");
  return /\bcargo\s+(?:\+\S+\s+)?(?:test|nextest\s+run)\b/.test(c) || /\brustc\b[^;&|]*\s--test\b/.test(c);
}

/** What cargo prints when it built test binaries (also under --no-run). */
const CARGO_TEST_BUILD = /^\s*(?:Finished `test` profile|Finished test \[|Executable (?:unittests|tests?\/|doctests)|Running unittests)/m;

/**
 * The counts of a Rust test run's output, or null when it is not a Rust test
 * run: it printed no "running N tests" line, cargo built no test binary, and
 * `cmd` (when given) is not a Rust test command. A Rust test run that shows no
 * test running (`cargo test --no-run`, `cargo test > log`) counts as 0 run
 * (review 11, L8). Line endings may be CRLF.
 * @param {string} out
 * @param {string} [cmd]
 * @returns {{ ran: number, passed: number, failed: number, results: number } | null}
 */
export function rustCounts(out, cmd = "") {
  const text = String(out).replace(/\r\n?/g, "\n");
  const running = [...text.matchAll(/^running (\d+) tests?[ \t]*$/gm)];
  if (!running.length) return CARGO_TEST_BUILD.test(text) || isRustTestCommand(cmd) ? { ran: 0, passed: 0, failed: 0, results: 0 } : null;
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
