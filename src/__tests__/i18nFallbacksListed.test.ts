/**
 * Review 13 L2: langId.test leaves out a translation that keeps an English word of its source — so an
 * untranslated English copy is never measured there. Such a copy must at least be on the review list
 * (i18n/needs-review), where the values gate counts it as untranslated, instead of passing unseen.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const merge = (dir: string): Record<string, string> => Object.assign({}, ...readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))));
const en = { ...merge(join(ROOT, "src/i18n/lazy")), ...merge(join(ROOT, "src/i18n/locales/en")) };
const review = merge(join(ROOT, "i18n/needs-review")) as unknown as Record<string, Record<string, string>>;

describe("English copies that langId leaves out are on the review list (review 13 L2)", () => {
  for (const lang of ["ar", "de", "fr", "he", "ja", "ru", "zh-CN"]) {
    it(lang, () => {
      const loc = merge(join(ROOT, "src/i18n/locales", lang));
      const unlisted = Object.entries(loc)
        .filter(([k, v]) => en[k] !== undefined && v === en[k] && (v.replace(/\{[^}]*\}/g, " ").match(/\p{L}{2,}/gu) ?? []).length >= 3)
        .filter(([k]) => !review[k]?.[lang])
        .map(([k]) => k);
      expect(unlisted).toEqual([]);
    });
  }
});
