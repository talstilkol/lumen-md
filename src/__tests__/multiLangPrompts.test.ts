/**
 * Tests for the multi-language AI prompt template registry. Verifies the
 * exported templates are well-formed and that the lookup / template-apply
 * helpers behave as documented.
 */

import { describe, it, expect } from "vitest";
import {
  AI_PROMPT_TEMPLATES,
  applyTemplate,
  getTemplatesByCategory,
  getTemplatesByLang,
} from "../ai/multiLangPrompts";

describe("AI_PROMPT_TEMPLATES registry", () => {
  it("exports a non-empty list", () => {
    expect(AI_PROMPT_TEMPLATES.length).toBeGreaterThan(0);
  });

  it("every template carries the required fields", () => {
    for (const t of AI_PROMPT_TEMPLATES) {
      expect(typeof t.id).toBe("string");
      expect(t.id.length).toBeGreaterThan(0);
      expect(typeof t.label).toBe("string");
      expect(typeof t.lang).toBe("string");
      expect(typeof t.prompt).toBe("string");
      expect(["writing", "editing", "translation", "analysis", "code"]).toContain(
        t.category,
      );
    }
  });

  it("template ids are unique", () => {
    const ids = AI_PROMPT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every prompt contains a {content} placeholder", () => {
    for (const t of AI_PROMPT_TEMPLATES) {
      expect(t.prompt).toContain("{content}");
    }
  });

  it("covers Hebrew, Arabic, Russian, and English", () => {
    const langs = new Set(AI_PROMPT_TEMPLATES.map((t) => t.lang));
    for (const l of ["he", "ar", "ru", "en"]) expect(langs.has(l)).toBe(true);
  });
});

describe("getTemplatesByLang", () => {
  it("returns only templates in the requested language", () => {
    const he = getTemplatesByLang("he");
    expect(he.length).toBeGreaterThan(0);
    for (const t of he) expect(t.lang).toBe("he");
  });

  it("returns an empty list for an unknown language", () => {
    expect(getTemplatesByLang("xx")).toEqual([]);
  });
});

describe("getTemplatesByCategory", () => {
  it("returns only templates in the requested category", () => {
    const tx = getTemplatesByCategory("translation");
    expect(tx.length).toBeGreaterThan(0);
    for (const t of tx) expect(t.category).toBe("translation");
  });
});

describe("applyTemplate", () => {
  it("replaces the {content} placeholder with the supplied text", () => {
    const t = AI_PROMPT_TEMPLATES.find((p) => p.id === "en.summarize")!;
    const out = applyTemplate(t, "hello world");
    expect(out).toContain("hello world");
    expect(out).not.toContain("{content}");
  });

  it("only replaces the first occurrence (regression guard)", () => {
    const fake = {
      id: "x",
      label: "x",
      lang: "en",
      category: "writing" as const,
      prompt: "first {content} second {content}",
    };
    const out = applyTemplate(fake, "X");
    // String.prototype.replace with a string pattern matches only once
    expect(out).toBe("first X second {content}");
  });
});
