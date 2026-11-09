import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/** The `en` bundle's source (split into src/i18n/en/ in plan 12.1), as one `const en: Strings = { … };` block. */
function enBundleSource(): string {
  const body = ["app.ts", "features.ts"].map((part) => {
    const text = readFileSync(join(__dirname, "..", "i18n", "en", part), "utf8");
    return text.slice(text.indexOf("const en: Strings = {") + "const en: Strings = {".length, text.indexOf("\n};\n"));
  });
  return `const en: Strings = {${body.join("\n")}\n};\n`;
}

/**
 * Ensures every lazy-loaded locale JSON has the same keys as the EN
 * bundle. Catches drift when a developer adds an EN key but forgets
 * to run the translation generator.
 */
describe("i18n locale drift", () => {
  // Parse the EN key set from the bundle's parts
  const content = enBundleSource();
  const enStart = content.indexOf("const en: Strings = {");
  const enEnd = content.indexOf("\n};\n", enStart) + 3;
  const enBlock = content.slice(enStart, enEnd);
  const enKeys = new Set<string>();
  const re = /"([^"]+)":\s*"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(enBlock)) !== null) enKeys.add(m[1]);

  const locales = ["he", "ar", "de", "fr", "ja", "ru", "zh-CN"];
  const localeDir = join(__dirname, "..", "i18n", "locales");

  for (const locale of locales) {
    it(`${locale}.json has no missing EN keys`, () => {
      const localeData = JSON.parse(
        readFileSync(join(localeDir, `${locale}.json`), "utf8"),
      );
      const localeKeys = new Set(
        Object.keys(localeData).filter((k) => !k.startsWith("_")),
      );
      const missing = [...enKeys].filter((k) => !localeKeys.has(k));
      expect(missing, `Missing keys in ${locale}`).toEqual([]);
    });

    it(`${locale}.json has no extra keys not in EN`, () => {
      const localeData = JSON.parse(
        readFileSync(join(localeDir, `${locale}.json`), "utf8"),
      );
      const localeKeys = Object.keys(localeData).filter(
        (k) => !k.startsWith("_"),
      );
      const extra = localeKeys.filter((k) => !enKeys.has(k));
      // Strictly zero extras — orphan translations bloat the bundle
      // and confuse readers about which keys are still in production.
      // The previous "allow up to 10" was a soft pass that let four
      // dead keys (findReplace.find, findReplace.matchCase,
      // mdTable.cancel, writingGoal.label) sit untouched. If a sub-
      // dialect needs an override, add the key to the EN source first.
      expect(extra, `Extra keys in ${locale}`).toEqual([]);
    });
  }
});
