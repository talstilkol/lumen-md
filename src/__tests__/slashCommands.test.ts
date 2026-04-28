/**
 * Tests for the source-mode slash-command registry. Covers the structural
 * contract (every entry has the required fields, no-empty templates) and
 * the `filterSlashCommands` query helper used by the dropdown.
 */

import { describe, it, expect } from "vitest";
import { SLASH_COMMANDS, filterSlashCommands } from "../editor/slashCommands";

describe("SLASH_COMMANDS registry", () => {
  it("exports a non-empty list", () => {
    expect(SLASH_COMMANDS.length).toBeGreaterThan(0);
  });

  it("every entry has id / label / description / template", () => {
    for (const c of SLASH_COMMANDS) {
      expect(typeof c.id).toBe("string");
      expect(c.id.length).toBeGreaterThan(0);
      expect(typeof c.label).toBe("string");
      expect(c.label.startsWith("/")).toBe(true);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.template.length).toBeGreaterThan(0);
    }
  });

  it("ids are unique across the registry", () => {
    const ids = SLASH_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("filterSlashCommands", () => {
  it("returns the full list for an empty query", () => {
    expect(filterSlashCommands("")).toEqual(SLASH_COMMANDS);
  });

  it("matches by id substring", () => {
    const out = filterSlashCommands("tab");
    expect(out.some((c) => c.id === "table")).toBe(true);
  });

  it("matches by label substring", () => {
    const out = filterSlashCommands("/code");
    expect(out.some((c) => c.id === "code")).toBe(true);
  });

  it("matches by description substring (case-insensitive)", () => {
    const out = filterSlashCommands("BLOCKQUOTE");
    expect(out.some((c) => c.id === "quote")).toBe(true);
  });

  it("returns an empty list for a query with no matches", () => {
    expect(filterSlashCommands("zzznonsense")).toEqual([]);
  });
});
