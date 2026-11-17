/**
 * W12.E1 — the entity graph's data model: an edge without provenance is
 * rejected, a changed paragraph marks its edges "source changed", and an
 * approved entity is a plain note Obsidian reads (YAML front matter with
 * `aliases`). All fixtures are synthetic.
 */
import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { ENTITY_TYPES, PREDICATES, TYPE_INFO, edgeId, entityId, entityNotePath, type Edge } from "../entities/model";
import { EDGE_SCHEMA, assertEdge, validateEdge } from "../entities/schema";
import { sha256Hex } from "../entities/sha256";
import { ensureAnchor, paragraphByAnchor, paragraphHash, splitParagraphs } from "../entities/paragraphs";
import { edgeSourceState, makeProvenance, markSourceChanges, quoteInParagraph } from "../entities/provenance";
import { appendEdge, mergeProposals, parseJsonl, proposalKey, readEdges, toJsonl, PROPOSALS_PATH, type Proposal } from "../entities/store";
import { entityNote, parseEntityNote, relationProps } from "../entities/notes";
import { splitFrontmatter } from "../entities/frontmatter";

const NOTE = "יומן/פגישה.md";
const CONTENT = [
  "---",
  "tags: [יומן]",
  "---",
  "# פגישה",
  "",
  "דוד כהן נולד בחיפה בשנת 1950. ^a1b2c3",
  "",
  "- רחל לוי חברה בוועד המקומי",
  "- פריט שני",
  "",
  "```",
  "קוד: דוד כהן נולד בחיפה",
  "```",
  "",
  "פסקה בלי עוגן.",
].join("\n");

const person = entityId("person", "דוד כהן");
const city = entityId("place", "חיפה");

function edge(over: Partial<Edge> = {}): Edge {
  const para = paragraphByAnchor(CONTENT, "a1b2c3")!;
  return {
    id: edgeId(person, "born_in", city, NOTE, "a1b2c3"),
    subject: person,
    predicate: "born_in",
    object: city,
    provenance: makeProvenance({ note: NOTE, anchor: "a1b2c3", paragraph: para.text, quote: "דוד כהן נולד בחיפה", extractor: "test@1", model: null, date: new Date("2026-11-15T10:00:00Z") }),
    confidence: 0.9,
    status: "proposed",
    ...over,
  };
}

describe("W12.E1 types and predicates", () => {
  it("has the seven types, each with a folder under ישויות/ and a schema.org class", () => {
    expect(ENTITY_TYPES).toEqual(["person", "place", "organization", "event", "law", "source", "concept"]);
    for (const t of ENTITY_TYPES) {
      expect(TYPE_INFO[t].folder).toMatch(/^[֐-׿]+$/);
      expect(TYPE_INFO[t].schema).toMatch(/^[A-Z][A-Za-z]+$/);
    }
    expect(entityNotePath({ type: "person", name: "דוד כהן" })).toBe("ישויות/אנשים/דוד כהן.md");
    expect(entityNotePath({ type: "law", name: "חוק: יסוד/בדיקה?" })).toBe("ישויות/חוקים/חוק יסוד בדיקה.md");
  });
  it("predicates are unique, and those with a Wikidata id name a property (P…)", () => {
    expect(new Set(PREDICATES.map((p) => p.id)).size).toBe(PREDICATES.length);
    for (const p of PREDICATES) if (p.wikidata) expect(p.wikidata).toMatch(/^P\d+$/);
    for (const want of ["born_in", "member_of", "cites", "enacted_by", "located_in", "part_of", "related_to"]) expect(PREDICATES.some((p) => p.id === want)).toBe(true);
  });
  it("entity ids drop niqqud and fold case and spaces", () => {
    expect(entityId("person", "דָּוִד  כהן")).toBe("person:דוד-כהן");
    expect(entityId("place", "Tel Aviv")).toBe("place:tel-aviv");
  });
});

describe("W12.E1 sha256", () => {
  it("matches Web Crypto on ASCII, Hebrew, empty and multi-block input", async () => {
    for (const s of ["", "abc", "דוד כהן נולד בחיפה", "x".repeat(55), "x".repeat(56), "y".repeat(64), "ש".repeat(1000)]) {
      const d = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      const hex = Buffer.from(d).toString("hex");
      expect(sha256Hex(s)).toBe(hex);
    }
  });
});

describe("W12.E1 schema: an edge without provenance is rejected", () => {
  it("accepts a full edge", () => {
    expect(validateEdge(edge())).toEqual({ ok: true, problems: [] });
  });
  it("rejects a missing provenance", () => {
    const { provenance: _p, ...rest } = edge();
    const c = validateEdge(rest);
    expect(c.ok).toBe(false);
    expect(c.problems).toContainEqual({ problem: "no-provenance", field: "provenance" });
    expect(() => assertEdge(rest)).toThrow(/no-provenance/);
  });
  it.each(["note", "anchor", "quote", "paragraphHash", "extractor", "model", "date"])("rejects provenance without %s", (k) => {
    const e = edge();
    const p = { ...e.provenance } as Record<string, unknown>;
    delete p[k];
    expect(validateEdge({ ...e, provenance: p }).ok).toBe(false);
  });
  it("rejects empty or malformed provenance values", () => {
    const e = edge();
    for (const bad of [{ quote: "  " }, { note: "" }, { anchor: "has space" }, { paragraphHash: "md5:00" }, { date: "yesterday" }, { extractor: "" }, { model: 3 }]) {
      expect(validateEdge({ ...e, provenance: { ...e.provenance, ...bad } }).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(validateEdge({ ...e, provenance: null }).ok).toBe(false);
  });
  it("rejects an unknown predicate, a wrong domain or range, and extra fields", () => {
    expect(validateEdge(edge({ predicate: "hates" })).problems.map((p) => p.problem)).toContain("unknown-predicate");
    expect(validateEdge(edge({ subject: city, object: person })).problems.map((p) => p.problem)).toEqual(expect.arrayContaining(["domain", "range"]));
    expect(validateEdge({ ...edge(), extra: 1 }).problems.map((p) => p.problem)).toContain("unknown-field");
    expect(validateEdge(edge({ confidence: 2 })).ok).toBe(false);
    expect(validateEdge(edge({ subject: "nobody" })).ok).toBe(false);
  });
  it("the JSON Schema lists the same required fields the validator enforces", () => {
    expect([...EDGE_SCHEMA.required]).toEqual(["id", "subject", "predicate", "object", "provenance", "confidence", "status"]);
    expect([...EDGE_SCHEMA.properties.provenance.required]).toEqual(["note", "anchor", "quote", "paragraphHash", "extractor", "model", "date"]);
    expect(EDGE_SCHEMA.properties.predicate.enum).toHaveLength(PREDICATES.length);
  });
});

describe("W12.E1 paragraphs and anchors", () => {
  it("splits blocks, skips front matter and code, reads ^id", () => {
    const ps = splitParagraphs(CONTENT);
    expect(ps.map((p) => [p.kind, p.text, p.anchor])).toEqual([
      ["heading", "# פגישה", null],
      ["text", "דוד כהן נולד בחיפה בשנת 1950.", "a1b2c3"],
      ["list", "- רחל לוי חברה בוועד המקומי", null],
      ["list", "- פריט שני", null],
      ["text", "פסקה בלי עוגן.", null],
    ]);
  });
  it("the hash ignores the ^id mark and trailing spaces, not the words", () => {
    expect(paragraphHash("שלום עולם  ")).toBe(paragraphHash("שלום עולם"));
    expect(paragraphHash("שלום עולם")).not.toBe(paragraphHash("שלום, עולם"));
    expect(paragraphByAnchor(CONTENT, "a1b2c3")!.hash).toBe(paragraphHash("דוד כהן נולד בחיפה בשנת 1950."));
  });
  it("ensureAnchor adds the same id 'Copy link to block' would, and the split finds it", () => {
    const pos = CONTENT.indexOf("פסקה בלי עוגן");
    const r = ensureAnchor(CONTENT, pos, () => "zz9")!;
    expect(r.anchor).toBe("zz9");
    expect(r.content.endsWith("פסקה בלי עוגן. ^zz9")).toBe(true);
    const p = paragraphByAnchor(r.content, "zz9")!;
    expect(p.text).toBe("פסקה בלי עוגן.");
    expect(p.hash).toBe(splitParagraphs(CONTENT)[4].hash);
    // A list item gets its own id.
    const li = ensureAnchor(CONTENT, CONTENT.indexOf("רחל לוי"), () => "li1")!;
    expect(paragraphByAnchor(li.content, "li1")!.text).toBe("- רחל לוי חברה בוועד המקומי");
    // A paragraph that has one keeps it, and the note is unchanged.
    expect(ensureAnchor(CONTENT, CONTENT.indexOf("נולד"))).toEqual({ content: CONTENT, anchor: "a1b2c3" });
  });
});

describe("W12.E1 provenance and 'source changed'", () => {
  it("refuses a quote that is not word for word, or elided", () => {
    expect(quoteInParagraph("דוד כהן נולד בחיפה", "דוד כהן נולד בחיפה בשנת 1950.")).toBe(true);
    expect(quoteInParagraph("דוד כהן נולד בתל אביב", "דוד כהן נולד בחיפה בשנת 1950.")).toBe(false);
    expect(quoteInParagraph("דוד … בחיפה", "דוד כהן נולד בחיפה")).toBe(false);
    expect(() => makeProvenance({ note: NOTE, anchor: "a", paragraph: "אחר", quote: "דוד", extractor: "x", model: null })).toThrow(/word for word/);
  });
  it("an unchanged paragraph is ok", () => {
    expect(edgeSourceState(edge().provenance, CONTENT)).toBe("ok");
  });
  it("a changed paragraph marks the edge 'changed', even when the quote is still there", () => {
    const changed = CONTENT.replace("בשנת 1950", "בשנת 1951");
    expect(edgeSourceState(edge().provenance, changed)).toBe("changed");
    const gone = CONTENT.replace("דוד כהן נולד בחיפה", "משה נולד בעכו");
    expect(edgeSourceState(edge().provenance, gone)).toBe("changed");
  });
  it("a removed anchor or note is reported as missing", () => {
    expect(edgeSourceState(edge().provenance, CONTENT.replace(" ^a1b2c3", ""))).toBe("missing-paragraph");
    expect(edgeSourceState(edge().provenance, null)).toBe("missing-note");
  });
  it("markSourceChanges reads each note once", () => {
    let reads = 0;
    const out = markSourceChanges([edge(), edge({ id: "x2" })], () => {
      reads++;
      return CONTENT.replace("1950", "1949");
    });
    expect(out.map((e) => e.source)).toEqual(["changed", "changed"]);
    expect(reads).toBe(1);
  });
});

describe("W12.E1 proposals index", () => {
  const entityP = (name: string, start = 0): Proposal => ({
    kind: "entity",
    id: `p:${entityId("person", name)}`,
    type: "person",
    name,
    aliases: [],
    mentions: [{ note: NOTE, anchor: null, paragraphHash: paragraphHash("x"), start, end: start + 3, text: name }],
    extractor: "rules@1",
    model: null,
    confidence: 1,
  });
  it("lives under .lumen/entities, apart from approved entities", () => {
    expect(PROPOSALS_PATH).toBe(".lumen/entities/proposals.jsonl");
  });
  it("drops invalid edges, suppresses rejected ones, merges repeated mentions", () => {
    const { provenance: _p, ...noProv } = edge();
    const ep: Proposal = { kind: "edge", id: "e1", edge: edge() };
    const bad: Proposal = { kind: "edge", id: "e2", edge: noProv as Edge };
    const r1 = mergeProposals([], [entityP("דוד כהן", 0), ep, bad], []);
    expect([r1.added, r1.invalid, r1.suppressed]).toEqual([2, 1, 0]);
    const r2 = mergeProposals(r1.proposals, [entityP("דוד כהן", 50)], []);
    expect(r2.added).toBe(0);
    expect((r2.proposals[0] as { mentions: unknown[] }).mentions).toHaveLength(2);
    const r3 = mergeProposals([], [ep], [{ key: proposalKey(ep), verdict: "rejected", date: "2026-11-15" }]);
    expect([r3.added, r3.suppressed]).toEqual([0, 1]);
  });
  it("JSON Lines round-trip; a bad line is counted, not fatal", () => {
    const text = toJsonl([edge()]) + "{broken\n" + toJsonl([{ ...edge(), provenance: undefined }]);
    const { rows, bad } = parseJsonl(text);
    expect([rows.length, bad]).toEqual([2, 1]);
    const r = readEdges(text);
    expect([r.edges.length, r.bad]).toEqual([1, 2]);
    expect(() => appendEdge("", { ...edge(), provenance: undefined } as unknown as Edge)).toThrow(/rejected/);
    expect(readEdges(appendEdge("", edge())).edges).toHaveLength(1);
  });
});

describe("W12.E1 approved entities are plain notes", () => {
  it("writes YAML front matter Obsidian reads (aliases, a type, relations as [[links]])", () => {
    const e = { id: person, type: "person" as const, name: "דוד כהן", aliases: ["D. Cohen", "דוד"] };
    const n = entityNote(e, [edge({ status: "approved" }), edge({ id: "p", status: "proposed" })], (id) => (id === city ? "חיפה" : undefined));
    expect(n.path).toBe("ישויות/אנשים/דוד כהן.md");
    const { props, body, broken } = splitFrontmatter(n.content);
    expect(broken).toBe(false);
    expect(props).toEqual({ type: "person", "entity-type": "person", aliases: ["D. Cohen", "דוד"], born_in: ["[[חיפה]]"] });
    expect(body.trim()).toBe("# דוד כהן");
    expect(parseEntityNote(n.path, n.content)).toEqual(e);
    expect(relationProps(n.content)).toEqual({ born_in: ["חיפה"] });
  });
  it("a note without entity-type is not an entity", () => {
    expect(parseEntityNote("a.md", "---\ntags: [x]\n---\nטקסט")).toBeNull();
    expect(parseEntityNote("a.md", "רק טקסט")).toBeNull();
  });
});
