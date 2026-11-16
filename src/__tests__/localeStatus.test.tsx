/**
 * Launch P0 #16 — only Hebrew and English ship as full languages; ar, de,
 * fr, ja, ru and zh-CN are "Beta (machine translation, awaiting native
 * review)" in the language picker (command palette), onboarding and Settings,
 * each with a link to the help section on reporting a translation issue.
 * src/i18n/review.ts is the one list of which languages are full: this test
 * holds every consumer, the strings and the docs to it.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SUPPORTED_LOCALES, isLocaleAvailable, type Locale } from "../i18n";
import { LOCALE_REVIEW, betaLocales, fullLocales, isBetaLocale, isFullLocale } from "../i18n/review";
import { localeOptionLabel } from "../i18n/localeLabel";
import { OPEN_HELP_EVENT } from "../ui/HelpButton";
import { localeStrings } from "./helpers/localeFiles";
import { readNeedsReview, sourceHash } from "../../scripts/lib/i18n-draft.mjs";
import { installFakeOpfs } from "./helpers/fakeOpfs";

vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));

const ROOT = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const BETA: Locale[] = ["ar", "de", "fr", "ja", "ru", "zh-CN"];
const MARK = "Beta (machine translation, awaiting native review)";
const KEYS = ["locale.beta", "locale.betaLabel", "locale.betaHint", "locale.betaHelp"];

afterEach(cleanup);

describe("the one list of full and beta languages", () => {
  it("covers every UI language: en and he are full, the six machine-translated ones are beta", () => {
    expect(Object.keys(LOCALE_REVIEW).sort()).toEqual(SUPPORTED_LOCALES.map((l) => l.code).sort());
    expect(fullLocales().sort()).toEqual(["en", "he"]);
    expect(betaLocales().sort()).toEqual(BETA);
    for (const l of SUPPORTED_LOCALES) expect(isFullLocale(l.code), l.code).toBe(!isBetaLocale(l.code));
    expect(isFullLocale("xx")).toBe(false);
  });

  it("a full language counts as available before its chunk loads; a beta one does not", () => {
    expect(isLocaleAvailable("en")).toBe(true);
    expect(isLocaleAvailable("he")).toBe(true);
    for (const l of BETA) expect(isLocaleAvailable(l), l).toBe(false);
  });

  it("index.ts keeps no list of its own (no second source of truth)", () => {
    const src = read("src/i18n/index.ts");
    expect(src).not.toMatch(/COMPLETE_LOCALES|new Set<Locale>\(\["en", "he"\]\)/);
    expect(src).toContain('import { isFullLocale } from "./review"');
  });
});

describe("the label wherever a language is picked", () => {
  it("names a beta language with the full marker, a full one plainly", () => {
    expect(localeOptionLabel("ru")).toBe(`Русский — ${MARK}`);
    expect(localeOptionLabel("zh-CN")).toBe(`简体中文 — ${MARK}`);
    expect(localeOptionLabel("he")).toBe("עברית");
    expect(localeOptionLabel("en")).toBe("English");
  });

  it("the palette, Settings and the first run all name languages through it", () => {
    expect(read("src/commands/domains/view.ts")).toContain('t("cmd.view.language", { label: localeOptionLabel(l.code) })');
    expect(read("src/ui/SettingsScreen.tsx")).toMatch(/entry\.id === "locale" \? localeOptionLabel\(o\.value\)/);
    const fr = read("src/onboarding/FirstRun.tsx");
    expect(fr).toContain("isBetaLocale(l.code) && <small");
    expect(fr).toContain('t("locale.beta")');
    expect(fr).toContain("onClick={openTranslationHelp}");
  });

  it("the help link opens the in-app help at the section on reporting a translation issue", () => {
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(OPEN_HELP_EVENT, on);
    return import("../i18n/localeLabel").then(({ openTranslationHelp }) => {
      openTranslationHelp();
      window.removeEventListener(OPEN_HELP_EVENT, on);
      expect(seen).toEqual([{ topic: "contributing/translations#report-a-translation-issue", query: "" }]);
    });
  });
});

describe("the strings", () => {
  it("every language has the four beta strings, the label keeps {label}, and English says it in full", () => {
    for (const l of SUPPORTED_LOCALES) {
      const s = localeStrings(l.code);
      for (const k of KEYS) expect(s[k], `${l.code} ${k}`).toBeTruthy();
      expect(s["locale.betaLabel"], l.code).toContain("{label}");
      expect(s["locale.betaLabel"], l.code).toContain(s["locale.beta"]);
    }
    expect(localeStrings("en")["locale.beta"]).toBe(MARK);
    expect(localeStrings("he")["locale.beta"]).toMatch(/^בטא \(תרגום מכונה/);
  });

  it("the machine translations of the new strings are listed as needing native review (Hebrew is not: it is written by hand)", () => {
    const review = readNeedsReview(join(ROOT, "i18n", "needs-review"));
    const en = localeStrings("en");
    for (const k of KEYS) {
      expect(Object.keys(review[k] ?? {}).sort(), k).toEqual(BETA);
      for (const l of BETA) expect(review[k][l], `${k} ${l}`).toBe(sourceHash(en[k]));
    }
  });
});

describe("the docs (en and he) match the list", () => {
  const rows = (md: string) => [...md.matchAll(/^\| (.+?) \| (.+?) \|$/gm)].map((m) => [m[1], m[2]]).filter(([a]) => a !== "Language" && a !== "שפה" && !a.startsWith("---"));
  it("the status table: two full, six beta, in the same order as SUPPORTED_LOCALES", () => {
    const en = rows(read("docs/src/content/docs/contributing/translations.md"));
    const he = rows(read("docs/src/content/docs/he/contributing/translations.md"));
    const want = SUPPORTED_LOCALES.map((l) => isBetaLocale(l.code));
    expect(en.map(([, s]) => s === "beta")).toEqual(want);
    expect(he.map(([, s]) => s === "בטא")).toEqual(want);
    expect(en.filter(([, s]) => s.startsWith("full")).length).toBe(2);
    expect(he.filter(([, s]) => s.startsWith("מלאה")).length).toBe(2);
    SUPPORTED_LOCALES.forEach((l, i) => {
      expect(en[i][0], l.code).toContain(l.label);
      expect(he[i][0], l.code).toContain(l.label);
    });
  });

  it("both pages carry the section the link opens, and the in-app help packs it in both languages", () => {
    expect(read("docs/src/content/docs/contributing/translations.md")).toMatch(/^## Report a translation issue$/m);
    expect(read("docs/src/content/docs/he/contributing/translations.md")).toMatch(/^## דיווח על בעיה בתרגום$/m);
    for (const lang of ["en", "he"]) {
      const shards = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        try {
          return JSON.parse(read(`src/help/generated/help.${lang}.${i}.json`)) as { pages: { slug: string; sections: { key: string }[] }[] };
        } catch {
          return { pages: [] };
        }
      });
      const page = shards.flatMap((s) => s.pages).find((p) => p.slug === "contributing/translations");
      expect(page?.sections.map((s) => s.key), lang).toContain("report-a-translation-issue");
    }
  });
});

describe("on screen", () => {
  beforeAll(async () => {
    installFakeOpfs();
    await import("../storage/vault/location");
  });

  it("the first run's language step marks the six beta languages, not Hebrew or English, and links to the help", async () => {
    localStorage.clear();
    const { default: FirstRun } = await import("../onboarding/FirstRun");
    render(<FirstRun onDone={() => {}} />);
    if (!screen.queryByTestId("first-run-beta-hint")) fireEvent.click(screen.getByTestId("first-run-change-language"));
    for (const l of BETA) expect(screen.getByTestId(`first-run-beta-${l}`).textContent, l).toBe(MARK);
    expect(screen.queryByTestId("first-run-beta-he")).toBeNull();
    expect(screen.queryByTestId("first-run-beta-en")).toBeNull();
    const seen: string[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent<{ topic: string }>).detail.topic);
    window.addEventListener(OPEN_HELP_EVENT, on);
    fireEvent.click(screen.getByTestId("first-run-beta-help"));
    window.removeEventListener(OPEN_HELP_EVENT, on);
    expect(seen).toEqual(["contributing/translations#report-a-translation-issue"]);
  });

  it("Settings → Language: every option says beta or not, and the help link is there", async () => {
    localStorage.clear();
    const { SettingsScreen } = await import("../ui/SettingsScreen");
    render(<SettingsScreen onClose={() => {}} />);
    const select = document.querySelector('select[data-setting="locale"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const labels = Object.fromEntries([...select.options].map((o) => [o.value, o.textContent]));
    for (const l of SUPPORTED_LOCALES) expect(labels[l.code], l.code).toBe(isBetaLocale(l.code) ? `${l.label} — ${MARK}` : l.label);
    expect(screen.getByTestId("locale-beta-help").textContent).toBe("How to report a translation issue");
  });
});
