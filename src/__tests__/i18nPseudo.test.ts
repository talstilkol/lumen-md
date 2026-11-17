/**
 * Plan W13.I1 — pseudo-locales en-XA (accented, 40 % longer, in ⟦ ⟧) and
 * ar-XB (the same, right to left), built from the English only on demand and
 * never shipped. e2e/i18n-pseudo.spec.ts walks 20 surfaces with them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error plain JavaScript
import { buildPseudo, checkPseudo, pseudoString, PSEUDO_LOCALES } from "../../scripts/lib/i18n-pseudo.mjs";
import { applyLocale, installBundle, isRTL, SUPPORTED_LOCALES, t } from "../i18n";
import { parsePlural } from "../i18n/plural";

const ROOT = join(__dirname, "../..");

describe("the pseudo transform", () => {
  it("accents, lengthens by 40 % and brackets, keeping placeholders, code, shortcuts and URLs", () => {
    const s = pseudoString("Saved {file} in `notes/` — press ⌘K, see https://example.org");
    expect(s.startsWith("⟦") && s.endsWith("⟧")).toBe(true);
    expect(s).toContain("{file}");
    expect(s).toContain("`notes/`");
    expect(s).toContain("⌘K");
    expect(s).toContain("https://example.org");
    expect(s).toContain("Šáṽéð");
    expect(s.length - 2).toBeGreaterThanOrEqual(Math.floor("Saved {file} in `notes/` — press ⌘K, see https://example.org".length * 1.4));
  });

  it("keeps a plural block a plural block, # and all", () => {
    const s = pseudoString("{count, plural, one {# note} other {# notes}}");
    expect(parsePlural(s)?.forms).toEqual({ one: "# ñöţé", other: "# ñöţéš" });
  });

  it("checkPseudo finds an unbracketed string, a lost placeholder and an empty source", () => {
    const en = { a: "Open {name}", b: "Close" };
    const built = buildPseudo(en);
    expect(checkPseudo(en, built)).toEqual([]);
    built["en-XA"].a = "Öþéñ";
    built["ar-XB"].b = "⟦Çļöšé⟧";
    expect(checkPseudo(en, built)).toEqual(["en-XA a: not bracketed", "ar-XB b: not 40% longer"]);
    expect(checkPseudo({}, buildPseudo({}))).toEqual(["no English strings to build from"]);
  });
});

describe("never in the public build", () => {
  it("not in the language picker, not a folder of src/i18n/locales, .pseudo/ is git-ignored", () => {
    for (const code of Object.keys(PSEUDO_LOCALES)) expect(SUPPORTED_LOCALES.map((l) => l.code as string)).not.toContain(code);
    expect(readFileSync(join(ROOT, ".gitignore"), "utf8")).toMatch(/^\/\.pseudo\/$/m);
    // The app installs it only through the test hooks, which a production build drops (main.tsx).
    expect(readFileSync(join(ROOT, "src/testing/e2eHooks.ts"), "utf8")).toContain('"i18n/index": () => import("../i18n/index")');
    expect(readFileSync(join(ROOT, "src/main.tsx"), "utf8")).toMatch(/if \(import\.meta\.env\.DEV \|\| __LUMEN_E2E__\) void import\("\.\/testing\/e2eHooks"\)/);
  });

  it("installed under its own code it drives t() and the direction, with English for missing keys", () => {
    installBundle("ar-XB", { "status.words": pseudoString("{n, plural, one {# word} other {# words}}") }, "rtl");
    applyLocale("ar-XB" as never);
    expect(document.documentElement.dir).toBe("rtl");
    expect(isRTL()).toBe(true);
    expect(t("status.words", { n: 3 })).toMatch(/^⟦3 ŵöŕðš .*⟧$/);
    expect(t("toolbar.ltr")).not.toContain("⟦");
    applyLocale("en");
    expect(document.documentElement.dir).toBe("ltr");
  });
});
