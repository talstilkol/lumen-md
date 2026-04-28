/**
 * Tests for the lazy-locale infrastructure (β.4.4).
 *
 * The 6 locales added to `SUPPORTED_LOCALES` (ar/ru/fr/de/ja/zh-CN)
 * now ship with a core set of ~50 translated keys each. Full translations
 * require running the OpenAI translate script. `isLocaleAvailable()` reports
 * them as available since they have real keys. `loadLocale()` resolves
 * cleanly and `t()` returns the translated value.
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

  it("isLocaleAvailable returns true for locales with real translated keys", async () => {
    // All 6 locales now have ~50 core keys translated.
    await loadLocale("ar");
    expect(isLocaleAvailable("ar")).toBe(true);
    await loadLocale("fr");
    expect(isLocaleAvailable("fr")).toBe(true);
    await loadLocale("ru");
    expect(isLocaleAvailable("ru")).toBe(true);
  });

  it("ar / zh-CN are tagged with the right `dir`", () => {
    const ar = SUPPORTED_LOCALES.find((l) => l.code === "ar");
    const zh = SUPPORTED_LOCALES.find((l) => l.code === "zh-CN");
    expect(ar?.dir).toBe("rtl");
    expect(zh?.dir).toBe("ltr");
  });

  it("loadLocale returns the lazy bundle with real translated keys", async () => {
    const bundle = await loadLocale("ar");
    expect(typeof bundle).toBe("object");
    // ar.json now has real translations.
    applyLocale("ar");
    expect(t("toolbar.tagline")).toBe("Markdown، مُنار");
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

  it("t() returns translated value for loaded locale", async () => {
    await loadLocale("fr");
    applyLocale("fr");
    // fr.json has 'toolbar.new' translated.
    expect(t("toolbar.new")).toBe("Nouveau");
    applyLocale("en");
  });
});
