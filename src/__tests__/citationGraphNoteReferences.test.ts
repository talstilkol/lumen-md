/**
 * Plan W12.X3 — the citation graph reads `references:` of source notes too,
 * so references filled from OpenAlex become `cites` edges, with provenance
 * (the note, the property as the anchor, the entry word for word), and a
 * pair a CSL library already gave is not drawn twice.
 *
 * The fill runs through its real path: fillReferencesFromOpenAlex (the
 * gated lookup, switch on, consent answered yes), the property review
 * queue's approve(), then the note as written. Requests stop at a stand-in
 * for the network (the fetch passed to the lookup). The library, notes,
 * DOIs and OpenAlex's answer are SYNTHETIC (10.5555 is the DOI test prefix).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildCitationGraph, REFERENCES_ANCHOR, type CitingNote, type CslLibrary } from "../citations/citationGraph";
import { fillReferencesFromOpenAlex } from "../citations/fillReferences";
import { setOpenAlexEnabled } from "../citations/openAlexLookup";
import { AutofillQueue } from "../properties/autofill";
import { splitFrontmatter } from "../entities/frontmatter";
import { entityId } from "../entities/model";
import { validateEdge } from "../entities/schema";

const key = (i: number) => `s${String(i).padStart(2, "0")}`;
const doi = (i: number) => `10.5555/${key(i)}`;
const id = (k: string) => entityId("source", k);

// The library: s01..s05; s01 already cites s02 in CSL.
const LIBRARY: CslLibrary = {
  path: ".lumen/zotero-library.csl.json",
  items: Array.from({ length: 5 }, (_, n) => ({ id: key(n + 1), "citation-key": key(n + 1), type: "article-journal", title: `Source ${n + 1}`, DOI: doi(n + 1), ...(n === 0 ? { references: [key(2)] } : {}) })),
};

// s01's own source note (same cite key as the library item), before the fill.
const A_PATH = "Sources/s01.md";
const A = `---\ntype: source\ncitekey: s01\ndoi: "${doi(1)}"\n---\n\n# Source 1\n\nNotes.\n`;
// A note matched to library item s04 by its DOI only, citing s05 by key in references:.
const B_PATH = "Sources/Fourth.md";
const B = `---\ntype: source\nurl: https://doi.org/${doi(4).toUpperCase()}\nreferences:\n  - s05\n---\n\n# Fourth\n`;

/** OpenAlex for s01: it cites s02 (also in the CSL), s03, and a work not in the vault. */
const openAlex = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const body = url.includes("/works/doi:")
    ? { referenced_works: ["https://openalex.org/W2", "https://openalex.org/W3", "https://openalex.org/W9"] }
    : { results: [{ doi: `https://doi.org/${doi(2)}` }, { doi: `https://doi.org/${doi(3)}` }, { doi: "https://doi.org/10.5555/elsewhere.9" }] };
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

const note = (path: string, text: string): CitingNote => {
  const { props, body } = splitFrontmatter(text);
  return { path, fm: props, body };
};

let files: Map<string, string>;
let queue: AutofillQueue;

beforeEach(() => {
  localStorage.clear();
  setOpenAlexEnabled(true);
  files = new Map([
    [A_PATH, A],
    [B_PATH, B],
  ]);
  queue = new AutofillQueue({ read: async (p) => files.get(p)!, write: async (p, t) => void files.set(p, t) });
});

async function fill(): Promise<void> {
  const r = await fillReferencesFromOpenAlex({ path: A_PATH, text: files.get(A_PATH)! }, queue, { ask: async () => true, fetch: openAlex });
  expect(r).toMatchObject({ status: "queued", added: 3 });
}

const graph = () => buildCitationGraph([note(A_PATH, files.get(A_PATH)!), note(B_PATH, files.get(B_PATH)!)], [LIBRARY], "2026-11-15T00:00:00Z");
const pairs = (g: ReturnType<typeof graph>) => g.edges.map((e) => `${e.subject}>${e.object}`).sort();

describe("references: of source notes in the citation graph", () => {
  it("before the fill: only the CSL edge and the hand-written note reference", () => {
    expect(pairs(graph())).toEqual([`${id("s01")}>${id("s02")}`, `${id("s04")}>${id("s05")}`]);
  });

  it("approved filled references become cites edges with the note and the property as provenance; the CSL pair is not duplicated", async () => {
    await fill();
    expect(await queue.approve(queue.list()[0].id)).toBe("written");
    expect(splitFrontmatter(files.get(A_PATH)!).props.references).toEqual([doi(2), doi(3), "10.5555/elsewhere.9"]);

    const g = graph();
    expect(pairs(g)).toEqual([`${id("s01")}>${id("s02")}`, `${id("s01")}>${id("s03")}`, `${id("s04")}>${id("s05")}`]);
    // s01 -> s02 came from the library first and stays that one edge.
    const fromCsl = g.edges.filter((e) => e.subject === id("s01") && e.object === id("s02"));
    expect(fromCsl).toHaveLength(1);
    expect(fromCsl[0].provenance).toMatchObject({ note: LIBRARY.path, anchor: "references-s01", quote: "s02" });

    const filled = g.edges.find((e) => e.object === id("s03"))!;
    expect(filled.provenance).toMatchObject({ note: A_PATH, anchor: REFERENCES_ANCHOR, quote: doi(3), extractor: "citations@1", model: null });
    expect(filled).toMatchObject({ predicate: "cites", status: "approved", confidence: 1 });
    // A note matched to a library item by DOI alone is that item's entity.
    expect(g.edges.find((e) => e.object === id("s05"))!.provenance).toMatchObject({ note: B_PATH, anchor: REFERENCES_ANCHOR, quote: "s05" });
    // Every edge, the library's and the notes', passes the entity model's edge check.
    for (const e of g.edges) expect({ id: e.id, check: validateEdge(e) }).toEqual({ id: e.id, check: { ok: true, problems: [] } });

    // A work that is not in the vault draws no edge; it is listed.
    expect(g.unresolved).toContainEqual({ from: A_PATH, key: "10.5555/elsewhere.9", where: "references" });
    // One entity per source: the notes merged into their library items.
    expect(g.entities.filter((e) => e.type === "source").map((e) => e.id).sort()).toEqual([1, 2, 3, 4, 5].map((i) => id(key(i))));
  });

  it("a rejected fill draws no edge", async () => {
    await fill();
    queue.reject(queue.list()[0].id);
    expect(files.get(A_PATH)).toBe(A);
    expect(pairs(graph())).toEqual([`${id("s01")}>${id("s02")}`, `${id("s04")}>${id("s05")}`]);
  });
});
