/**
 * Plan W11.L3: the M3 launch kit (launch/m3). Every claim in it carries a
 * receipt from claims.json, a file in this repository that still contains the
 * quoted text, so a claim fails when the docs behind it change. Nothing calls
 * the cryptography audited, in English or Hebrew, and each text fits where it
 * is pasted. The failure cases below are edits of the real files.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error — plain .mjs helpers without types
import { KIT_FILES, LIMITS, kitProblems, plain, section, withSources } from "../../scripts/lib/launchKit.mjs";

const ROOT = process.cwd();
const DIR = join(ROOT, "launch", "m3");
const ledger = JSON.parse(readFileSync(join(DIR, "claims.json"), "utf8"));
const files: Record<string, string> = Object.fromEntries((KIT_FILES as string[]).map((f) => [f, readFileSync(join(DIR, f), "utf8")]));
const readRepo = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : null);
const check = (f = files, l = ledger, r = readRepo) => kitProblems(f, l, r) as string[];
const edit = (name: string, from: string | RegExp, to: string) => {
  const t = files[name].replace(from, to);
  expect(t, `${name}: the edit applies`).not.toBe(files[name]);
  return { ...files, [name]: t };
};

describe("the M3 launch kit (W11.L3)", () => {
  it("passes: every claim has a receipt that still says it, within every limit", () => {
    expect(check()).toEqual([]);
    expect(Object.keys(ledger.claims).length).toBeGreaterThanOrEqual(15);
    for (const c of Object.values(ledger.claims) as { source: string }[]) expect(c.source).not.toMatch(/^https?:/);
  });

  it("the pasted texts fit: the HN title, the PH tagline, description and first comment", () => {
    const title = section(files["show-hn.md"], "Title");
    expect([...title].length).toBeLessThanOrEqual(LIMITS.hnTitle);
    expect(title).toMatch(/^Show HN: Lumen – /);
    for (const [h, max] of [["Tagline", 60], ["Description", 260], ["First comment", 800]] as const) {
      const t = plain(files["product-hunt.md"], h);
      expect([...t].length, h).toBeLessThanOrEqual(max);
      expect(t, h).not.toMatch(/\[\^/);
    }
    // The angle R6.11 asks for: sandboxed plugins, MIT, Hebrew/RTL, local AI.
    const hn = files["show-hn.md"];
    for (const id of ["plugin-quickjs", "mit", "rtl-per-line", "local-ai"]) expect(hn).toContain(`[^${id}]`);
  });

  it("refuses an unbacked claim, an unknown marker, a receipt whose quote is gone, and a URL as a receipt", () => {
    expect(check(edit("show-hn.md", "It is MIT-licensed.[^mit]", "It is MIT-licensed."))).toContain('show-hn.md: a claim without a receipt: "It is MIT-licensed."');
    expect(check(edit("press-kit.he.md", "הממשק ב-8 שפות.[^ui-languages]", "הממשק ב-9 שפות."))).toContain('press-kit.he.md: a claim without a receipt: "הממשק ב-9 שפות."');
    expect(check(edit("show-hn.md", "[^mit]", "[^gpl]")).join("\n")).toContain("show-hn.md: [^gpl] is not in claims.json");
    const docsChanged = (p: string) => (p === "docs/src/content/docs/editor/hebrew.md" ? readRepo(p)!.replace("English and Hebrew in full", "English in full") : readRepo(p));
    expect(check(files, ledger, docsChanged)).toContain('claims.json ui-languages: docs/src/content/docs/editor/hebrew.md no longer says "English and Hebrew in full, and Arabic, Russian, French, German, Japanese and Chinese in beta"');
    const url = structuredClone(ledger);
    url.claims.mit.source = "https://opensource.org/license/mit";
    expect(check(files, url)).toContain("claims.json mit: the receipt must be a file in this repository, not a URL");
  });

  it("0 'audited' claims about the cryptography, in English and Hebrew; saying it is not audited is required", () => {
    expect(check(edit("press-kit.en.md", "Optional vault encryption at rest with AES-256-GCM,", "Audited vault encryption at rest with AES-256-GCM,")).join("\n")).toMatch(/press-kit\.en\.md: claims an audit: "Audited vault encryption/);
    expect(check(edit("press-kit.he.md", "הצפנת כספת אופציונלית", "הצפנת כספת מבוקרת")).join("\n")).toMatch(/press-kit\.he\.md: claims an audit/);
    expect(check(edit("product-hunt.md", "plugins run sandboxed", "plugins run in a military-grade sandbox")).join("\n")).toMatch(/product-hunt\.md: claims an audit/);
    const ledgerAudited = structuredClone(ledger);
    ledgerAudited.claims["vault-encryption"].en = "Independently verified vault encryption.";
    expect(check(files, ledgerAudited)).toContain("claims.json vault-encryption: claims an audit");
    const noStatement = edit("press-kit.en.md", /- Lumen has \*\*not\*\* had an external security audit\.\[\^no-external-audit\] /, "- ");
    expect(check(noStatement)).toContain("press-kit.en.md: must say that there has been no external audit ([^no-external-audit])");
    // The negated sentences in the kit pass: "has not had an external security audit", "לא נעשתה ביקורת".
    expect(files["press-kit.he.md"]).toContain("**לא** נעשתה ביקורת אבטחה חיצונית");
  });

  it("the demo adds up to 60 seconds without gaps; the HN title and PH comment limits bite; the domain is the app's", () => {
    expect(check(edit("demo-60s.md", "| 0:55–1:00 |", "| 0:55–1:05 |"))).toContain("demo-60s.md: the shots add up to 65 s, not 60");
    expect(check(edit("demo-60s.md", "| 0:06–0:14 |", "| 0:07–0:14 |")).join("\n")).toContain("demo-60s.md: shots must follow on without gaps (7s after 6s)");
    expect(check(edit("show-hn.md", /^Show HN: Lumen – .*$/m, `Show HN: Lumen – ${"x".repeat(80)}`)).join("\n")).toMatch(/show-hn\.md: the title is \d+ > 80 characters/);
    const long = edit("product-hunt.md", "I'm here all day for questions.", `I'm here all day for questions. ${"More words here. ".repeat(30)}`);
    expect(check(long).join("\n")).toMatch(/product-hunt\.md: the first comment is \d+ > 800 characters/);
    const taken = ["lumen", "md"].join("."); // the taken domain, not spelled out in this file
    expect(check(edit("press-kit.en.md", "## Contact", `See ${taken}.\n\n## Contact`)).join("\n")).toContain("press-kit.en.md: names the taken domain");
  });

  it("each file's Sources list is generated from its markers and current", () => {
    for (const f of KIT_FILES as string[]) expect(withSources(files[f], ledger.claims), f).toBe(files[f]);
    const stale = edit("show-hn.md", "It is MIT-licensed.[^mit]", "It is MIT-licensed.[^mit][^compare]");
    expect(check(stale).join("\n")).toContain("show-hn.md: the Sources list is out of date");
  });

  it("the command: ok on the kit, the pasted text without markers", () => {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/launch-kit.mjs")], { encoding: "utf8" });
    expect([r.status, r.stdout.trim().split("\n").pop()]).toEqual([0, `launch kit: ok (5 files, ${Object.keys(ledger.claims).length} claims, each with a receipt)`]);
    const p = spawnSync(process.execPath, [join(ROOT, "scripts/launch-kit.mjs"), "--plain", "product-hunt.md", "First comment"], { encoding: "utf8" });
    expect(p.status).toBe(0);
    expect(p.stdout).toMatch(/^Hi PH!/);
    expect(p.stdout).not.toContain("[^");
  });
});
