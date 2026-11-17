/**
 * Plan W13.I7 — Persian as a third right-to-left language, in beta: Persian
 * digits, solar Hijri dates (fa-IR, calendar=persian), the activation strings
 * drafted and listed for native review, "beta" in the language picker, and
 * the RTL matrix (e2e/rtl-matrix-fa.spec.ts).
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyLocale, isRTL, loadLocale, SUPPORTED_LOCALES, t, formatNumber } from "../i18n";
import { detectLocale } from "../i18n/detect";
import { formatDate } from "../i18n/format";
import { localeOptionLabel } from "../i18n/localeLabel";
import { isBetaLocale, LOCALE_REVIEW } from "../i18n/review";
import { numeralsTag, setNumerals } from "../i18n/numerals";
import { applyRtlExtras } from "../i18n/rtlExtras";
import { welcomeDoc } from "../welcomeDoc";
import { readLocale } from "../../scripts/lib/i18n-files.mjs";
import { readNeedsReview, sourceHash } from "../../scripts/lib/i18n-draft.mjs";
import { lazyEnglish } from "./helpers/i18nLazy";
import { activationKeys, SAME_EVERYWHERE } from "./helpers/activationKeys";

const ROOT = join(__dirname, "../..");
afterEach(() => {
  setNumerals("fa", "native");
  applyLocale("en");
});

describe("a third right-to-left language, in beta", () => {
  it("is listed right to left and marked beta in the picker", () => {
    expect(SUPPORTED_LOCALES.find((l) => l.code === "fa")).toEqual({ code: "fa", label: "فارسی", dir: "rtl" });
    expect(LOCALE_REVIEW.fa).toBe("beta");
    expect(isBetaLocale("fa")).toBe(true);
    expect(localeOptionLabel("fa")).toContain("فارسی");
    expect(localeOptionLabel("fa")).not.toBe("فارسی");
  });

  it("applies dir=rtl and lang=fa, and a Persian system starts in Persian", async () => {
    await loadLocale("fa");
    applyLocale("fa");
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("fa");
    expect(isRTL()).toBe(true);
    expect(t("toolbar.fileMenu")).toBe("فایل");
    expect(detectLocale(null, ["fa-IR", "en-US"])).toBe("fa");
    expect(readFileSync(join(ROOT, "public/boot.js"), "utf8")).toContain('fa: "rtl"');
  });
});

describe("Persian digits and the solar Hijri calendar (acceptance: Intl with fa-IR and calendar=persian)", () => {
  const day = Date.UTC(2026, 10, 17);
  it("dates: ۲۶ آبان ۱۴۰۵, Persian digits by default", async () => {
    await loadLocale("fa");
    applyLocale("fa");
    expect(numeralsTag("fa")).toBe("fa-u-nu-arabext");
    expect(formatDate(day, { dateStyle: "long", timeZone: "UTC" })).toBe("۲۶ آبان ۱۴۰۵");
    expect(formatNumber(2026)).toBe("۲٬۰۲۶");
  });

  it("Latin digits on request, still the solar calendar", async () => {
    await loadLocale("fa");
    applyLocale("fa");
    setNumerals("fa", "latn");
    expect(formatDate(day, { dateStyle: "long", timeZone: "UTC" })).toBe("26 آبان 1405");
  });
});

describe("the draft translation", () => {
  const en = { ...readLocale("en"), ...lazyEnglish() } as Record<string, string>;
  const fa = readLocale("fa") as Record<string, string>;

  it("has every key (English until translated), and every activation string in Persian", () => {
    expect(Object.keys(fa).length).toBe(Object.keys(en).length);
    const keys = activationKeys(en);
    const english = keys.filter((k) => !fa[k] || (fa[k] === en[k] && !SAME_EVERYWHERE.test(en[k])));
    expect(english).toEqual([]);
  });

  it("each Persian draft is listed for native review, with the hash of its English", () => {
    const review = readNeedsReview(join(ROOT, "i18n/needs-review"));
    const drafted = Object.keys(fa).filter((k) => fa[k] !== en[k]);
    expect(drafted.length).toBeGreaterThan(140);
    for (const k of drafted) expect(review[k]?.fa, k).toBe(sourceHash(en[k]));
  });

  it("the welcome note is in Persian", async () => {
    await applyRtlExtras("fa");
    expect(welcomeDoc("fa")).toContain("به **Lumen** خوش آمدید");
  });
});
