/**
 * Tests for the lazy-locale infrastructure (β.4.4).
 *
 * The 6 locales added to `SUPPORTED_LOCALES` (ar/ru/fr/de/ja/zh-CN)
 * don't ship bundles yet — `loadLocale()` falls back to `en` for
 * each, and `isLocaleAvailable()` reports them as unavailable until
 * a JSON file is dropped into `src/i18n/locales/`. We pin both
 * behaviours so a future translator's PR adding `ar.json` doesn't
 * accidentally break the synchronous codepath.
 */

import { describe, it, expect } from "vitest";
import {
  SUPPORTED_LOCALES,
  isLocaleAvailable,
  loadLocale,
  applyLocale,
  t,
} from "../i18n";

describe("β.4 lazy locale infrastructure", () => {
  it("declares all 8 supported locales", () => {
    const codes = SUPPORTED_LOCALES.map((l) => l.code);
    expect(codes).toEqual(["en", "he", "ar", "ru", "fr", "de", "ja", "zh-CN"]);
  });

  it("isLocaleAvailable returns true for en + he (synchronous bundles)", () => {
    expect(isLocaleAvailable("en")).toBe(true);
    expect(isLocaleAvailable("he")).toBe(true);
  });

  it("isLocaleAvailable returns false for empty-stub bundles (translator hasn't filled them in yet)", async () => {
    // Stubs ship as `{}`. Until at least one key is translated, the locale
    // counts as unavailable so the picker doesn't switch users into a
    // pure-English UI silently.
    expect(isLocaleAvailable("ar")).toBe(false);
    expect(isLocaleAvailable("ru")).toBe(false);
    expect(isLocaleAvailable("fr")).toBe(false);
    // Even after a load, the empty `{}` should keep the locale unavailable.
    await loadLocale("ar");
    expect(isLocaleAvailable("ar")).toBe(false);
  });

  it("ar / zh-CN are tagged with the right `dir`", () => {
    const ar = SUPPORTED_LOCALES.find((l) => l.code === "ar");
    const zh = SUPPORTED_LOCALES.find((l) => l.code === "zh-CN");
    expect(ar?.dir).toBe("rtl");
    expect(zh?.dir).toBe("ltr");
  });

  it("loadLocale returns the lazy bundle (empty stubs render via en fallback in t())", async () => {
    // ar.json ships as `{}` until a translator runs the script; loadLocale
    // still resolves cleanly. t() handles the en fallback at lookup time.
    const bundle = await loadLocale("ar");
    expect(typeof bundle).toBe("object");
    // Empty stub → key absent → t() will fall through to en.
    applyLocale("ar");
    expect(t("toolbar.tagline")).toBe("Markdown, illuminated");
    applyLocale("en");
  });

  it("applyLocale sets the document direction even for unavailable locales", () => {
    applyLocale("ar");
    expect(document.documentElement.dir).toBe("rtl");
    applyLocale("fr");
    expect(document.documentElement.dir).toBe("ltr");
    // Restore.
    applyLocale("en");
  });

  it("t() falls through to en when the active locale's bundle isn't loaded yet", () => {
    applyLocale("fr");
    // No fr.json yet — `t()` returns the en value.
    expect(t("toolbar.new")).toBe("New");
    applyLocale("en");
  });
});
