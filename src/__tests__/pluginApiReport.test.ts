/**
 * W13.L1 — the plugin API report and its semver gate. The report is built
 * from src/plugins/api/lumen-plugin.d.ts; a removal without a major bump,
 * an addition without a minor bump, a removal without two minor versions of
 * deprecation, and a stale report each fail `--check`.
 */
import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error — a .mjs script without types
import { buildEntries, checkReleases, diffEntries, requiredBump, run } from "../../scripts/plugin-api-report.mjs";
import { METHOD_CAPABILITY } from "../plugins/runtime/capabilities";
import { DEPRECATIONS, METHOD_SINCE, PLUGIN_API_VERSION } from "../plugins/api/version";

type Entry = { key: string; kind: string; signature: string; since: string; deprecated?: { since: string; removeIn: string; use: string } };
type Result = { ok: boolean; problems: string[]; entries: Entry[] };

const ROOT = resolve(__dirname, "../..");
const DTS = join(ROOT, "src/plugins/api/lumen-plugin.d.ts");
const dts = readFileSync(DTS, "utf8");
const entries: Entry[] = buildEntries(dts);

/** A throwaway copy of the files the report reads and writes. */
function tree(): string {
  const dir = mkdtempSync(join(tmpdir(), "plugin-api-"));
  cpSync(join(ROOT, "src/plugins/api"), join(dir, "src/plugins/api"), { recursive: true });
  cpSync(join(ROOT, "plugin-api"), join(dir, "plugin-api"), { recursive: true });
  return dir;
}
const edit = (dir: string, file: string, from: string | RegExp, to: string) => {
  const p = join(dir, file);
  const before = readFileSync(p, "utf8");
  const after = before.replace(from, to);
  expect(after, `${file}: the edit applied`).not.toBe(before);
  writeFileSync(p, after);
};
const bump = (dir: string, v: string) => edit(dir, "src/plugins/api/version.ts", /PLUGIN_API_VERSION = "[\d.]+"/, `PLUGIN_API_VERSION = "${v}"`);
const check = (dir: string): Result => run(dir, { check: true });
const update = (dir: string): Result => run(dir, { check: false });

/** `LumenDocumentApi.getText` → `document.getText`, for the members of the namespace interfaces. */
const apiMethods = () =>
  entries
    .filter((e) => e.kind === "method" && /^Lumen[A-Z]\w*Api\./.test(e.key) && e.key.split(".")[0] !== "LumenPluginApi")
    .map((e) => {
      const [iface, fn] = e.key.split(".");
      const ns = iface.replace(/^Lumen/, "").replace(/Api$/, "");
      return `${ns[0].toLowerCase()}${ns.slice(1)}.${fn}`;
    })
    .sort();

describe("the report reads the public .d.ts (W13.L1)", () => {
  it("lists every method of the sandbox's method table, and nothing the sandbox lacks", () => {
    expect(apiMethods()).toEqual(Object.keys(METHOD_CAPABILITY).sort());
  });

  it("the @deprecated and @since tags agree with version.ts, which the sandbox reads", () => {
    const key = (m: string) => `Lumen${m[0].toUpperCase()}${m.slice(1, m.indexOf("."))}Api.${m.split(".")[1]}`;
    const byKey = new Map(entries.map((e) => [e.key, e]));
    const dep = entries.filter((e) => e.deprecated && e.kind === "method");
    expect(dep.map((e) => ({ key: e.key, ...e.deprecated }))).toEqual(DEPRECATIONS.map((d) => ({ key: key(d.method), since: d.since, removeIn: d.removeIn, use: d.use })));
    const newer = Object.fromEntries(Object.keys(METHOD_CAPABILITY).map((m) => [m, byKey.get(key(m))?.since]).filter(([, s]) => s !== "1.0.0"));
    expect(newer).toEqual(METHOD_SINCE);
  });

  it("has theme variables as part of the contract, each defined by Lumen in light and dark", () => {
    const vars = entries.filter((e) => e.key.startsWith("LumenThemeVariable | ")).map((e) => JSON.parse(e.signature) as string);
    expect(vars.length).toBeGreaterThanOrEqual(15);
    const css = readFileSync(join(ROOT, "src/index.css"), "utf8");
    const root = css.slice(css.indexOf(":root {"));
    const dark = css.slice(css.indexOf(".dark {"));
    for (const v of vars) {
      expect(new RegExp(`^\\s*${v}:`, "m").test(root), `${v} in :root`).toBe(true);
      expect(new RegExp(`^\\s*${v}:`, "m").test(dark), `${v} in .dark`).toBe(true);
    }
  });

  it("refuses an empty or method-less input instead of passing it", () => {
    expect(() => buildEntries("")).toThrow(/no methods/);
    expect(() => buildEntries("export interface X { a: string }")).toThrow(/no methods/);
    expect(() => buildEntries("/** @since one */\nexport interface X { f(): void }")).toThrow(/not a version/);
  });

  it("the repo passes --check, and the CLI says so with exit 0", () => {
    const r = check(ROOT);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    const cli = spawnSync(process.execPath, [join(ROOT, "scripts/plugin-api-report.mjs"), "--check"], { encoding: "utf8" });
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stdout).toContain(`API ${PLUGIN_API_VERSION}`);
  });
});

describe("the semver gate", () => {
  it("removing a method without a major bump fails", () => {
    const dir = tree();
    edit(dir, "src/plugins/api/lumen-plugin.d.ts", /\s*\/\*\* @since 1\.0\.0 \*\/\n\s*write\(path: string, text: string\): Promise<void>;/, "");
    // Same version: the released snapshot no longer matches.
    expect(check(dir).problems.join("\n")).toMatch(/PLUGIN_API_VERSION is still 1\.1\.0/);
    expect(update(dir).ok).toBe(false);
    bump(dir, "1.2.0");
    expect(check(dir).problems.join("\n")).toMatch(/needs a major bump \(removed LumenVaultApi\.write\)/);
    // A major bump alone is not enough: it was never deprecated.
    bump(dir, "2.0.0");
    expect(check(dir).problems.join("\n")).toMatch(/LumenVaultApi\.write removed after 0 deprecated minor version/);
    expect(update(dir).ok).toBe(false);
  });

  it("changing a signature is breaking too", () => {
    const dir = tree();
    edit(dir, "src/plugins/api/lumen-plugin.d.ts", "read(path: string): Promise<string>;", "read(path: string, encoding: string): Promise<string>;");
    bump(dir, "1.1.1");
    expect(check(dir).problems.join("\n")).toMatch(/needs a major bump \(changed LumenVaultApi\.read\)/);
  });

  it("an addition needs a minor bump, and the report follows every change", () => {
    const dir = tree();
    edit(dir, "src/plugins/api/lumen-plugin.d.ts", "export interface LumenVaultApi {", "export interface LumenVaultApi {\n  /** @since 1.2.0 */\n  exists(path: string): Promise<boolean>;");
    bump(dir, "1.1.1");
    expect(check(dir).problems.join("\n")).toMatch(/needs a minor bump \(added LumenVaultApi\.exists\), got patch/);
    bump(dir, "1.2.0");
    // The bump is right, but the committed report is stale until the script runs.
    const stale = check(dir).problems.join("\n");
    expect(stale).toMatch(/api-report\.json is out of date/);
    expect(stale).toMatch(/api-report\.md is out of date/);
    expect(stale).toMatch(/no snapshot for 1\.2\.0/);
    const u = update(dir);
    expect(u.problems).toEqual([]);
    expect(check(dir).ok).toBe(true);
    expect(readFileSync(join(dir, "plugin-api/api-report.md"), "utf8")).toContain("`LumenVaultApi.exists` | 1.2.0 | `exists(path: string): Promise<boolean>`");
    // A new member that forgets its @since is caught: it is new in 1.2.0 but would say 1.1.0 or 1.0.0.
    const dir2 = tree();
    edit(dir2, "src/plugins/api/lumen-plugin.d.ts", "export interface LumenVaultApi {", "export interface LumenVaultApi {\n  exists(path: string): Promise<boolean>;");
    bump(dir2, "1.2.0");
    expect(check(dir2).problems.join("\n")).toMatch(/LumenVaultApi\.exists is new here but says @since 1\.0\.0/);
  });

  it("a released snapshot never changes, and a hand-edited report is caught", () => {
    const dir = tree();
    edit(dir, "plugin-api/api-report.md", "# Lumen plugin API report", "# Lumen plugin API report (edited)");
    expect(check(dir).problems.join("\n")).toMatch(/api-report\.md is out of date/);
    const dir2 = tree();
    edit(dir2, "plugin-api/releases/1.0.0.json", '"key": "LumenVaultApi.write"', '"key": "LumenVaultApi.writeX"');
    expect(check(dir2).ok).toBe(false);
  });

  it("removal is allowed at a major, after two minor versions of deprecation", () => {
    const released10 = JSON.parse(readFileSync(join(ROOT, "plugin-api/releases/1.0.0.json"), "utf8")) as { entries: Entry[] };
    const base: Entry[] = released10.entries.filter((e) => e.key !== "LumenDocumentApi.setText");
    const setText = entries.find((e) => e.key === "LumenDocumentApi.setText")!;
    const at = (v: string, list: Entry[]) => ({ apiVersion: v, entries: list });
    const plain = { ...setText, deprecated: undefined };
    delete (plain as Partial<Entry>).deprecated;
    const v10 = at("1.0.0", [...base, plain]);
    const v11 = at("1.1.0", [...base, setText]);
    const v12 = at("1.2.0", [...base, setText]);
    const v20 = at("2.0.0", base);
    expect(checkReleases([v10, v11, v12, v20])).toEqual([]);
    // One minor version of warning is not two.
    expect(checkReleases([v10, v11, v20]).join("\n")).toMatch(/removed after 1 deprecated minor version/);
    // Two patch releases of the same minor are one minor version.
    expect(checkReleases([v10, v11, at("1.1.1", [...base, setText]), v20]).join("\n")).toMatch(/removed after 1 deprecated minor version/);
    // Deprecating is itself a minor change.
    expect(checkReleases([v10, at("1.0.1", [...base, setText])]).join("\n")).toMatch(/needs a minor bump \(deprecated LumenDocumentApi\.setText\)/);
    // A deprecation must name its removal major and its replacement.
    const bad = { ...setText, deprecated: { since: "1.1.0", removeIn: "1.3.0", use: "document.applyEdits" } };
    expect(checkReleases([v10, at("1.1.0", [...base, bad])]).join("\n")).toMatch(/must be a later major/);
  });

  it("diffEntries and requiredBump classify", () => {
    const a = [{ key: "A.x", kind: "method", signature: "x(): void", since: "1.0.0" }];
    expect(requiredBump(diffEntries(a, a))).toBe("patch");
    expect(requiredBump(diffEntries(a, [...a, { key: "A.y", kind: "method", signature: "y(): void", since: "1.1.0" }]))).toBe("minor");
    expect(requiredBump(diffEntries(a, []))).toBe("major");
    expect(requiredBump(diffEntries(a, [{ ...a[0], signature: "x(n: number): void" }]))).toBe("major");
  });
});
