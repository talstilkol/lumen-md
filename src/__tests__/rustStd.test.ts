/**
 * Review 10, M5: the std-only Rust crates gate (scripts/rust-std-tests.mjs,
 * train:offline `rust-std`) and how a Rust test run is read: "running 0
 * tests" is not green.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { STD_CRATES, isRustTestCommand, rustCounts, rustGreen } from "../../scripts/lib/rustStd.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { runCrates } from "../../scripts/rust-std-tests.mjs";

const repo = resolve(__dirname, "../..");
type Spawned = { status: number | null; stdout: string; stderr: string; error?: Error };

describe("reading a Rust test run", () => {
  it("counts every binary, and 0 tests run is not green", () => {
    const ok = "running 29 tests\n.....\ntest result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.1s\n";
    expect(rustCounts(ok)).toEqual({ ran: 29, passed: 29, failed: 0, results: 1 });
    expect(rustGreen(rustCounts(ok))).toBe(true);
    const zero = "running 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 31 filtered out; finished in 0.00s\n";
    expect(rustGreen(rustCounts(zero))).toBe(false);
    const red = "running 2 tests\ntest result: FAILED. 1 passed; 1 failed; 0 ignored\n";
    expect(rustGreen(rustCounts(red))).toBe(false);
    // A binary that started its tests and died before a result line.
    expect(rustGreen(rustCounts("running 4 tests\n"))).toBe(false);
    expect(rustCounts("plan: ok")).toBeNull();
    expect(rustGreen(null)).toBe(false);
  });

  it("review 11, L8: --no-run, output sent elsewhere and CRLF are read too", () => {
    // cargo test --no-run builds the binaries and runs none: 0 run, not green.
    const noRun = "   Compiling x v0.1.0\n    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.4s\n  Executable unittests src/lib.rs (target/debug/deps/x-1)\n";
    expect(rustCounts(noRun)).toEqual({ ran: 0, passed: 0, failed: 0, results: 0 });
    expect(rustGreen(rustCounts(noRun))).toBe(false);
    // `cargo test > log`: nothing printed; the command says it was a Rust test run.
    for (const cmd of ["cargo test --offline > /tmp/log", "cargo +stable test -p x", "rustc --edition 2021 --test src/lib.rs -o t && ./t > /dev/null", "cargo nextest run"]) {
      expect(isRustTestCommand(cmd), cmd).toBe(true);
      expect(rustGreen(rustCounts("", cmd)), cmd).toBe(false);
    }
    expect(isRustTestCommand("node scripts/plan/build.mjs --check")).toBe(false);
    expect(rustCounts("", "npm test")).toBeNull();
    // CRLF (a Windows runner, a log saved there).
    const crlf = "running 3 tests\r\n...\r\ntest result: ok. 3 passed; 0 failed; 0 ignored\r\n";
    expect(rustCounts(crlf)).toEqual({ ran: 3, passed: 3, failed: 0, results: 1 });
    expect(rustGreen(rustCounts("running 0 tests\r\n\r\ntest result: ok. 0 passed; 0 failed;\r\n"))).toBe(false);
  });

  it("names the std-only crates the review asked for, and each entry exists", () => {
    const ids = STD_CRATES.map(([id]: [string, string]) => id);
    for (const id of ["mcp-stdio", "tectonic", "vault-nesting"]) expect(ids).toContain(id);
    for (const [, entry] of STD_CRATES as [string, string][]) expect(existsSync(join(repo, entry)), entry).toBe(true);
  });

  it("a crate is green only when it built and ran a test", () => {
    const fake = (build: Spawned, run: Spawned) => (cmd: string) => (cmd === "rustc" ? build : run);
    const built: Spawned = { status: 0, stdout: "", stderr: "" };
    const only = ["mcp-stdio"];
    expect(runCrates(repo, only, fake(built, { status: 0, stdout: "running 3 tests\ntest result: ok. 3 passed; 0 failed;\n", stderr: "" }))[0]).toMatchObject({ ok: true, detail: "3/3 passed" });
    expect(runCrates(repo, only, fake(built, { status: 0, stdout: "running 0 tests\ntest result: ok. 0 passed; 0 failed;\n", stderr: "" }))[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/running 0 tests is not green/) });
    expect(runCrates(repo, only, fake({ status: 1, stdout: "", stderr: "error[E0425]: x\n" }, built))[0]).toMatchObject({ ok: false, detail: "build failed: error[E0425]: x" });
    expect(runCrates(repo, only, fake({ status: null, stdout: "", stderr: "", error: new Error("spawn rustc ENOENT") }, built))[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/rustc did not run/) });
    expect(runCrates(repo, ["no-such-crate"])).toEqual([]);
  });
});
