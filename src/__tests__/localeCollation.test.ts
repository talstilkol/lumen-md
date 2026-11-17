/**
 * Plan W13.I3 — names sort the way people read, and dates and numbers follow
 * the UI language: one helper (src/i18n/collate.ts) for the file tree,
 * search, Bases and every list; src/i18n/format.ts for dates (Gregorian or
 * Hebrew calendar); and a scan that finds `localeCompare` without a locale
 * and `toLocaleString()` without one anywhere in the app.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import ts from "typescript";
import { compareNames, compareCodePoints, nameCollator, sortByName, uiLocale } from "../i18n/collate";
import { dateCalendar, formatDate, formatTime, setDateCalendar } from "../i18n/format";
import { applyLocale } from "../i18n";
import { compareVaultEntries } from "../storage/vault/shared";
import { sortCompare } from "../views/bases/values";

const ROOT = join(__dirname, "../..");
afterEach(() => {
  applyLocale("en");
  setDateCalendar("gregory");
});

describe("name order (acceptance)", () => {
  it("“פתק 2” before “פתק 10”, and “שָׁלוֹם” next to “שלום”", () => {
    applyLocale("he");
    expect(compareNames("פתק 2", "פתק 10")).toBeLessThan(0);
    expect(compareNames("שָׁלוֹם", "שלום")).toBe(0);
    const sorted = sortByName(["שלום עליכם", "פתק 10", "שלג", "שָׁלוֹם", "פתק 2", "אבא", "שלום"]);
    expect(sorted).toEqual(["אבא", "פתק 2", "פתק 10", "שלג", "שָׁלוֹם", "שלום", "שלום עליכם"]);
    // Code-unit order (what .sort() and the old tree did) puts 10 before 2 and niqqud far away.
    expect(["פתק 10", "פתק 2"].sort()).toEqual(["פתק 10", "פתק 2"]);
  });

  it("case and accents don't separate names; the UI language's rules apply (ö in German vs Swedish)", () => {
    expect(compareNames("note", "Note")).toBe(0);
    expect(compareNames("Note 9", "note 10")).toBeLessThan(0);
    expect(compareNames("ö", "z", "de")).toBeLessThan(0);
    expect(compareNames("ö", "z", "sv")).toBeGreaterThan(0);
    applyLocale("he");
    expect(uiLocale()).toBe("he");
  });

  it("sortByName is stable and caches one collator per language", () => {
    const items = [{ n: "b", i: 1 }, { n: "A", i: 2 }, { n: "a", i: 3 }];
    expect(sortByName(items, (x) => x.n).map((x) => x.i)).toEqual([2, 3, 1]);
    expect(nameCollator("he")).toBe(nameCollator("he"));
  });

  it("10,000 note names sort in well under a second", () => {
    applyLocale("he");
    const names = Array.from({ length: 10_000 }, (_, i) => `${i % 2 ? "פתק" : "Note"} ${(i * 7919) % 10_000}`);
    const t0 = performance.now();
    const out = sortByName(names);
    expect(performance.now() - t0).toBeLessThan(1000);
    // Hebrew rules put Hebrew letters first, numbers in numeric order.
    expect(out.slice(0, 3)).toEqual(["פתק 1", "פתק 3", "פתק 5"]);
    expect(out.at(-1)).toBe("Note 9998");
  });

  it("machine order (ids, ISO dates in exports) is the same in every language", () => {
    applyLocale("he");
    expect(["b", "B", "a"].sort(compareCodePoints)).toEqual(["B", "a", "b"]);
  });
});

describe("the surfaces use it", () => {
  it("the file tree: folders first, then names in natural order", () => {
    applyLocale("he");
    const entries = [{ kind: "file", name: "פתק 10.md" }, { kind: "file", name: "פתק 2.md" }, { kind: "directory", name: "ת" }, { kind: "file", name: "שָׁלוֹם.md" }] as const;
    expect([...entries].sort(compareVaultEntries).map((e) => e.name)).toEqual(["ת", "פתק 2.md", "פתק 10.md", "שָׁלוֹם.md"]);
  });

  it("Bases: text cells in natural order in the UI language", () => {
    applyLocale("he");
    expect(sortCompare("פתק 2", "פתק 10")).toBeLessThan(0);
    expect(sortCompare("שָׁלוֹם", "שלום")).toBe(0);
  });

  it("the call sites of the file tree, search, Bases and the database view go through the helper", () => {
    for (const f of ["src/storage/vault/shared.ts", "src/search/embeddedQuery.ts", "src/search/dataview.ts", "src/views/database.ts", "src/views/bases/values.ts", "src/views/tagsIndex.ts"]) {
      expect(readFileSync(join(ROOT, f), "utf8"), f).toMatch(/compareNames|nameCollator/);
    }
  });
});

describe("dates and numbers in the UI language", () => {
  const day = Date.UTC(2026, 10, 17, 12, 0);
  it("Hebrew month names in Hebrew, English in English — not the browser's language", () => {
    applyLocale("he");
    expect(formatDate(day, { dateStyle: "long", timeZone: "UTC" })).toBe("17 בנובמבר 2026");
    applyLocale("en");
    expect(formatDate(day, { dateStyle: "long", timeZone: "UTC" })).toBe("November 17, 2026");
    expect(formatTime(day, { timeStyle: "short", timeZone: "UTC", hourCycle: "h23" })).toBe("12:00");
  });

  it("the Hebrew calendar is an option (W2.10): ו׳ בכסלו תשפ״ז, and it persists", () => {
    applyLocale("he");
    setDateCalendar("hebrew");
    expect(dateCalendar()).toBe("hebrew");
    const s = formatDate(day, { dateStyle: "long", timeZone: "UTC" });
    expect(s).toContain("כסלו");
    expect(s).toMatch(/תשפ״ז|5787/);
    setDateCalendar("gregory");
    expect(formatDate(day, { dateStyle: "long", timeZone: "UTC" })).toContain("נובמבר");
  });

  it("an invalid date shows nothing rather than “Invalid Date”", () => {
    expect(formatDate("not a date")).toBe("");
  });
});

/** Every `localeCompare` / `toLocale*String` / `Intl.*()` call in src without a locale. */
function localeLessCalls(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const noLocale = (a: ts.Expression | undefined) => !a || a.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isIdentifier(a) && a.text === "undefined") || (ts.isArrayLiteralExpression(a) && a.elements.length === 0);
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const callee = n.expression;
      const args = n.arguments ?? ts.factory.createNodeArray();
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      if (ts.isPropertyAccessExpression(callee)) {
        const name = callee.name.text;
        if (name === "localeCompare" && noLocale(args[1])) out.push(`${file}:${line} localeCompare without a locale`);
        if (/^toLocale(Date|Time)?String$/.test(name) && noLocale(args[0])) out.push(`${file}:${line} ${name}() without a locale`);
        const obj = callee.expression;
        if (ts.isIdentifier(obj) && obj.text === "Intl" && /Format$|^Collator$/.test(name) && noLocale(args[0])) {
          // Intl.DateTimeFormat().resolvedOptions().timeZone reads the time zone; it formats nothing.
          const parent = n.parent;
          if (!(ts.isPropertyAccessExpression(parent) && parent.name.text === "resolvedOptions")) out.push(`${file}:${line} Intl.${name}() without a locale`);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("the scan: 0 calls without a locale (acceptance)", () => {
  it("finds the planted cases", () => {
    const planted = `a.localeCompare(b); a.localeCompare(b, undefined, { numeric: true }); n.toLocaleString(); d.toLocaleDateString([]); new Intl.NumberFormat(); Intl.DateTimeFormat().resolvedOptions().timeZone; a.localeCompare(b, "he"); n.toLocaleString("he");`;
    expect(localeLessCalls("x.ts", planted)).toEqual([
      "x.ts:1 localeCompare without a locale",
      "x.ts:1 localeCompare without a locale",
      "x.ts:1 toLocaleString() without a locale",
      "x.ts:1 toLocaleDateString() without a locale",
      "x.ts:1 Intl.NumberFormat() without a locale",
    ]);
  });

  it("the app's source has none", () => {
    const files = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { cwd: ROOT }).toString().trim().split("\n").filter((f) => !f.includes("__tests__") && !f.endsWith(".d.ts"));
    expect(files.length).toBeGreaterThan(1000);
    const found = files.flatMap((f) => localeLessCalls(f, readFileSync(join(ROOT, f), "utf8")));
    expect(found).toEqual([]);
  });
});
