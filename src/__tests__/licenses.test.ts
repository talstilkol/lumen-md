// @vitest-environment node
/**
 * The licence gate (task 0.10): scripts/lib/licenses.mjs holds the rules,
 * scripts/licenses.mjs the CLI. Fixtures: src/__tests__/fixtures/licenses/.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import lockFixture from "./fixtures/licenses/lock.json";
import registryFixture from "./fixtures/licenses/registry.json";
import {
  applyAllowlist,
  checkDatasets,
  checkModels,
  checkNpm,
  classifyLicense,
  discoverCatalogIds,
  parseSpdx,
  sniffLicenseText,
  validateEntry,
  walkProduction,
  CATALOG_PATTERNS,
  // @ts-expect-error — plain .mjs module without type declarations
} from "../../scripts/lib/licenses.mjs";

type Level = "ok" | "notice" | "warn" | "fail";
interface Finding {
  area: string;
  name: string;
  level: Level;
  reason: string;
  license: string;
  via?: string;
  allowed?: string;
  structural?: boolean;
  refs?: Array<{ file: string; line: number }>;
}

const repo = resolve(__dirname, "../..");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const byName = (fs: Finding[]) => Object.fromEntries(fs.map((f) => [f.name, f]));

describe("classifyLicense", () => {
  const cases: Array<[unknown, Level]> = [
    ["MIT", "ok"],
    ["Apache-2.0", "ok"],
    ["BlueOak-1.0.0", "ok"],
    ["MPL-2.0", "ok"],
    ["BSL-1.0", "ok"], // Boost, not Business Source
    ["mit or apache-2.0", "ok"],
    ["MIT License", "ok"],
    ["GPL-3.0-only", "fail"],
    ["GPL-2.0+", "fail"],
    ["AGPL-3.0-or-later", "fail"],
    ["LGPL-2.1-or-later", "warn"],
    ["SSPL-1.0", "fail"],
    ["BUSL-1.1", "fail"],
    ["Elastic-2.0", "fail"],
    ["CC-BY-NC-4.0", "fail"],
    ["CC-BY-NC-SA-4.0", "fail"],
    ["Apache-2.0 WITH Commons-Clause", "fail"],
    ["Commons Clause License Condition v1.0", "fail"],
    ["UNLICENSED", "fail"],
    [undefined, "fail"],
    ["", "fail"],
    ["SEE LICENSE IN LICENSE.md", "warn"],
    ["CPAL-1.0", "warn"],
    ["GPL-2.0-only WITH Classpath-exception-2.0", "warn"],
    ["Some-Custom-1.0", "warn"],
    ["(MIT", "warn"],
    // Long-form, non-SPDX names must not fall through to the unknown-licence warning.
    ["GNU General Public License v3.0", "fail"],
    ["GNU Affero General Public License v3", "fail"],
    ["GNU GPL v2", "fail"],
    ["GNU Lesser General Public License v2.1", "warn"],
    ["GNU General Public License v2.0 w/Classpath exception", "warn"],
    ["Server Side Public License", "fail"],
    ["Creative Commons Attribution-NonCommercial 4.0", "fail"],
    [[{ type: "GNU General Public License" }], "fail"],
  ];
  it.each(cases)("%s → %s", (raw, level) => {
    expect(classifyLicense(raw).level).toBe(level);
  });

  it("OR picks the best alternative, AND the worst part", () => {
    const dual = classifyLicense("(MIT OR GPL-3.0-or-later)");
    expect(dual.level).toBe("ok");
    expect(dual.reason).toMatch(/dual-licensed, using MIT/);
    expect(classifyLicense("Apache-2.0 AND LGPL-3.0-or-later").level).toBe("warn");
    expect(classifyLicense("MIT AND GPL-2.0-only").level).toBe("fail");
    expect(classifyLicense("(LGPL-3.0-only OR GPL-3.0-only) AND MIT").level).toBe("warn");
  });

  it("reads the legacy `licenses` array and `{ type }` object", () => {
    expect(classifyLicense([{ type: "MIT", url: "x" }]).level).toBe("ok");
    expect(classifyLicense([{ type: "GPL-2.0" }, { type: "MIT" }]).level).toBe("ok");
    expect(classifyLicense({ type: "ISC" }).level).toBe("ok");
    expect(classifyLicense([]).level).toBe("fail");
  });

  it("parses SPDX with WITH > AND > OR precedence", () => {
    expect(parseSpdx("A OR B AND C")).toEqual({
      type: "or",
      left: { type: "id", id: "A" },
      right: { type: "and", left: { type: "id", id: "B" }, right: { type: "id", id: "C" } },
    });
    expect(parseSpdx("GPL-2.0 WITH Classpath-exception-2.0")).toEqual({ type: "id", id: "GPL-2.0", exception: "Classpath-exception-2.0" });
    expect(() => parseSpdx("MIT OR")).toThrow();
  });

  it("recognises a LICENSE file's first lines", () => {
    expect(sniffLicenseText("The MIT License (MIT)\n\nCopyright (c) 2019")).toBe("MIT");
    expect(sniffLicenseText("                    GNU AFFERO GENERAL PUBLIC LICENSE")).toBe("AGPL-3.0");
    expect(sniffLicenseText("whatever")).toBeNull();
    expect(sniffLicenseText(null)).toBeNull();
  });
});

describe("walkProduction", () => {
  it("follows dependencies, optional and required peers from the root, never devDependencies", () => {
    const { packages, unresolved } = walkProduction(clone(lockFixture));
    const paths = packages.map((p: { path: string }) => p.path).sort();
    expect(paths).toEqual(
      ["node_modules/a", "node_modules/a/node_modules/x", "node_modules/b", "node_modules/c", "node_modules/d", "node_modules/e", "node_modules/f", "node_modules/hpeer", "node_modules/phonemizer", "node_modules/plat", "node_modules/react"].sort(),
    );
    expect(unresolved).toEqual([]);
    const f = packages.find((p: { path: string }) => p.path === "node_modules/f");
    expect(f.via).toBe("a");
  });

  it("resolves a nested copy before the hoisted one", () => {
    const { packages } = walkProduction(clone(lockFixture));
    const x = packages.filter((p: { name: string }) => p.name === "x");
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({ version: "2.0.0", license: "Apache-2.0" });
  });

  it("reports a required dependency the lock lacks", () => {
    const lock = clone(lockFixture);
    delete (lock.packages as Record<string, unknown>)["node_modules/f"];
    expect(walkProduction(lock).unresolved).toEqual(["f (from node_modules/a)"]);
  });

  it("refuses a v1 lockfile", () => {
    expect(() => walkProduction({ lockfileVersion: 1, dependencies: {} })).toThrow(/lockfileVersion 2/);
  });
});

describe("checkNpm", () => {
  const run = (opts = {}) => byName(checkNpm(clone(lockFixture), { readPackage: (p: string) => (p === "node_modules/e" ? { licenses: [{ type: "MIT" }] } : null), ...opts }));

  it("fails on copyleft, BUSL and hidden copyleft; warns on LGPL and custom licence files", () => {
    const r = run();
    expect(r.b.level).toBe("fail");
    expect(r.plat.level).toBe("fail");
    expect(r.phonemizer.level).toBe("fail");
    expect(r.phonemizer.reason).toMatch(/eSpeak NG/);
    expect(r.f.level).toBe("warn");
    expect(r.d.level).toBe("warn");
    expect(r.c.level).toBe("ok");
    expect(r.a.level).toBe("ok");
    expect(r.g).toBeUndefined();
    expect(r["opt-peer"]).toBeUndefined();
  });

  it("falls back to the installed package.json, then the LICENSE file, then fails", () => {
    expect(run().e).toMatchObject({ level: "ok", reason: "licence read from package.json" });
    const sniffed = run({ readPackage: () => null, readLicenseFile: (p: string) => (p === "node_modules/e" ? "MIT License\n\nPermission is hereby granted, free of charge" : null) });
    expect(sniffed.e).toMatchObject({ level: "ok", reason: "licence read from LICENSE file" });
    expect(run({ readPackage: () => null }).e).toMatchObject({ level: "fail", reason: "no licence declared" });
  });

  it("takes a custom hidden-copyleft list, with prefix patterns", () => {
    const r = run({ hidden: [{ name: "hpe*", level: "warn", reason: "test" }] });
    expect(r.hpeer.level).toBe("warn");
    expect(r.phonemizer.level).toBe("ok");
  });
});

describe("model registry", () => {
  const sources = [
    { file: "src/ai/catalog.ts", text: 'const A = "good-model-1b";\nconst B = "llama-like-3b";\nconst C = "nc-model:8b";\n// Qwen2.5-32B is fine, so is loadQwen2.5-3Bx\n' },
  ];

  it("fails a forbidden model that app code references, with where", () => {
    const r = byName(checkModels(clone(registryFixture), sources));
    expect(r["nc-model:8b"]).toMatchObject({ level: "fail", refs: [{ file: "src/ai/catalog.ts", line: 3 }] });
    expect(r["Qwen2.5-3B"]).toMatchObject({ level: "ok", reason: "not referenced by app code" });
    expect(r["llama-like-3b"].level).toBe("notice");
    expect(r["good-model-1b"].level).toBe("ok");
    expect(r["mystery-tts"].level).toBe("warn");
  });

  it("matches ids as whole tokens, case-insensitively", () => {
    const hit = byName(checkModels(clone(registryFixture), [{ file: "x.ts", text: 'pull("qwen2.5-3b-instruct")' }]));
    expect(hit["Qwen2.5-3B"].level).toBe("fail");
  });

  it("validates entries", () => {
    const good = registryFixture.models[0];
    expect(validateEntry(good)).toEqual([]);
    expect(validateEntry({ ...good, class: "forbidden" })).toContain('commercial "yes" contradicts class "forbidden"');
    expect(validateEntry({ ...good, kind: "chatbot" })[0]).toMatch(/kind "chatbot"/);
    expect(validateEntry({ ...good, attribution: "" })).toContain("allowed/conditional models need attribution text");
    expect(validateEntry({ ...good, source: "http://x" })).toContain("source must be an https URL");
    const { notes: _drop, ...noNotes } = good;
    expect(validateEntry(noNotes)).toEqual(["missing notes"]);
    const reg = clone(registryFixture);
    reg.models.push(clone(good));
    expect(checkModels(reg, []).some((f: Finding) => f.level === "fail" && /duplicate id/.test(f.reason))).toBe(true);
  });

  it("rejects an entry whose licence contradicts its class", () => {
    const good = clone(registryFixture.models[0]);
    for (const license of ["AGPL-3.0-only", "CC-BY-NC-4.0", "GNU Affero General Public License v3", "SASPEECH (non-commercial)"]) {
      for (const cls of ["allowed", "conditional", "unknown"]) {
        const commercial = { allowed: "yes", conditional: "conditional", unknown: "unknown" }[cls];
        const problems: string[] = validateEntry({ ...good, license, class: cls, commercial });
        expect(problems.join("; ")).toMatch(/(is forbidden|is non-commercial) .*but class is/);
      }
    }
    expect(validateEntry({ ...good, license: "CC-BY-NC-4.0", class: "forbidden", commercial: "no" })).toEqual([]);
    expect(validateEntry({ ...good, license: "Llama 3.2 Community License", class: "conditional", commercial: "conditional" })).toEqual([]);
    // Referenced by app code, such an entry fails the gate instead of passing as ok.
    const reg = clone(registryFixture);
    reg.models[0].license = "AGPL-3.0-only";
    const r = byName(checkModels(reg, [{ file: "src/ai/catalog.ts", text: 'const A = "good-model-1b";' }]));
    expect(r["good-model-1b"]).toMatchObject({ level: "fail", reason: expect.stringMatching(/registry entry invalid/) });
  });

  it("warns on a catalog model that has no registry entry", () => {
    const catalog = [{ file: "src/ai/modelManager.ts", text: '{ base: "good-model-1b", tier: "tiny" },\n{ base: "Brand-New-2B", tier: "tiny" },' }];
    const r = byName(checkModels(clone(registryFixture), catalog));
    expect(r["Brand-New-2B"]).toMatchObject({ level: "warn" });
    expect(r["Brand-New-2B"].reason).toMatch(/not in models\/registry\.json/);
  });

  it("covers a catalog id only by its exact id or an explicit `match` alias", () => {
    const catalog = [
      {
        file: "src/ai/modelManager.ts",
        text: ['{ base: "Qwen2.5-3B-Proprietary-Finetune" }', '{ base: "good-model-1b-uncensored" }', '{ base: "GOOD-MODEL-1B" }', '{ base: "nc-model:70b" }'].join(",\n"),
      },
    ];
    const r = byName(checkModels(clone(registryFixture), catalog));
    // A fine-tune named after a registered model can carry another licence.
    expect(r["Qwen2.5-3B-Proprietary-Finetune"]).toMatchObject({ level: "warn", reason: expect.stringMatching(/not in models\/registry\.json/) });
    expect(r["good-model-1b-uncensored"]).toMatchObject({ level: "warn" });
    // Case-insensitive exact id, and the family alias `match: ["nc-model"]`, still cover.
    expect(r["GOOD-MODEL-1B"]).toBeUndefined();
    expect(r["nc-model:70b"]).toBeUndefined();
  });

  it("the committed registry is valid and covers every model in the app catalogs", () => {
    const registry = JSON.parse(readFileSync(join(repo, "models/registry.json"), "utf8"));
    const catalogSources = CATALOG_PATTERNS.map((p: { file: string }) => ({ file: p.file, text: readFileSync(join(repo, p.file), "utf8") }));
    const findings: Finding[] = checkModels(registry, catalogSources);
    expect(findings.filter((f) => /registry entry invalid|not in models\/registry/.test(f.reason))).toEqual([]);
    expect(discoverCatalogIds(catalogSources).length).toBeGreaterThan(20);
    // The policy classes from the licence research.
    const cls = Object.fromEntries(registry.models.map((m: { id: string; class: string }) => [m.id, m.class]));
    expect(cls["aya-expanse:8b"]).toBe("forbidden");
    expect(cls["Qwen2.5-3B"]).toBe("forbidden");
    expect(cls["mms-tts-heb"]).toBe("forbidden");
    expect(cls["gemma-2-9b-it"]).toBe("conditional");
    expect(cls["Hermes-3-Llama-3.1-8B"]).toBe("conditional");
    expect(cls["qwen2.5:7b"]).toBe("allowed");
    expect(cls["onnx-community/bge-reranker-v2-m3-ONNX"]).toBe("allowed");
  });
});

describe("datasets", () => {
  it("needs SOURCES.md and a LICENSE in every eval/golden set", () => {
    const r = byName(
      checkDatasets([
        { name: "ok", files: ["SOURCES.md", "LICENSE", "cases.json"] },
        { name: "md", files: ["SOURCES.md", "LICENSE.md"] },
        { name: "bare", files: ["cases.json"] },
      ]),
    );
    expect(r["eval/golden/ok"].level).toBe("ok");
    expect(r["eval/golden/md"].level).toBe("ok");
    expect(r["eval/golden/bare"]).toMatchObject({ level: "fail", reason: "missing SOURCES.md and LICENSE" });
  });
});

describe("applyAllowlist", () => {
  const findings = (): Finding[] => [
    { area: "npm", name: "tldraw", level: "warn", reason: "custom", license: "SEE LICENSE IN LICENSE.md" },
    { area: "npm", name: "@tldraw/editor", level: "warn", reason: "custom", license: "SEE LICENSE IN LICENSE.md" },
    { area: "model", name: "hspell", level: "fail", reason: "forbidden", license: "AGPL-3.0-only" },
  ];

  it("caps a finding at the exception's level and records the reason", () => {
    const out: Finding[] = applyAllowlist(findings(), {
      exceptions: [
        { area: "model", name: "hspell", reason: "user-initiated download, never bundled" },
        { area: "npm", name: "@tldraw/*", reason: "pending decision on the tldraw licence", decision: "1.9", level: "notice" },
      ],
    });
    const r = byName(out);
    expect(r.hspell).toMatchObject({ level: "warn", allowed: "user-initiated download, never bundled" });
    expect(r["@tldraw/editor"]).toMatchObject({ level: "notice", allowed: "pending decision on the tldraw licence (decision 1.9)" });
    expect(r.tldraw.allowed).toBeUndefined();
  });

  it("never raises a level, and reports bad, expired and unused exceptions", () => {
    const out: Finding[] = applyAllowlist(
      findings(),
      {
        exceptions: [
          { area: "npm", name: "tldraw", reason: "documented somewhere", level: "warn" },
          { area: "model", name: "hspell", reason: "was a temporary exception", until: "2026-01-01" },
          { area: "npm", name: "left-pad", reason: "no longer a dependency at all" },
          { area: "npm", name: "x" },
          { area: "npm", name: "y", reason: "a reason that is long enough", level: "fail" },
        ],
      },
      "2026-10-18",
    );
    const r = byName(out);
    expect(r.tldraw.level).toBe("warn");
    expect(r.hspell.level).toBe("fail");
    expect(r["model:hspell"].reason).toMatch(/expired on 2026-01-01/);
    expect(r["npm:left-pad"]).toMatchObject({ level: "warn", reason: "exception matches nothing: remove it" });
    expect(r["npm:x"]).toMatchObject({ level: "fail", reason: "exception without a documented reason" });
    expect(r["npm:y"].level).toBe("fail");
  });
});

describe("applyAllowlist: structural failures", () => {
  it("an exception caps the licence finding, never an invalid registry entry or a broken lockfile", () => {
    const reg = clone(registryFixture);
    reg.models[2].source = "http://example.com/nc"; // nc-model:8b: not https
    const findings: Finding[] = checkModels(reg, []);
    findings.push({ area: "npm", name: "left-pad (from root)", level: "warn", reason: "required dependency missing from package-lock.json", license: "", structural: true } as Finding);
    const out: Finding[] = applyAllowlist(findings, {
      exceptions: [
        { area: "model", name: "nc-model:8b", reason: "user-initiated download, never bundled", level: "ok" },
        { area: "npm", name: "left-pad*", reason: "documented exception for this package", level: "ok" },
      ],
    });
    const r = byName(out);
    expect(r["nc-model:8b"]).toMatchObject({ level: "fail", reason: expect.stringMatching(/registry entry invalid.*an allowlist exception cannot waive this/) });
    expect(r["nc-model:8b"].allowed).toBeUndefined();
    expect(r["left-pad (from root)"].level).toBe("warn");
    // It does match: no "matches nothing" warning.
    expect(r["model:nc-model:8b"]).toBeUndefined();
    // The same exception still caps a licence finding of a valid entry.
    const ok = byName(applyAllowlist(checkModels(clone(registryFixture), [{ file: "src/a.ts", text: '"nc-model:8b"' }]), { exceptions: [{ area: "model", name: "nc-model:8b", reason: "user-initiated download, never bundled" }] }));
    expect(ok["nc-model:8b"]).toMatchObject({ level: "warn", allowed: "user-initiated download, never bundled" });
  });
});

describe("applyAllowlist: until", () => {
  const finding = (): Finding[] => [{ area: "npm", name: "webr", level: "fail", reason: "GPL binaries", license: "SEE LICENSE IN LICENSE.md" }];
  it.each([["2026/11/15"], ["never"], ["2026-02-30"], [20261115], [""]])("a malformed until (%j) fails and does not cap the finding", (until) => {
    const out: Finding[] = applyAllowlist(finding(), { exceptions: [{ area: "npm", name: "webr", reason: "pending the owner's decision", until }] }, "2026-10-18");
    const r = byName(out);
    expect(r.webr).toMatchObject({ level: "fail" });
    expect(r.webr.allowed).toBeUndefined();
    expect(r["npm:webr"]).toMatchObject({ level: "fail", reason: expect.stringMatching(/must be a YYYY-MM-DD date/) });
  });

  it("a valid future until still applies", () => {
    const r = byName(applyAllowlist(finding(), { exceptions: [{ area: "npm", name: "webr", reason: "pending the owner's decision", until: "2026-11-15" }] }, "2026-10-18"));
    expect(r.webr.level).toBe("warn");
  });
});

describe("scripts/licenses.mjs (CLI)", () => {
  it("prints the table, writes the report and exits 1 on a failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-licenses-"));
    try {
      writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lockFixture));
      mkdirSync(join(dir, "node_modules/e"), { recursive: true });
      writeFileSync(join(dir, "node_modules/e/package.json"), JSON.stringify({ name: "e", license: "ISC" }));
      mkdirSync(join(dir, "models"));
      writeFileSync(join(dir, "models/registry.json"), JSON.stringify(registryFixture));
      mkdirSync(join(dir, "src/__tests__"), { recursive: true });
      writeFileSync(join(dir, "src/app.ts"), 'export const M = "nc-model:8b";\n');
      writeFileSync(join(dir, "src/__tests__/app.test.ts"), 'const ignored = "Qwen2.5-3B";\n');
      mkdirSync(join(dir, "eval/golden/he-spell"), { recursive: true });
      writeFileSync(join(dir, "eval/golden/he-spell/SOURCES.md"), "# sources\n");
      writeFileSync(join(dir, "licenses.allow.json"), JSON.stringify({ exceptions: [{ area: "npm", name: "d", reason: "decided: the custom licence allows us" }] }));

      const res = spawnSync(process.execPath, [join(repo, "scripts/licenses.mjs"), "--root", dir, "--json", join(dir, "out/r.json")], { encoding: "utf8" });
      expect(res.status).toBe(1);
      expect(res.stdout).toMatch(/^FAIL\s+npm\s+b\s/m);
      expect(res.stdout).toMatch(/^FAIL\s+model\s+nc-model:8b\s+CC-BY-NC-4.0\s+src\/app\.ts:1/m);
      expect(res.stdout).toMatch(/ALLOWLISTED: decided/);
      const report = JSON.parse(readFileSync(join(dir, "out/r.json"), "utf8"));
      const failed = report.failures.map((f: Finding) => `${f.area}:${f.name}`).sort();
      expect(failed).toEqual(["dataset:eval/golden/he-spell", "model:nc-model:8b", "npm:b", "npm:phonemizer", "npm:plat"]);
      // Tests are not app code: the Qwen2.5-3B mention in a test does not count.
      expect(report.models.find((m: Finding) => m.name === "Qwen2.5-3B").level).toBe("ok");
      expect(report.npm.total).toBe(11);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
