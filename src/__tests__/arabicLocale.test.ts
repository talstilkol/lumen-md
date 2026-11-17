/**
 * Plan W13.I5 — Arabic as a full second right-to-left UI language:
 * Arabic-Indic digits as an option (Intl -u-nu-arab), the Naskh face
 * (Noto Naskh Arabic, OFL) loaded lazily from this origin, justification
 * without kashida, and the first-run, welcome note and templates in Arabic.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { applyLocale, formatNumber, loadLocale, t } from "../i18n";
import { formatDate } from "../i18n/format";
import { numerals, numeralsTag, setNumerals } from "../i18n/numerals";
import { applyRtlExtras, NASKH_FILE, rtlExtrasCss } from "../i18n/rtlExtras";
import { localizedTemplate, welcomeDoc } from "../welcomeDoc";
import { readLocale } from "../../scripts/lib/i18n-files.mjs";
import { lazyEnglish } from "./helpers/i18nLazy";
import { activationKeys, SAME_EVERYWHERE } from "./helpers/activationKeys";

const ROOT = join(__dirname, "../..");
afterEach(() => {
  setNumerals("ar", "latn");
  applyLocale("en");
});

describe("digits: Latin or Arabic-Indic (acceptance: Intl with -u-nu-arab)", () => {
  it("Latin by default, Arabic-Indic when chosen, for numbers, counts and dates", async () => {
    await loadLocale("ar");
    applyLocale("ar");
    expect(numerals("ar")).toBe("latn");
    expect(numeralsTag("ar")).toBe("ar-u-nu-latn");
    expect(formatNumber(1234.5)).toBe("1,234.5");
    setNumerals("ar", "native");
    expect(numeralsTag("ar")).toBe("ar-u-nu-arab");
    expect(formatNumber(1234.5)).toBe("١٬٢٣٤٫٥");
    expect(t("db.count", { count: 3 })).toBe("٣ ملاحظات");
    expect(formatDate(Date.UTC(2026, 10, 17), { dateStyle: "medium", timeZone: "UTC" })).toMatch(/[٠-٩]/);
  });

  it("the choice is per language and never touches the others", () => {
    setNumerals("ar", "native");
    expect(numeralsTag("he")).toBe("he");
    expect(numeralsTag("en")).toBe("en");
  });
});

describe("the Naskh face and the justification (lazy, own origin)", () => {
  it("is an OFL WOFF under public/fonts/reading, Arabic script only, small", () => {
    const file = join(ROOT, "public", NASKH_FILE);
    expect(readFileSync(file).subarray(0, 4).toString("latin1")).toBe("wOFF");
    expect(statSync(file).size).toBeLessThan(160_000);
    expect(readFileSync(join(ROOT, "public/fonts/reading/OFL-noto-naskh-arabic.txt"), "utf8")).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/i);
  });

  it("the CSS declares it for ar / fa from this origin, before the system face, with word-space justification (no kashida)", () => {
    const css = rtlExtrasCss("/app/");
    expect(css).toContain('src:url("/app/fonts/reading/noto-naskh-arabic.woff") format("woff")');
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).toContain("unicode-range:U+0600-06FF");
    expect(css).toMatch(/:root:lang\(ar\),:root:lang\(fa\)\{--font-sans:Inter,"Lumen Noto Naskh Arabic"/);
    expect(css).toContain("text-justify:inter-word");
  });

  it("installs once, and brings the Arabic welcome note and templates", async () => {
    await applyRtlExtras("ar");
    await applyRtlExtras("ar");
    expect(document.querySelectorAll("#lumen-rtl-extras")).toHaveLength(1);
    expect(welcomeDoc("ar")).toMatch(/^---\ntitle: مرحبًا بك في Lumen/);
    expect(welcomeDoc("en")).not.toContain("مرحبًا");
    const ids = ["meeting-notes", "blog-post", "thesis", "weekly-review", "lesson-plan"];
    for (const id of ids) expect(localizedTemplate(id, "ar")?.content, id).toMatch(/[؀-ۿ]{3}/);
    expect(localizedTemplate("meeting-notes", "ar")?.name).toBe("محضر اجتماع");
    expect(localizedTemplate("meeting-notes", "he")).toBeNull();
  });

  it("is never in the startup bundle: index.ts imports it dynamically, and only for ar / fa", () => {
    const index = readFileSync(join(ROOT, "src/i18n/index.ts"), "utf8");
    expect(index).not.toMatch(/^import .*rtlExtras/m);
    expect(index).toContain('import("./rtlExtras")');
    expect(index).toMatch(/if \(locale === "ar" \|\| locale === "fa"\) void rtlExtras\(locale\)/);
  });
});

describe("the activation strings are 100 % Arabic (acceptance)", () => {
  it("every first-run, tour, setup, menu and toolbar string has an Arabic value that isn't the English", () => {
    const en = { ...readLocale("en"), ...lazyEnglish() } as Record<string, string>;
    const ar = readLocale("ar") as Record<string, string>;
    const keys = activationKeys(en);
    expect(keys.length).toBeGreaterThan(150);
    const missing = keys.filter((k) => !ar[k] || (ar[k] === en[k] && !SAME_EVERYWHERE.test(en[k])));
    expect(missing).toEqual([]);
  });
});
