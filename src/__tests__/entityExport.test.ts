/**
 * W12.E8 — export to JSON-LD, GraphML, RDF/Turtle (PROV-O) and Neo4j CSV:
 * each format read back gives the same number of nodes and edges, Hebrew
 * names come back as the same UTF-8 text, and every edge keeps its
 * provenance. The graph is synthetic.
 *
 * Readers used here only: JSON.parse; the DOM's XML parser for GraphML;
 * papaparse (already a dependency) for the CSV; and for Turtle a strict
 * reader of the one-triple-per-line subset the writer emits (any line that
 * is not a full triple fails the test). A round trip through n3 is owed on
 * the Mac: n3 is not installed here and the registry is offline.
 */
import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { edgeId, entityId, type Edge, type Entity } from "../entities/model";
import { makeProvenance } from "../entities/provenance";
import { entityIri, exportGraph, sourceIri, toGraphML, toJsonLd, toNeo4jCsv, toTurtle } from "../entities/export";
import type { EntityGraph } from "../entities/store";

const ent = (type: Entity["type"], name: string, aliases: string[] = [], qid?: string): Entity => ({ id: entityId(type, name), type, name, aliases, ...(qid ? { qid } : {}) });

const people = [ent("person", "דוד כהן", ["D. Cohen", "דוד; הבכור"]), ent("person", "רחל \"רוחי\" לוי"), ent("person", "Anna Smith")];
const places = [ent("place", "חיפה", ["Haifa"], "Q41621"), ent("place", "תל אביב-יפו")];
const orgs = [ent("organization", "ועד <השכונה> & שות׳")];
const laws = [ent("law", "חוק הגנת הפרטיות, התשמ״א-1981")];
const graph: EntityGraph = { entities: [...people, ...places, ...orgs, ...laws], edges: [] };

function mk(s: Entity, p: string, o: Entity, para: string, quote: string, note = "יומן/פגישה, 2026.md", anchor = "a1"): Edge {
  return {
    id: edgeId(s.id, p, o.id, note, anchor),
    subject: s.id,
    predicate: p,
    object: o.id,
    provenance: makeProvenance({ note, anchor, paragraph: para, quote, extractor: "rules@1", model: p === "member_of" ? "gemma-4-e4b@q4" : null, date: new Date("2026-11-15T09:30:00Z") }),
    confidence: 0.75,
    status: "approved",
  };
}
graph.edges.push(
  mk(people[0], "born_in", places[0], 'דוד כהן נולד בחיפה, "עיר הכרמל".\nשורה שנייה', 'דוד כהן נולד בחיפה, "עיר הכרמל".\nשורה שנייה'),
  mk(people[1], "member_of", orgs[0], "רחל \"רוחי\" לוי חברה בוועד <השכונה> & שות׳", "חברה בוועד", "a.md", "b2"),
  mk(people[2], "born_in", places[1], "Anna Smith was born in Tel Aviv-Yafo", "Anna Smith was born", "en.md", "c3"),
  mk(laws[0], "enacted_by", orgs[0], "החוק נחקק על ידי הוועד", "נחקק על ידי הוועד", "law.md", "d4"),
);
// An edge to an entity that is not in the graph is not exported.
const dangling = mk(people[0], "born_in", ent("place", "אין"), "דוד כהן נולד באין", "נולד באין", "x.md", "z9");
const withDangling: EntityGraph = { entities: graph.entities, edges: [...graph.edges, dangling] };

const N = graph.entities.length;
const E = graph.edges.length;

describe("W12.E8 JSON-LD", () => {
  it("round-trips nodes, edges and Hebrew names, with schema.org types and provenance", () => {
    const doc = JSON.parse(toJsonLd(withDangling));
    expect(doc["@context"]["@vocab"]).toBe("https://schema.org/");
    const nodes = doc["@graph"].filter((n: { "@type": unknown }) => typeof n["@type"] === "string");
    const stmts = doc["@graph"].filter((n: { "@type": unknown }) => Array.isArray(n["@type"]));
    expect([nodes.length, stmts.length]).toEqual([N, E]);
    expect(new Set(nodes.map((n: { "@type": string }) => n["@type"]))).toEqual(new Set(["Person", "Place", "Organization", "Legislation"]));
    expect(nodes.map((n: { name: string }) => n.name).sort()).toEqual(graph.entities.map((e) => e.name).sort());
    const haifa = nodes.find((n: { name: string }) => n.name === "חיפה");
    expect(haifa.sameAs).toBe("http://www.wikidata.org/entity/Q41621");
    const born = stmts.find((s: { "prov:value": string }) => s["prov:value"].startsWith("דוד כהן"));
    expect(born["prov:wasDerivedFrom"]["@id"]).toBe(sourceIri("יומן/פגישה, 2026.md", "a1"));
    expect(born["lumen:paragraphHash"]).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(born["prov:value"]).toBe('דוד כהן נולד בחיפה, "עיר הכרמל".\nשורה שנייה');
  });
  it("ids are stable across exports and input order", () => {
    const shuffled = { entities: [...graph.entities].reverse(), edges: [...graph.edges].reverse() };
    expect(toJsonLd(shuffled)).toBe(toJsonLd(graph));
    expect(entityIri(people[0].id)).toBe("urn:lumen:entity:person:דוד-כהן");
  });
});

describe("W12.E8 GraphML", () => {
  it("is well-formed XML with the same nodes, edges, Hebrew text and provenance keys", () => {
    const text = toGraphML(withDangling);
    const doc = new DOMParser().parseFromString(text, "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const nodes = [...doc.getElementsByTagName("node")];
    const edges = [...doc.getElementsByTagName("edge")];
    expect([nodes.length, edges.length]).toEqual([N, E]);
    const dataOf = (el: Element, key: string) => [...el.getElementsByTagName("data")].find((d) => d.getAttribute("key") === key)?.textContent;
    expect(nodes.map((n) => dataOf(n, "n_name")).sort()).toEqual(graph.entities.map((e) => e.name).sort());
    const keys = [...doc.getElementsByTagName("key")].map((k) => k.getAttribute("attr.name"));
    for (const k of ["predicate", "note", "anchor", "quote", "paragraphHash", "extractor", "model", "date"]) expect(keys).toContain(k);
    const born = edges.find((e) => dataOf(e, "e_note") === "יומן/פגישה, 2026.md")!;
    expect(dataOf(born, "e_quote")).toBe('דוד כהן נולד בחיפה, "עיר הכרמל".\nשורה שנייה');
    expect(born.getAttribute("source")).toBe(people[0].id);
    const org = nodes.find((n) => n.getAttribute("id") === orgs[0].id)!;
    expect(dataOf(org, "n_name")).toBe("ועד <השכונה> & שות׳");
  });
});

/** Strict reader for the writer's subset: `<iri> <iri> (<iri>|"lit"(@lang|^^<iri>)?) .` per line. */
function readTurtleLines(text: string): Array<[string, string, string]> {
  const IRI = "<([^<>\"{}|^`\\\\\\s]*)>";
  const LIT = '"((?:[^"\\\\\\n\\r]|\\\\[tbnrf"\\\\])*)"(?:@([a-z]+(?:-[a-z0-9]+)*)|\\^\\^<([^>]*)>)?';
  const re = new RegExp(`^${IRI} ${IRI} (?:${IRI}|${LIT}) \\.$`, "u");
  const out: Array<[string, string, string]> = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const m = re.exec(line);
    if (!m) throw new Error(`not a triple: ${line}`);
    const obj = m[3] !== undefined ? `<${m[3]}>` : JSON.parse(`"${m[4]}"`);
    out.push([m[1], m[2], obj]);
  }
  return out;
}

describe("W12.E8 RDF/Turtle with PROV-O", () => {
  const triples = readTurtleLines(toTurtle(withDangling));
  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  it("every line is a triple; nodes and edges count back", () => {
    const entities = triples.filter(([, p, o]) => p === RDF_TYPE && o.startsWith("<https://schema.org/"));
    const stmts = triples.filter(([, p, o]) => p === RDF_TYPE && o === "<http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement>");
    expect([entities.length, stmts.length]).toEqual([N, E]);
    const direct = triples.filter(([s, p, o]) => s.startsWith("urn:lumen:entity:") && p.startsWith("urn:lumen:vocab:") && o.startsWith("<urn:lumen:entity:"));
    expect(direct).toHaveLength(E);
  });
  it("each statement is derived from its paragraph and holds the quote; Hebrew literals unchanged", () => {
    const derived = triples.filter(([, p]) => p === "http://www.w3.org/ns/prov#wasDerivedFrom");
    expect(derived).toHaveLength(E);
    const quotes = triples.filter(([, p]) => p === "http://www.w3.org/ns/prov#value").map(([, , o]) => o);
    expect(quotes).toContain('דוד כהן נולד בחיפה, "עיר הכרמל".\nשורה שנייה');
    const names = triples.filter(([, p]) => p === "https://schema.org/name").map(([, , o]) => o);
    expect(names.sort()).toEqual(graph.entities.map((e) => e.name).sort());
  });
  it("Hebrew is UTF-8 text, not escaped", () => {
    expect(toTurtle(graph)).toContain('"חוק הגנת הפרטיות, התשמ״א-1981"@he');
  });
});

describe("W12.E8 Neo4j neo4j-admin import CSV", () => {
  it("has the import headers, and nodes and relationships count back through a CSV parser", () => {
    const { nodes, relationships } = toNeo4jCsv(withDangling);
    const n = Papa.parse<string[]>(nodes.trimEnd(), { skipEmptyLines: true }).data;
    const r = Papa.parse<string[]>(relationships.trimEnd(), { skipEmptyLines: true }).data;
    expect(n[0]).toEqual(["id:ID", "name", "aliases:string[]", "type", "wikidata", ":LABEL"]);
    expect(r[0].slice(0, 3)).toEqual([":START_ID", ":END_ID", ":TYPE"]);
    expect([n.length - 1, r.length - 1]).toEqual([N, E]);
    expect(n.slice(1).map((x) => x[1]).sort()).toEqual(graph.entities.map((e) => e.name).sort());
    const cohen = n.find((x) => x[1] === "דוד כהן")!;
    expect(cohen[2].split(";")).toEqual(["D. Cohen", "דוד, הבכור"]);
    expect(cohen[5]).toBe("Entity;Person");
    const born = r.find((x) => x[4] === "יומן/פגישה, 2026.md")!;
    expect(born[2]).toBe("BORN_IN");
    expect(born[6]).toBe('דוד כהן נולד בחיפה, "עיר הכרמל".\nשורה שנייה');
    const ids = new Set(n.slice(1).map((x) => x[0]));
    for (const x of r.slice(1)) expect(ids.has(x[0]) && ids.has(x[1])).toBe(true);
  });
});

describe("W12.E8 an export door: redacted text never leaves", () => {
  it("a <redact> passage and a hidden comment inside a quote are removed in every format", () => {
    const para = "רחל לוי <redact>מספר הטלפון 050-0000000</redact> חברה בוועד %%הערה נסתרת%% השכונה";
    const e = mk(people[1], "member_of", orgs[0], para, para, "r.md", "r1");
    const g: EntityGraph = { entities: graph.entities, edges: [e] };
    for (const f of ["jsonld", "graphml", "turtle", "neo4j"] as const) {
      const out = Object.values(exportGraph(g, f)).join("\n");
      expect(out, f).not.toContain("050-0000000");
      expect(out, f).not.toContain("הערה נסתרת");
      expect(out, f).toContain("רחל לוי");
    }
  });
});

describe("W12.E8 file names", () => {
  it("gives one file per format, two for Neo4j", () => {
    expect(Object.keys(exportGraph(graph, "jsonld"))).toEqual(["entities.jsonld"]);
    expect(Object.keys(exportGraph(graph, "graphml"))).toEqual(["entities.graphml"]);
    expect(Object.keys(exportGraph(graph, "turtle"))).toEqual(["entities.ttl"]);
    expect(Object.keys(exportGraph(graph, "neo4j"))).toEqual(["entities-nodes.csv", "entities-relationships.csv"]);
  });
});
