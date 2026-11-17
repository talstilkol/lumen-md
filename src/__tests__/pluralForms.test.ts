/**
 * Plan W13.I2 — CLDR plural forms in every language. A counted string is one
 * key whose value holds every form its language needs
 * ("{count, plural, zero {…} one {…} two {…} few {…} many {…} other {…}}"),
 * t() / tPlural() pick the form with Intl.PluralRules, and the i18n:check gate
 * (scripts/i18n-plurals.mjs) fails on a key that lacks a category of
 * PluralRules(locale).resolvedOptions().pluralCategories.
 */
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLocale, loadLocale, t, tPlural } from "../i18n";
import { parsePlural, requiredCategories, resolvePlural } from "../i18n/plural";
// @ts-expect-error plain JavaScript
import { checkPlurals, parsePlural as parseMjs } from "../../scripts/lib/i18n-plural.mjs";
import { listLocales, readLocale } from "../../scripts/lib/i18n-files.mjs";
// @ts-expect-error plain JavaScript
import { lazyEnglishEntries } from "../../scripts/lib/i18n-lazy.mjs";

const ROOT = join(__dirname, "../..");
const en: Record<string, string> = { ...readLocale("en"), ...Object.fromEntries(lazyEnglishEntries(ROOT)) };
const locales: Record<string, Record<string, string>> = Object.fromEntries(listLocales().filter((l: string) => l !== "en").map((l: string) => [l, readLocale(l)]));
const pending: string[] = JSON.parse(readFileSync(join(ROOT, "i18n/plural-pending.json"), "utf8")).keys;

afterEach(() => applyLocale("en"));

describe("the CLDR categories of the eight languages", () => {
  it("Arabic needs six forms, Hebrew three, Russian four, French three, English and German two, Japanese and Chinese one", () => {
    expect(requiredCategories("ar")).toEqual(["zero", "one", "two", "few", "many", "other"]);
    expect(requiredCategories("he")).toEqual(["one", "two", "other"]);
    expect(requiredCategories("ru")).toEqual(["one", "few", "many", "other"]);
    expect(requiredCategories("fr")).toEqual(["one", "many", "other"]);
    expect(requiredCategories("en")).toEqual(["one", "other"]);
    expect(requiredCategories("de")).toEqual(["one", "other"]);
    expect(requiredCategories("ja")).toEqual(["other"]);
    expect(requiredCategories("zh-CN")).toEqual(["other"]);
  });
});

describe("the plural block", () => {
  it("parses selectors, nested {vars}, exact =N and the text around it", () => {
    const m = parsePlural("Found {n, plural, =0 {nothing} one {# issue in {file}} other {# issues}}!");
    expect(m).toEqual({ arg: "n", forms: { "=0": "nothing", one: "# issue in {file}", other: "# issues" }, before: "Found ", after: "!" });
    expect(resolvePlural("{n, plural, =0 {none} one {# item} other {# items}}", 0, "en")).toBe("none");
    expect(resolvePlural("{n, plural, one {# item} other {# items}}", 1234, "en")).toBe("1,234 items");
  });

  it("refuses a block without other, with a repeated or unknown selector, or unbalanced braces", () => {
    for (const bad of ["{n, plural, one {x}}", "{n, plural, one {x} one {y} other {z}}", "{n, plural, lots {x} other {y}}", "{n, plural, one {x other {y}}"]) expect(parsePlural(bad), bad).toBeNull();
  });

  it("the gate's parser (scripts) and the runtime's agree on every value of every language", () => {
    let n = 0;
    for (const strings of [en, ...Object.values(locales)])
      for (const v of Object.values(strings)) {
        if (!v.includes("plural")) continue;
        n++;
        expect(parseMjs(v)).toEqual(parsePlural(v));
      }
    expect(n).toBeGreaterThan(30 * 7);
  });
});

describe("the UI picks the right form (acceptance)", () => {
  it("Hebrew: 1 → פתק אחד, 2 → 2 פתקים (the dual category), 5 → 5 פתקים", async () => {
    await loadLocale("he");
    applyLocale("he");
    expect(t("db.count", { count: 1 })).toBe("פתק אחד");
    expect(t("db.count", { count: 2 })).toBe("2 פתקים");
    expect(t("db.count", { count: "5" })).toBe("5 פתקים");
  });

  it("Arabic: 0 لا ملاحظات · 1 ملاحظة واحدة · 2 ملاحظتان · 3 ملاحظات · 11 ملاحظةً · 100 ملاحظة", async () => {
    await loadLocale("ar");
    applyLocale("ar");
    expect(t("db.count", { count: 0 })).toBe("لا ملاحظات");
    expect(t("db.count", { count: 1 })).toBe("ملاحظة واحدة");
    expect(t("db.count", { count: 2 })).toBe("ملاحظتان");
    expect(t("db.count", { count: 3 })).toBe("3 ملاحظات");
    expect(t("db.count", { count: 11 })).toBe("11 ملاحظةً");
    expect(t("db.count", { count: 100 })).toBe("100 ملاحظة");
  });

  it("Russian: 1 заметка, 3 заметки, 5 заметок, 21 заметка", async () => {
    await loadLocale("ru");
    applyLocale("ru");
    expect([1, 3, 5, 21].map((count) => t("db.count", { count }))).toEqual(["1 заметка", "3 заметки", "5 заметок", "21 заметка"]);
  });

  it("tPlural keeps its other {vars} and writes the count with the locale's grouping", async () => {
    await loadLocale("ar");
    applyLocale("ar");
    expect(tPlural("agentReview.toast", 2, { agent: "X" })).toBe("اقترح X تغييرين. لا يُكتب شيء قبل موافقتك.");
    applyLocale("en");
    expect(tPlural("search.results", 1)).toBe("1 result");
    expect(tPlural("search.results", 12000)).toBe("12,000 results");
    expect(t("status.words", { n: 42 })).toBe("42 words");
  });

  it("a count that isn't a number takes the other form and shows as given", () => {
    applyLocale("en");
    expect(t("db.count", { count: "many" })).toBe("many notes");
  });
});

describe("the gate (npm run i18n:check → scripts/i18n-plurals.mjs)", () => {
  it("this tree: every plural key has every CLDR form in every language, and nothing new counts without one", () => {
    const r = checkPlurals({ en, locales, pending });
    expect(r.problems).toEqual([]);
    expect(r.plural.length).toBeGreaterThanOrEqual(30);
    expect(r.plural).toContain("db.count");
  });

  it("finds a missing Arabic form, a lost {var}, a legacy .one/.other pair and a new count string", () => {
    const ar = { ...locales.ar, "db.count": "{count, plural, one {ملاحظة واحدة} other {# ملاحظة}}", "agentReview.toast": "{n, plural, zero {a} one {b} two {c} few {d} many {e} other {# {agent}}}" };
    const enX = { ...en, "x.new.one": "1 thing", "x.new.other": "{n} things", "x.count": "{count} widgets" };
    const kinds = checkPlurals({ en: enX, locales: { ...locales, ar }, pending }).problems.map((p: { locale: string; key: string; kind: string; detail: string }) => `${p.locale} ${p.key} ${p.kind} ${p.detail}`);
    expect(kinds).toContain("ar db.count missing-form zero,two,few,many");
    expect(kinds.some((k: string) => k.startsWith("ar agentReview.toast missing-var zero: {agent}"))).toBe(true);
    expect(kinds).toContain("en x.new legacy-keys uses .one/.other keys: write one value with a plural block");
    expect(kinds.some((k: string) => k.startsWith("en x.count new-count-string"))).toBe(true);
  });

  it("the CLI fails on a tree with no plural key at all (it never passes on nothing), and on a missing form", () => {
    const tmp = mkdtempSync(join(tmpdir(), "plural-gate-"));
    try {
      for (const d of ["scripts", "i18n", "src/i18n/locales", "src/i18n/lazy"]) cpSync(join(ROOT, d), join(tmp, d), { recursive: true });
      const run = () => {
        try {
          execFileSync(process.execPath, [join(tmp, "scripts/i18n-plurals.mjs"), "--check"], { cwd: tmp, stdio: "pipe" });
          return 0;
        } catch (e) {
          return (e as { status: number }).status;
        }
      };
      expect(run()).toBe(0);
      const file = join(tmp, "src/i18n/locales/ar/common.json");
      const ar = JSON.parse(readFileSync(file, "utf8"));
      ar["db.count"] = "{count, plural, one {ملاحظة واحدة} other {# ملاحظة}}";
      writeFileSync(file, JSON.stringify(ar));
      expect(run()).toBe(1);
      for (const l of ["en", ...Object.keys(locales)]) {
        const dir = join(tmp, "src/i18n/locales", l);
        for (const f of ["ai", "canvas", "cmd", "common", "editor", "files", "settings", "toast"]) writeFileSync(join(dir, `${f}.json`), "{}");
      }
      rmSync(join(tmp, "src/i18n/lazy"), { recursive: true });
      writeFileSync(join(tmp, "i18n/plural-pending.json"), JSON.stringify({ keys: [] }));
      expect(run()).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
