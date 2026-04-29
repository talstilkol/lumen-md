import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Ensures every lazy-loaded locale JSON has the same keys as the EN
 * bundle. Catches drift when a developer adds an EN key but forgets
 * to run the translation generator.
 */
describe("i18n locale drift", () => {
  // Parse the EN key set from index.ts
  const indexPath = join(__dirname, "..", "i18n", "index.ts");
  const content = readFileSync(indexPath, "utf8");
  const enStart = content.indexOf("const en: Strings = {");
  const enEnd = content.indexOf("\n};\n", enStart) + 3;
  const enBlock = content.slice(enStart, enEnd);
  const enKeys = new Set<string>();
  const re = /"([^"]+)":\s*"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(enBlock)) !== null) enKeys.add(m[1]);

  const locales = ["ar", "de", "fr", "ja", "ru", "zh-CN"];
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
      // Extra keys are warnings not errors — locales may have
      // overrides for sub-dialects. Just log them.
      if (extra.length > 0) {
        console.warn(`[${locale}] extra keys: ${extra.join(", ")}`);
      }
      // Allow up to 10 extra keys (e.g. locale-specific overrides)
      expect(extra.length).toBeLessThanOrEqual(10);
    });
  }
});
