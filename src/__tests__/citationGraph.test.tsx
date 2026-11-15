/**
 * Plan W12.X3 — the citation graph: `cites` edges from `[@key]` in source
 * notes, from links between source notes and from `references:` of CSL-JSON
 * items; shown in the entity graph with a "citations only" filter and its
 * table; OpenAlex optional, off by default, in the privacy ledger.
 *
 * The 50-source library is SYNTHETIC, generated here: source i cites the
 * sources (7i mod 50)+1 and (13i mod 50)+1, by key for even i and by DOI for
 * odd i. The expected edge set is computed separately below from that rule.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildCitationGraph, citationRows, citedKeys, type CitingNote, type CslLibrary } from "../citations/citationGraph";
import { validateEdge } from "../entities/schema";
import { openAlexReferences } from "../citations/openAlex";
import { classify } from "../ai/privacyLedger";
import { entityId } from "../entities/model";
import { visibleGraph } from "../entities/view";
import { EntityGraphView } from "../ui/EntityGraphView";

const key = (i: number) => `s${String(i).padStart(2, "0")}`;
const doi = (i: number) => `10.5555/${key(i)}`;
const refsOf = (i: number) => [...new Set([((7 * i) % 50) + 1, ((13 * i) % 50) + 1])].filter((j) => j !== i);

const LIBRARY: CslLibrary = {
  path: ".lumen/zotero-library.csl.json",
  items: Array.from({ length: 50 }, (_, n) => {
    const i = n + 1;
    return { id: key(i), "citation-key": key(i), type: "article-journal", title: `מקור ${i}`, DOI: doi(i), references: refsOf(i).map((j) => (i % 2 === 0 ? key(j) : `https://doi.org/${doi(j).toUpperCase()}`)) };
  }),
};

const NOTES: CitingNote[] = [
  { path: "sources/s01.md", fm: { type: "source", citekey: "s01" }, body: "# s01\n\nכפי שכתוב [@s50; @s49, עמ' 3] ובמקום אחר. ^p1\n\nראו גם [[חיבור חדש]].\n\nמייל: a@s48.org לא ציטוט.\n" },
  { path: "sources/חיבור חדש.md", fm: { type: "source" }, body: "מצטט את @s02 ואת [@missing2020].\n" },
  { path: "notes/plain.md", fm: {}, body: "פתק רגיל מצטט [@s03], הוא לא מקור.\n" },
];

const id = (k: string) => entityId("source", k);

describe("cited keys (pandoc syntax)", () => {
  it("reads bracketed groups, prefixes and bare @key, not e-mail addresses", () => {
    expect(citedKeys("[@a; -@b, p. 3] and @c, mail x@d.org")).toEqual(["a", "b", "c"]);
  });
});

describe("the citation graph of a 50-source library", () => {
  const g = buildCitationGraph(NOTES, [LIBRARY], "2026-11-15T00:00:00Z");

  it("makes exactly the known references' edges, from keys and from DOIs", () => {
    const expected = new Set<string>();
    for (let i = 1; i <= 50; i++) for (const j of refsOf(i)) expected.add(`${key(i)}>${key(j)}`);
    const fromLibrary = g.edges.filter((e) => e.provenance.note === LIBRARY.path).map((e) => `${e.subject.slice("source:".length)}>${e.object.slice("source:".length)}`);
    expect(new Set(fromLibrary)).toEqual(expected);
    expect(fromLibrary).toHaveLength(expected.size);
    expect(g.entities.filter((e) => e.type === "source")).toHaveLength(51); // 50 items + the note without a key
  });

  it("adds the [@key] citations and the links of source notes, with provenance; a plain note does not cite", () => {
    const fromNotes = g.edges.filter((e) => e.provenance.note.startsWith("sources/"));
    const pairs = fromNotes.map((e) => `${e.subject}>${e.object}`).sort();
    expect(pairs).toEqual([`${id("s01")}>${id("s49")}`, `${id("s01")}>${id("s50")}`, `${id("s01")}>${id("חיבור חדש")}`, `${id("חיבור חדש")}>${id("s02")}`].sort());
    const e = fromNotes.find((x) => x.object === id("s50"))!;
    expect(e).toMatchObject({ predicate: "cites", status: "approved", confidence: 1 });
    expect(e.provenance).toMatchObject({ note: "sources/s01.md", anchor: "p1", quote: "@s50", extractor: "citations@1", model: null });
    expect(e.provenance.paragraphHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(g.edges.some((x) => x.object === id("s03") && x.provenance.note === "notes/plain.md")).toBe(false);
    expect(g.unresolved).toEqual([{ from: "sources/חיבור חדש.md", key: "missing2020", where: "note" }]);
  });

  it("every edge, from the library and from notes, passes the entity model's edge check, with a deterministic anchor", () => {
    expect(g.edges.length).toBeGreaterThan(50);
    for (const e of g.edges) expect({ id: e.id, check: validateEdge(e) }).toEqual({ id: e.id, check: { ok: true, problems: [] } });
    // A library entry: the property and the item's key.
    const lib = g.edges.find((e) => e.provenance.note === LIBRARY.path && e.subject === id("s02"))!;
    expect(lib.provenance.anchor).toBe("references-s02");
    // A paragraph without a ^id: p- and the start of its hash, the id the review queue would add.
    const link = g.edges.find((e) => e.object === id("חיבור חדש"))!;
    expect(link.provenance.anchor).toBe(`p-${link.provenance.paragraphHash.slice("sha256:".length, "sha256:".length + 12)}`);
    // The same vault gives the same anchors.
    const again = buildCitationGraph(NOTES, [LIBRARY], "2026-11-15T00:00:00Z");
    expect(again.edges.map((e) => `${e.id}#${e.provenance.anchor}`)).toEqual(g.edges.map((e) => `${e.id}#${e.provenance.anchor}`));
    // A key with characters outside the rule, and one with none of them.
    const odd = buildCitationGraph([], [{ path: "lib.json", items: [{ id: "doe_2020:a", type: "book", references: ["שלום"] }, { id: "שלום", type: "book", references: ["doe_2020:a"] }] }], "2026-11-15T00:00:00Z");
    expect(odd.edges.map((e) => e.provenance.anchor)).toEqual(["references-doe-2020-a", "references-item2"]);
    for (const e of odd.edges) expect(validateEdge(e).ok).toBe(true);
  });

  it("the table lists who cites whom", () => {
    const rows = citationRows(g);
    expect(rows).toHaveLength(g.edges.length);
    expect(rows).toContainEqual({ citing: "מקור 1", cited: "מקור 50", where: "sources/s01.md", quote: "@s50" });
  });

  it("the entity graph's 'citations only' filter keeps exactly the cites edges", () => {
    const other = { id: "x", subject: id("s01"), predicate: "main_subject", object: id("s02"), confidence: 1, status: "approved" as const, provenance: g.edges[0].provenance };
    const v = visibleGraph(g.entities, [...g.edges, other], new Map(), { predicates: new Set(["cites"]), types: new Set(["source", "law"]) });
    expect(v.edges).toHaveLength(g.edges.length);
  });

  it("the view's 'Citations only' button narrows the table to the cites edges", () => {
    const other = { id: "x", subject: id("s01"), predicate: "main_subject", object: id("s02"), confidence: 1, status: "approved" as const, provenance: g.edges[0].provenance };
    render(<EntityGraphView entities={g.entities} edges={[...g.edges, other]} notes={new Map()} onOpenEntity={() => undefined} initialMode="table" />);
    // A library this big opens as an ego graph (R12.8, #886); the whole graph is one click away.
    const ego = screen.queryByTestId("entity-graph-ego");
    if (ego) fireEvent.click(within(ego).getByRole("button"));
    const stats = screen.getByTestId("entity-graph-stats");
    const before = stats.textContent;
    const button = screen.getByRole("button", { name: /citations only|ציטוטים בלבד|entityGraph.view.citationsOnly/i });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(stats.textContent).not.toBe(before);
    expect(stats.textContent).toContain(String(g.edges.length));
  });
});

describe("OpenAlex (optional, off by default)", () => {
  it("makes 0 requests without consent", async () => {
    let calls = 0;
    const counting = (async () => {
      calls++;
      throw new Error("no request may be made");
    }) as unknown as typeof fetch;
    for (let i = 1; i <= 50; i++) expect(await openAlexReferences(doi(i), { consent: false, fetch: counting })).toEqual([]);
    expect(calls).toBe(0);
  });

  it("is in the privacy ledger as a research call", () => {
    expect(classify("https://api.openalex.org/works/doi:10.5555/s01?select=referenced_works")).toMatchObject({ host: "api.openalex.org", category: "research" });
  });

  it("with consent: the cited works' DOIs (response shape of the OpenAlex API, synthetic values)", async () => {
    const seen: string[] = [];
    const fake = (async (url: string) => {
      seen.push(url);
      const body = url.includes("/works/doi:") ? { referenced_works: ["https://openalex.org/W1", "https://openalex.org/W2"] } : { results: [{ id: "https://openalex.org/W1", doi: "https://doi.org/10.5555/S02" }, { id: "https://openalex.org/W2", doi: null }] };
      return { ok: true, json: async () => body } as Response;
    }) as unknown as typeof fetch;
    expect(await openAlexReferences("10.5555/s01", { consent: true, fetch: fake })).toEqual(["10.5555/s02"]);
    expect(seen).toEqual(["https://api.openalex.org/works/doi:10.5555%2Fs01?select=referenced_works", "https://api.openalex.org/works?filter=openalex:W1|W2&select=id,doi&per-page=50"]);
  });
});
