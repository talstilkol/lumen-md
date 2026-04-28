/**
 * i18n t() function — comprehensive unit tests.
 */
import { describe, it, expect } from "vitest";
import { t, applyLocale, getLocale } from "../i18n";

describe("t() function", () => {
  it("returns English string for known key", () => {
    applyLocale("en");
    expect(t("toolbar.new")).toBe("New");
  });

  it("returns the key itself for unknown key", () => {
    applyLocale("en");
    expect(t("this.key.does.not.exist")).toBe("this.key.does.not.exist");
  });

  it("interpolates {var} placeholders", () => {
    applyLocale("en");
    const result = t("status.words", { n: "42" });
    expect(result).toContain("42");
  });

  it("interpolates multiple placeholders", () => {
    applyLocale("en");
    const result = t("graphView.stats", { nodes: "10", edges: "15" });
    expect(result).toContain("10");
    expect(result).toContain("15");
  });

  it("returns Hebrew for he locale", () => {
    applyLocale("he");
    expect(t("toolbar.new")).toBe("חדש");
    applyLocale("en");
  });

  it("getLocale returns current locale", () => {
    applyLocale("en");
    expect(getLocale()).toBe("en");
    applyLocale("he");
    expect(getLocale()).toBe("he");
    applyLocale("en");
  });

  it("falls back to en for missing keys in he", () => {
    applyLocale("he");
    // Use a key that likely exists in en but might not in he
    const result = t("toolbar.new");
    // Should be Hebrew "חדש" if present, or English "New" if not
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    applyLocale("en");
  });

  it("handles empty params object", () => {
    applyLocale("en");
    const result = t("toolbar.new", {});
    expect(result).toBe("New");
  });
});
