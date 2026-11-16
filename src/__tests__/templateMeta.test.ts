/** The palette's template list (editor/templateMeta.ts) is the gallery's (editor/templates.ts), loaded on use. */
import { describe, expect, it } from "vitest";
import { TEMPLATE_META } from "../editor/templateMeta";
import { TEMPLATES } from "../editor/templates";

describe("template list at startup", () => {
  it("names every built-in template, in order, with its category", () => {
    expect(TEMPLATE_META.map((m) => ({ ...m }))).toEqual(TEMPLATES.map(({ id, name, category }) => ({ id, name, category })));
  });
});
