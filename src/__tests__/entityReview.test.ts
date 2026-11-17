/**
 * W12.E5–E7 (logic) — the review queue (20 proposals, approve, reject,
 * merge, split, undo: the vault byte-identical after undo), entity pages
 * (relations grouped, mentions in context, every edge link reaches a
 * paragraph; a 300-mention page under 300 ms), Bases per type, and the
 * graph view's filters, time window and neighbourhood, which the table
 * shares with the drawing. Synthetic vault.
 */
import { describe, expect, it } from "vitest";
import { edgeId, entityId, type Edge, type EntityType } from "../entities/model";
import { makeProvenance } from "../entities/provenance";
import { paragraphByAnchor, splitParagraphs } from "../entities/paragraphs";
import { DECISIONS_PATH, EDGES_PATH, PROPOSALS_PATH, mergeProposals, toJsonl, type Proposal } from "../entities/store";
import { approve, edgesOf, entitiesOf, merge, proposalsOf, reject, relink, split, undoOp, type Files } from "../entities/review";
import { entityBase, entityPage, edgeLinkExists } from "../entities/pages";
import { neighbours, timeDomain, toRenderEdges, visibleGraph, type NoteInfo } from "../entities/view";
import { splitFrontmatter } from "../entities/frontmatter";

const NOTE = "יומן/2026-11-15.md";
const NOTE_TEXT = [
  "---",
  "date: 2026-11-15",
  "tags: [יומן]",
  "---",
  "דוד כהן נולד בחיפה. ^a1",
  "",
  "רחל לוי חברה בוועד השכונה, וגם [[דוד כהן]] חבר בו.",
  "",
  "ד. כהן ביקר בירושלים.",
].join("\n");

const entP = (type: EntityType, name: string, extra: Partial<Proposal> = {}): Proposal =>
  ({ kind: "entity", id: `p:${entityId(type, name)}`, type, name, aliases: [], mentions: [{ note: NOTE, anchor: null, paragraphHash: "sha256:" + "0".repeat(64), start: 0, end: 1, text: name }], extractor: "lumen-rules@1", model: null, confidence: 1, ...extra }) as Proposal;

function edgeP(s: string, p: string, o: string, para: string, quote: string, anchor: string): Proposal {
  const e: Edge = { id: edgeId(s, p, o, NOTE, anchor), subject: s, predicate: p, object: o, provenance: makeProvenance({ note: NOTE, anchor, paragraph: para, quote, extractor: "lumen-relations@1", model: "ollama:test", date: new Date("2026-11-15T08:00:00Z") }), confidence: 0.8, status: "proposed" };
  return { kind: "edge", id: e.id, edge: e };
}

const david = entityId("person", "דוד כהן");
const dk = entityId("person", "ד. כהן");
const rachel = entityId("person", "רחל לוי");
const haifa = entityId("place", "חיפה");
const committee = entityId("organization", "ועד השכונה");
const p2 = splitParagraphs(NOTE_TEXT)[1].text;

function initial(): Map<string, string> {
  const props: Proposal[] = [
    entP("person", "דוד כהן"),
    entP("person", "ד. כהן"),
    entP("person", "רחל לוי"),
    entP("place", "חיפה"),
    entP("organization", "ועד השכונה"),
    ...Array.from({ length: 12 }, (_, i) => entP("concept", `מושג ${i + 1}`)),
    edgeP(david, "born_in", haifa, "דוד כהן נולד בחיפה.", "דוד כהן נולד בחיפה", "a1"),
    edgeP(rachel, "member_of", committee, p2, "רחל לוי חברה בוועד השכונה", "b2"),
    edgeP(david, "member_of", committee, p2, "דוד כהן]] חבר בו", "b2"),
  ];
  const q = mergeProposals([], props, []);
  expect(q.proposals).toHaveLength(20);
  return new Map([
    [NOTE, NOTE_TEXT],
    ["אחר.md", "פגשתי את [[ד. כהן]] ואת [[ד. כהן|דודו]] אתמול."],
    [PROPOSALS_PATH, toJsonl(q.proposals)],
  ]);
}

const snapshot = (f: Files) => JSON.stringify([...f].sort(([a], [b]) => a.localeCompare(b)));

describe("W12.E5 review: 20 proposals, approve, reject, merge, split, undo", () => {
  it("each step undoes to the exact bytes, and the chain undoes to the start", () => {
    const v0 = initial();
    const all = proposalsOf(v0).map((p) => p.id);
    const toReject = [`p:${entityId("concept", "מושג 1")}`, `p:${entityId("concept", "מושג 2")}`];
    // Approve everything else (entities and the three edges).
    const a = approve(v0, all.filter((id) => !toReject.includes(id)));
    expect(entitiesOf(a.files)).toHaveLength(15);
    expect(edgesOf(a.files).map((e) => e.status)).toEqual(["approved", "approved", "approved"]);
    // The anchor b2 was missing; approval added it to its paragraph.
    expect(paragraphByAnchor(a.files.get(NOTE)!, "b2")!.text).toBe(p2);
    expect(splitFrontmatter(a.files.get("ישויות/אנשים/דוד כהן.md")!).props).toMatchObject({ born_in: ["[[חיפה]]"], member_of: ["[[ועד השכונה]]"] });
    const b = reject(a.files, proposalsOf(a.files).map((p) => p.id));
    expect(proposalsOf(b.files)).toHaveLength(0);
    expect(b.files.get(DECISIONS_PATH)!.trim().split("\n")).toHaveLength(toReject.length);
    // A rejected proposal is not proposed again.
    const again = mergeProposals([], proposalsOf(v0).filter((p) => toReject.includes(p.id)), b.files.get(DECISIONS_PATH)!.trim().split("\n").map((l) => JSON.parse(l)));
    expect(again.suppressed).toBe(toReject.length);
    // Merge ד. כהן into דוד כהן: aliases unite, links relinked, note gone.
    const c = merge(b.files, david, dk);
    expect(c.files.has("ישויות/אנשים/ד. כהן.md")).toBe(false);
    expect(splitFrontmatter(c.files.get("ישויות/אנשים/דוד כהן.md")!).props.aliases).toEqual(["ד. כהן"]);
    expect(c.files.get("אחר.md")).toBe("פגשתי את [[דוד כהן|ד. כהן]] ואת [[דוד כהן|דודו]] אתמול.");
    // Split: the committee membership and the alias move to a new person.
    const memberEdge = edgesOf(c.files).find((e) => e.subject === david && e.predicate === "member_of")!;
    const d = split(c.files, david, "דוד כהן (השכן)", { aliases: ["ד. כהן"], edges: [memberEdge.id] });
    const fresh = entityId("person", "דוד כהן (השכן)");
    expect(edgesOf(d.files).find((e) => e.predicate === "member_of" && e.subject === fresh)).toBeTruthy();
    expect(splitFrontmatter(d.files.get("ישויות/אנשים/דוד כהן.md")!).props).toEqual({ type: "person", "entity-type": "person", born_in: ["[[חיפה]]"] });
    // Undo each step in one step: bytes as before.
    for (const [before, op] of [[c.files, d], [b.files, c], [a.files, b], [v0, a]] as const) {
      const back = undoOp(op.files, op.undo);
      expect(snapshot(back.files)).toBe(snapshot(before));
    }
    // And the whole chain: the vault is byte-identical to the start.
    let f: Files = d.files;
    for (const op of [d, c, b, a]) f = undoOp(f, op.undo).files;
    expect(snapshot(f)).toBe(snapshot(v0));
  });
  it("an edge whose end is not approved waits in the queue", () => {
    const v0 = initial();
    const edge = proposalsOf(v0).find((p) => p.kind === "edge")!;
    const r = approve(v0, [edge.id]);
    expect(proposalsOf(r.files).some((p) => p.id === edge.id)).toBe(true);
    expect(r.files.has(EDGES_PATH)).toBe(false);
  });
  it("a proposal that matched a known entity adds its spelling as an alias", () => {
    const v0 = initial();
    const a = approve(v0, [`p:${david}`]);
    const m = entP("person", "דוד", { matches: david, id: "p:m", mentions: [{ note: NOTE, anchor: null, paragraphHash: "sha256:" + "0".repeat(64), start: 0, end: 4, text: "לדוד" }] } as Partial<Proposal>);
    const files = new Map(a.files);
    files.set(PROPOSALS_PATH, toJsonl([m]));
    const b = approve(files, ["p:m"]);
    expect(splitFrontmatter(b.files.get("ישויות/אנשים/דוד כהן.md")!).props.aliases).toEqual(["לדוד"]);
    expect([...b.files.keys()].filter((p) => p.startsWith("ישויות/"))).toEqual(["ישויות/אנשים/דוד כהן.md"]);
  });
  it("relink keeps headings, embeds and shown text", () => {
    expect(relink("![[א#ב]] [[א|ג]] [[אב]]", "א", "ד")).toBe("![[ד#ב|א]] [[ד|ג]] [[אב]]");
  });
});

describe("W12.E6 entity pages and Bases", () => {
  const v = approve(initial(), proposalsOf(initial()).map((p) => p.id)).files;
  it("relations grouped by predicate, both directions; every edge link reaches a paragraph", () => {
    const ents = entitiesOf(v);
    const page = entityPage(ents.find((e) => e.id === david)!, edgesOf(v), v);
    expect(page.outgoing.map((g) => g.predicate)).toEqual(["born_in", "member_of"]);
    const cpage = entityPage(ents.find((e) => e.id === committee)!, edgesOf(v), v);
    expect(cpage.incoming[0].edges.map((e) => e.other).sort()).toEqual([david, rachel].sort());
    for (const g of [...page.outgoing, ...cpage.incoming]) for (const e of g.edges) {
      expect(e.source).toBe("ok");
      expect(edgeLinkExists(e.edge, v)).toBe(true);
      expect(e.link).toMatch(/^\[\[יומן\/2026-11-15#\^(a1|b2)\]\]$/);
    }
    expect(page.mentions.map((m) => v.get(m.note)!.length > 0 && m.paragraph.slice(m.start, m.end))).toEqual(["דוד כהן", "[[דוד כהן]]"]);
  });
  it("a page with 300 mentions builds in under 300 ms", () => {
    const notes = new Map(v);
    for (let i = 0; i < 300; i++) notes.set(`n/${i}.md`, `פסקה ${i}: נפגשנו עם דוד כהן בבוקר.\n\nפסקה אחרת בלי שם ${i}.`);
    const ents = entitiesOf(notes);
    const t0 = performance.now();
    const page = entityPage(ents.find((e) => e.id === david)!, edgesOf(notes), notes);
    const ms = performance.now() - t0;
    expect(page.mentions.length).toBeGreaterThanOrEqual(300);
    expect(ms).toBeLessThan(300);
  });
  it("a Hebrew prefix still counts as a mention", () => {
    const n = new Map([["a.md", "הלכתי לדוד כהן ולחיפה."]]);
    const page = entityPage({ id: david, type: "person", name: "דוד כהן", aliases: [] }, [], n);
    expect(page.mentions.map((m) => m.paragraph.slice(m.start, m.end))).toEqual(["לדוד כהן"]);
  });
  it("one Bases file per type, filtered to its folder", () => {
    const b = entityBase("person");
    expect(b.path).toBe("ישויות/אנשים.base");
    expect(b.content).toContain('file.inFolder("ישויות/אנשים")');
    expect(b.content).toContain("note.born_in");
    expect(entityBase("law").content).not.toContain("note.born_in");
  });
});

describe("W12.E7 view model: filters, time, neighbourhood, one source for graph and table", () => {
  const v = approve(initial(), proposalsOf(initial()).map((p) => p.id)).files;
  const ents = entitiesOf(v);
  const edges = edgesOf(v).map((e, i) => (i === 0 ? { ...e, when: "1950-01-01" } : e));
  const notes = new Map<string, NoteInfo>([[NOTE, { tags: ["יומן"], date: "2026-11-15" }]]);
  it("a predicate filter and a time window narrow the same edges for graph and table", () => {
    const g = visibleGraph(ents, edges, notes, { predicates: new Set(["member_of"]) });
    expect(g.edges.map((e) => e.predicate)).toEqual(["member_of", "member_of"]);
    expect(g.nodes.map((n) => n.id).sort()).toEqual([committee, david, rachel].sort());
    const r = toRenderEdges(g);
    expect(r.pairs.length).toBe(g.edges.length * 2);
    expect(timeDomain(edges, notes)).toEqual(["1950-01-01", "2026-11-15"]);
    const t = visibleGraph(ents, edges, notes, { to: "2000-01-01" });
    expect(t.edges.map((e) => e.predicate)).toEqual(["born_in"]);
    expect(visibleGraph(ents, edges, notes, { tag: "אחר" }).edges).toHaveLength(0);
    expect(visibleGraph(ents, edges, notes, { minConfidence: 0.9 }).edges).toHaveLength(0);
  });
  it("neighbourhood depth 1 and 2 around Haifa", () => {
    const d1 = visibleGraph(ents, edges, notes, { center: haifa, depth: 1 });
    expect(d1.nodes.map((n) => n.id).sort()).toEqual([david, haifa].sort());
    const d2 = visibleGraph(ents, edges, notes, { center: haifa, depth: 2 });
    expect(d2.nodes.map((n) => n.id).sort()).toEqual([committee, david, haifa].sort());
    expect(neighbours(d2, david).sort()).toEqual([committee, haifa].sort());
  });
  it("5,000 entities and 20,000 edges filter in well under a frame budget per change", () => {
    const types: EntityType[] = ["person", "place", "organization", "event", "law", "source", "concept"];
    const bigE = Array.from({ length: 5000 }, (_, i) => ({ id: entityId(types[i % 7], `e${i}`), type: types[i % 7], name: `e${i}`, aliases: [] }));
    const prov = edges[0].provenance;
    const bigEdges: Edge[] = Array.from({ length: 20000 }, (_, k) => ({ id: `x${k}`, subject: bigE[k % 5000].id, predicate: k % 2 ? "related_to" : "part_of", object: bigE[(k * 7 + 1) % 5000].id, provenance: prov, confidence: (k % 10) / 10, status: "approved", when: `20${String(10 + (k % 16)).padStart(2, "0")}-01-01` }));
    const t0 = performance.now();
    const g = visibleGraph(bigE, bigEdges, notes, { predicates: new Set(["part_of"]), from: "2015-01-01" });
    const ms = performance.now() - t0;
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.edges.every((e) => e.predicate === "part_of" && e.when! >= "2015-01-01")).toBe(true);
    expect(ms).toBeLessThan(200);
  });
});
