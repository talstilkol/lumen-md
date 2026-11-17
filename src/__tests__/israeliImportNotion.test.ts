/**
 * Israeli import scorecard (lane T8), Notion: 3 exports of our own
 * (fixtures/israeli-import/notion) in a Hebrew workspace — Markdown & CSV
 * pages with a sub-page, an image, a table and to-dos; a database with Hebrew
 * columns and Hebrew dates; and the HTML export — each with the vault a person
 * expects. ./helpers/israeliImport.ts says what is checked. 3/3.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { convertExport, detectImportSource } from "../storage/import/convert";
import { scoreLine, scoreVault, type Vault } from "./helpers/israeliImport";

const DIR = join(__dirname, "fixtures/israeli-import/notion");

function files(root: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(root, p).split("\\").join("/").normalize("NFC"), new Uint8Array(readFileSync(p)));
    }
  };
  walk(root);
  return out;
}
const asVault = (m: Map<string, Uint8Array>): Vault => new Map([...m].map(([p, b]) => [p, /\.md$/.test(p) ? new TextDecoder().decode(b) : b]));
const cases = readdirSync(DIR).filter((f) => statSync(join(DIR, f)).isDirectory()).sort();

describe("Israeli import: Notion exports", () => {
  it("has 3 exports", () => expect(cases.length).toBe(3));

  const results = cases.map((c) => {
    const input = files(join(DIR, c, "export"));
    const source = detectImportSource([...input.keys()]);
    const v = convertExport(source, input, `Imported/${c}`);
    const lumen: Vault = new Map<string, string | Uint8Array>([...v.notes, ...v.attachments]);
    const r = scoreVault(c, lumen, asVault(files(join(DIR, c, "expected"))));
    return source === "notion" ? r : { ...r, pass: false, problems: [`detected as ${source}`, ...r.problems] };
  });
  for (const r of results) it(`${r.name} keeps everything`, () => expect(r.problems).toEqual([]));

  it("score: 3/3", () => {
    console.log(`israeli-import notion ${scoreLine(results)}`);
    expect(results.filter((r) => r.pass).length).toBe(3);
  });
});
