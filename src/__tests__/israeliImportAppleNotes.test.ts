/**
 * Israeli import scorecard (lane T8), Apple Notes: 3 exports of our own
 * (fixtures/israeli-import/apple-notes) — two HTML exports (a recipe with
 * nikud and lists; a right-to-left table with an inline image) and a Notes
 * library (NoteStore.sqlite, built by scripts/fixtures/apple-notes-he-fixture.mjs:
 * numbered lists with sub-items, a checklist with nikud, emoji before styled
 * text, a link) — each with the vault a person expects.
 * ./helpers/israeliImport.ts says what is checked. 3/3.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { convertExport, detectImportSource } from "../storage/import/convert";
import { convertAppleNotesStore } from "../storage/import/appleNotes";
import { scoreLine, scoreVault, type Vault } from "./helpers/israeliImport";

const DIR = join(__dirname, "fixtures/israeli-import/apple-notes");

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

describe("Israeli import: Apple Notes exports", () => {
  it("has 3 exports", () => expect(cases.length).toBe(3));

  // As prepareImport does: the Notes database goes to its own reader, an HTML export to the page converter.
  const results = Promise.all(
    cases.map(async (c) => {
      const input = files(join(DIR, c, "export"));
      const detected = detectImportSource([...input.keys()]);
      const store = [...input.keys()].some((p) => /(^|\/)NoteStore\.sqlite$/i.test(p));
      const v = store ? await convertAppleNotesStore(input) : convertExport("appleNotes", input, `Imported/${c}`);
      const lumen: Vault = new Map<string, string | Uint8Array>([...v.notes, ...v.attachments]);
      const r = scoreVault(c, lumen, asVault(files(join(DIR, c, "expected"))));
      return detected === "appleNotes" ? r : { ...r, pass: false, problems: [`detected as ${detected}`, ...r.problems] };
    }),
  );
  for (const c of cases) it(`${c} keeps everything`, async () => expect((await results).find((r) => r.name === c)!.problems).toEqual([]));

  it("score: 3/3", async () => {
    const all = await results;
    console.log(`israeli-import apple-notes ${scoreLine(all)}`);
    expect(all.filter((r) => r.pass).length).toBe(3);
  });
});
