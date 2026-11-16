/**
 * Israeli import scorecard (lane T8), paste: 3 clipboards from Word and 3
 * from Google Docs (fixtures/israeli-import/paste, written by us in the shape
 * each app puts on the clipboard), each with the Markdown a person expects.
 * Hebrew/RTL, nikud, mixed-direction lines, lists, tables and links must
 * survive: ./helpers/israeliImport.ts says what is checked. 6/6.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pastedHtmlToMarkdown } from "../paste/htmlPaste";
import { scoreLine, scoreNote } from "./helpers/israeliImport";

const DIR = join(__dirname, "fixtures/israeli-import/paste");
const cases = readdirSync(DIR)
  .filter((f) => f.endsWith(".html"))
  .sort()
  .map((f) => f.replace(/\.html$/, ""));

describe("Israeli import: paste from Word and Google Docs", () => {
  it("has 3 Word and 3 Google Docs clipboards", () => {
    expect(cases.filter((c) => c.startsWith("word-")).length).toBe(3);
    expect(cases.filter((c) => c.startsWith("gdocs-")).length).toBe(3);
  });

  const results = cases.map((c) => scoreNote(c, pastedHtmlToMarkdown(readFileSync(join(DIR, `${c}.html`), "utf8")), readFileSync(join(DIR, `${c}.md`), "utf8")));
  for (const r of results) it(`${r.name} keeps everything`, () => expect(r.problems).toEqual([]));

  it("score: 6/6", () => {
    console.log(`israeli-import paste ${scoreLine(results)}`);
    expect(results.filter((r) => r.pass).length).toBe(6);
  });
});
