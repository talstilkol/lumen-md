/**
 * Plan W13.I4 — one translation per Lumen term in all eight languages
 * (i18n/glossary.json) and a consistency gate in `npm run i18n:check`
 * (scripts/i18n-glossary.mjs): a translation that uses another word for a
 * term ("מאגר" where Hebrew says "כספת") fails. The glossary is shown on the
 * Help translate page and given to the draft agent.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain JavaScript
import { SUPPORTED_LOCALES } from "../i18n";
import { GLOSSARY_LANGS, checkGlossary, glossaryPrompt, glossaryShape, readGlossary } from "../../scripts/lib/i18n-glossary.mjs";
// @ts-expect-error plain JavaScript
import { ollamaEngine } from "../../scripts/lib/i18n-draft.mjs";
import { listLocales, readLocale } from "../../scripts/lib/i18n-files.mjs";
// @ts-expect-error plain JavaScript
import { lazyEnglishEntries } from "../../scripts/lib/i18n-lazy.mjs";

const ROOT = join(__dirname, "../..");
const glossary = readGlossary(ROOT);
const en: Record<string, string> = { ...readLocale("en"), ...Object.fromEntries(lazyEnglishEntries(ROOT)) };
const locales: Record<string, Record<string, string>> = Object.fromEntries(listLocales().filter((l: string) => l !== "en").map((l: string) => [l, readLocale(l)]));
type Dev = { term: string; key: string; lang: string; kind: string; level: string; detail: string };

describe("the glossary file", () => {
  it("has the core terms, each with a definition and an approved translation in every language", () => {
    expect(glossaryShape(glossary)).toEqual([]);
    const ids = glossary.terms.map((t: { id: string }) => t.id);
    for (const id of ["vault", "note", "sync", "property"]) expect(ids).toContain(id);
    // Every shipped language but English (review 14 L9: fa had none).
    expect([...GLOSSARY_LANGS].sort()).toEqual(SUPPORTED_LOCALES.map((l) => l.code).filter((c) => c !== "en").sort());
    const vault = glossary.terms.find((t: { id: string }) => t.id === "vault");
    expect(vault.he.term).toBe("כספת");
    expect(vault.he.avoid).toContain("מאגר");
  });
});

describe("the consistency gate", () => {
  it("this tree: 0 deviations in every language (acceptance)", () => {
    const { deviations, checked } = checkGlossary({ glossary, en, locales });
    expect(checked).toBeGreaterThan(1000);
    expect(deviations.filter((d: Dev) => d.level === "error").map((d: Dev) => `${d.lang} ${d.key} ${d.term} ${d.kind}`)).toEqual([]);
  });

  it("finds “מאגר” for vault, a missing term, and leaves alone {placeholders}, `code`, paths and file names", () => {
    const enX = { a: "Open the vault", b: "Sync now", c: "{vault} · .canvas · `tags:` · templates/" };
    const he = { a: "פתיחת המאגר", b: "עכשיו", c: "{vault} · .canvas · `tags:` · templates/" };
    const devs = checkGlossary({ glossary, en: enX, locales: { he } }).deviations.map((d: Dev) => `${d.key} ${d.term} ${d.kind} ${d.level}`);
    expect(devs).toEqual(["a vault avoid error", "b sync missing error"]);
  });

  it("a translation's own placeholder doesn't count as the term ({tags} is not “tags”)", () => {
    const devs = checkGlossary({ glossary, en: { k: "{tags} tags" }, locales: { fr: { k: "{tags} étiquettes" } } }).deviations;
    expect(devs.map((d: Dev) => d.kind)).toEqual(["avoid"]);
  });

  it("a word with other senses in English (note: “meeting notes”, “Note:”) only warns", () => {
    const devs = checkGlossary({ glossary, en: { k: "Add a note…" }, locales: { he: { k: "הוספת הערה…" } } }).deviations;
    expect(devs.map((d: Dev) => `${d.term} ${d.level}`)).toEqual(["note warning"]);
  });

  it("the CLI fails on a planted deviation, on a stale docs table and on an empty glossary; passes on this tree", () => {
    const tmp = mkdtempSync(join(tmpdir(), "glossary-"));
    try {
      for (const d of ["scripts", "i18n", "src/i18n/locales", "src/i18n/lazy", "docs/src/content/docs/contributing", "docs/src/content/docs/he/contributing"]) cpSync(join(ROOT, d), join(tmp, d), { recursive: true });
      const run = () => {
        try {
          execFileSync(process.execPath, [join(tmp, "scripts/i18n-glossary.mjs"), "--check"], { cwd: tmp, stdio: "pipe" });
          return 0;
        } catch (e) {
          return (e as { status: number }).status;
        }
      };
      expect(run()).toBe(0);
      const file = join(tmp, "src/i18n/locales/he/files.json");
      const original = readFileSync(file, "utf8");
      const he = JSON.parse(original);
      const key = Object.keys(he).find((k) => /\bvault\b/i.test(en[k] ?? "") && he[k].includes("הכספת"))!;
      he[key] = he[key].replace("הכספת", "המאגר");
      writeFileSync(file, JSON.stringify(he));
      expect(run()).toBe(1);
      writeFileSync(file, original);
      const docs = join(tmp, "docs/src/content/docs/he/contributing/translations.md");
      const page = readFileSync(docs, "utf8");
      writeFileSync(docs, page.replace("| כספת |", "| מאגר |"));
      expect(run()).toBe(1);
      writeFileSync(docs, page);
      writeFileSync(join(tmp, "i18n/glossary.json"), JSON.stringify({ terms: [] }));
      expect(run()).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("where the glossary is used", () => {
  it("the Help translate page (en and he) shows every term in every language", () => {
    for (const f of ["docs/src/content/docs/contributing/translations.md", "docs/src/content/docs/he/contributing/translations.md"]) {
      const page = readFileSync(join(ROOT, f), "utf8");
      for (const t of glossary.terms) for (const l of GLOSSARY_LANGS) expect(page, `${f} ${t.id} ${l}`).toContain(t[l].term);
    }
  });

  it("the draft agent (npm run i18n:draft) gets the terms in its system prompt", async () => {
    expect(glossaryPrompt(glossary, "he")).toContain("vault → כספת (not: מאגר)");
    let body = "";
    const fetchImpl = async (_url: string, init: { body: string }) => {
      body = init.body;
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ t: ["x"] }) } }) };
    };
    await ollamaEngine({ fetchImpl, glossary }).translate(["Open the vault"], "he");
    const system = JSON.parse(body).messages[0].content;
    expect(system).toContain("vault → כספת");
    expect(system).toContain("sync → סנכרון");
  });
});
