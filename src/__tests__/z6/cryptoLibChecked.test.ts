// @vitest-environment node
/**
 * Review Z6-L7: the crypto wrappers in src/sync/e2ee/primitives/lib (W10.D13) were outside both ESLint and tsc.
 * They stay outside the root tsconfig until the Mac run installs their packages (10.M,
 * docs/security/crypto-libs.md), but ESLint now lints them, and tsc checks them on their own project. This runs
 * that project: the only diagnostics allowed are the packages that are not installed yet (TS2307); once they
 * are, there must be none.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..", "..");
const LIB = join(ROOT, "src/sync/e2ee/primitives/lib");
const PACKAGES = ["@noble/ciphers/chacha.js", "@noble/hashes/blake2.js", "@noble/hashes/scrypt.js", "hash-wasm", "libsodium-wrappers-sumo", "age-encryption"];

describe("the audited-library wrappers are linted and type-checked (Z6-L7)", () => {
  it("ESLint no longer ignores them", () => {
    const config = readFileSync(join(ROOT, "eslint.config.js"), "utf8");
    const ignores = (/ignores:\s*\[([\s\S]*?)\]/.exec(config)?.[1] ?? "").replace(/\/\/.*$/gm, "");
    expect(ignores).toMatch(/node_modules/);
    expect(ignores).not.toMatch(/primitives\/lib/);
  });

  it("they have their own tsconfig over the root one, and an npm script runs it", () => {
    const cfg = ts.readConfigFile(join(LIB, "tsconfig.json"), ts.sys.readFile);
    expect(cfg.error).toBeUndefined();
    expect(cfg.config.extends).toBe("../../../../../tsconfig.json");
    expect(resolve(LIB, cfg.config.extends)).toBe(join(ROOT, "tsconfig.json"));
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts["typecheck:crypto-lib"]).toBe("tsc -p src/sync/e2ee/primitives/lib --noEmit");
  });

  it("tsc on that project: nothing but the packages not installed yet", () => {
    const cfg = ts.readConfigFile(join(LIB, "tsconfig.json"), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, LIB);
    expect(parsed.fileNames.map((f) => f.slice(LIB.length + 1)).sort()).toEqual(["age.ts", "argon2.ts", "argon2Worker.ts", "audited.ts"]);
    // No ambient @types (node, react, vitest) offline: what these files use is in lib.dom / lib.es2022.
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true, types: [] });
    const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file && dirname(d.file.fileName) === LIB);
    const text = diags.map((d) => `${d.file!.fileName.slice(LIB.length + 1)} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    const notInstalled = (d: ts.Diagnostic) => d.code === 2307 && PACKAGES.some((p) => ts.flattenDiagnosticMessageText(d.messageText, " ").includes(`'${p}'`));
    expect(text.filter((_, i) => !notInstalled(diags[i]))).toEqual([]);
  });
});
