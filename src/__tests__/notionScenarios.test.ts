/**
 * Twenty Notion exports after import (plan W8.2): databases with formulas,
 * relations and rollups, in Notion's two export formats ("Markdown & CSV" and
 * "HTML"). Each scenario says what "works" means; the table this prints is
 * docs/src/content/docs/getting-started/from-notion.md's. Acceptance: at
 * least 18 of 20 work, and none fails silently: a scenario that does not
 * work must leave a warning in the import report.
 */
import { describe, it, expect } from "vitest";
import { convertNotion } from "../storage/import/notion";
import { SC } from "./fixtures/notionScenarios";

describe("20 Notion scenarios after import (plan W8.2)", () => {
  it("at least 18 work, and none fails silently", () => {
    const table: string[] = ["| scenario | works when | result |", "| --- | --- | --- |"];
    let ok = 0;
    const silent: string[] = [];
    for (const s of SC) {
      const v = convertNotion(s.files, { folder: "Imported/Notion" });
      let result = "✓";
      try {
        s.check(v);
        ok++;
      } catch (e) {
        result = `✗ ${(e as Error).message.split("\n")[0]}`;
        // Not silent: a scenario that does not work left something in the report.
        if (v.warnings.length + v.skipped.length === 0) silent.push(s.name);
      }
      table.push(`| ${s.name} | ${s.works} | ${result} |`);
    }
    console.log(table.join("\n"));
    expect(silent).toEqual([]);
    expect(SC).toHaveLength(20);
    expect(ok).toBeGreaterThanOrEqual(18);
  });
});
