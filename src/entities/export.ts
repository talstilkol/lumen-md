/**
 * Entity-graph export (plan W12.E8): JSON-LD (schema.org), GraphML,
 * RDF/Turtle with PROV-O, and Neo4j `neo4j-admin database import` CSV.
 *
 * The writers are pure functions of the graph with no dependencies, and
 * deterministic (entities and edges sorted by id), so an export can be
 * diffed. Every edge carries its provenance into every format: the note,
 * the `^id` anchor, the exact quote, the paragraph hash, the extractor,
 * the model and the date. Hebrew stays UTF-8 text in all four.
 *
 * Ids: an entity's IRI is `urn:lumen:entity:<id>`, its source paragraph
 * `urn:lumen:note:<path>#^<anchor>`, both percent-encoded where an IRI
 * does not allow the character (Hebrew letters are allowed in IRIs and
 * kept). Clean implementation; GraphML/Turtle/JSON-LD/CSV per their specs
 * (graphml.graphdrawing.org, W3C Turtle and PROV-O, JSON-LD 1.1, the
 * neo4j-admin import header format).
 *
 * An export door (review 8, RR8-481-1): every text that comes from a note —
 * names, aliases and quotes — goes through `prepareForExportSync`, so a
 * `<redact>` passage or a hidden comment inside a quoted paragraph never
 * leaves the vault, whichever format is chosen.
 */
import { PREDICATES, TYPE_INFO, predicateInfo, type Edge, type Entity } from "./model";
import type { EntityGraph } from "./store";
import { prepareForExportSync } from "../lib/redaction";

const byId = <T extends { id: string }>(xs: readonly T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Percent-encode what an IRI may not hold (RFC 3987 ucschar letters stay). */
const iriPart = (s: string) =>
  [...s.normalize("NFC")]
    .map((c) => (/[\p{L}\p{M}\p{N}\-._~:/]/u.test(c) ? c : [...new TextEncoder().encode(c)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join("")))
    .join("");

export const entityIri = (id: string) => `urn:lumen:entity:${iriPart(id)}`;
export const sourceIri = (note: string, anchor: string) => `urn:lumen:note:${iriPart(note)}#%5E${iriPart(anchor)}`;
export const edgeIri = (e: Edge) => `urn:lumen:edge:${iriPart(e.id)}`;
export const VOCAB = "urn:lumen:vocab:";

const SCHEMA = "https://schema.org/";
const PROV = "http://www.w3.org/ns/prov#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XSD = "http://www.w3.org/2001/XMLSchema#";

const clean = (s: string) => prepareForExportSync(s, { keepImageMetadata: true });

/** Only edges whose two ends are entities of the graph are exported; note text is cleaned for export. */
function exportable(g: EntityGraph): { entities: Entity[]; edges: Edge[] } {
  const ids = new Set(g.entities.map((e) => e.id));
  const entities = byId(g.entities).map((e) => ({ ...e, name: clean(e.name), aliases: e.aliases.map(clean) }));
  const edges = byId(g.edges.filter((e) => ids.has(e.subject) && ids.has(e.object))).map((e) => ({ ...e, provenance: { ...e.provenance, quote: clean(e.provenance.quote) } }));
  return { entities, edges };
}

// ---------------------------------------------------------------- JSON-LD

export function toJsonLd(g: EntityGraph): string {
  const { entities, edges } = exportable(g);
  const graph: Record<string, unknown>[] = [];
  for (const e of entities) {
    const node: Record<string, unknown> = { "@id": entityIri(e.id), "@type": TYPE_INFO[e.type].schema, name: e.name };
    if (e.aliases.length) node.alternateName = [...e.aliases];
    if (e.qid) node.sameAs = `http://www.wikidata.org/entity/${e.qid}`;
    for (const x of edges.filter((x) => x.subject === e.id)) {
      const k = `lumen:${x.predicate}`;
      const list = (node[k] as unknown[]) ?? [];
      list.push({ "@id": entityIri(x.object) });
      node[k] = list;
    }
    graph.push(node);
  }
  for (const x of edges) {
    const p = x.provenance;
    graph.push({
      "@id": edgeIri(x),
      "@type": ["rdf:Statement", "prov:Entity"],
      "rdf:subject": { "@id": entityIri(x.subject) },
      "rdf:predicate": { "@id": `lumen:${x.predicate}` },
      "rdf:object": { "@id": entityIri(x.object) },
      "prov:wasDerivedFrom": { "@id": sourceIri(p.note, p.anchor) },
      "prov:value": p.quote,
      "lumen:note": p.note,
      "lumen:anchor": p.anchor,
      "lumen:paragraphHash": p.paragraphHash,
      "prov:wasAttributedTo": { "@id": `urn:lumen:agent:${iriPart(p.extractor)}`, "lumen:model": p.model },
      "prov:generatedAtTime": { "@value": p.date, "@type": "xsd:dateTime" },
      "lumen:confidence": x.confidence,
      "lumen:status": x.status,
      ...(x.when ? { "lumen:when": x.when } : {}),
    });
  }
  const doc = {
    "@context": { "@vocab": SCHEMA, lumen: VOCAB, prov: PROV, rdf: RDF, xsd: XSD },
    "@graph": graph,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// ---------------------------------------------------------------- GraphML

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\r/g, "&#13;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");
/** XML 1.0 forbids most control characters even as references; they are dropped from text. */
const xmlText = (s: string) => xml(s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, ""));
/**
 * Review 11, L10: an id may not lose characters, or two ids become one (`a\u0001b`
 * and `ab`). In an id the characters XML cannot carry are percent-escaped
 * (`%01`, `%uFFFE`), and `%` itself is `%25`, so different ids stay different.
 */
export const graphmlId = (s: string) => s.replace(/[%\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, (c) => {
  const n = c.charCodeAt(0);
  return n > 0xff ? `%u${n.toString(16).toUpperCase().padStart(4, "0")}` : `%${n.toString(16).toUpperCase().padStart(2, "0")}`;
});
const xmlId = (s: string) => xml(graphmlId(s));

/**
 * GraphML has no list type, so aliases are one string joined by `|`. An
 * alias that holds `|` or `\` has it escaped with `\`, so the list splits
 * back exactly (splitGraphMLList); a plain list reads as before.
 */
export const joinGraphMLList = (xs: readonly string[]) => xs.map((x) => x.replace(/\\/g, "\\\\").replace(/\|/g, "\\|")).join("|");
export function splitGraphMLList(s: string): string[] {
  if (s === "") return [];
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) cur += s[++i];
    else if (c === "|") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const NODE_KEYS = [
  ["type", "string"],
  ["name", "string"],
  ["aliases", "string"],
  ["schema", "string"],
  ["wikidata", "string"],
] as const;
const EDGE_KEYS = [
  ["predicate", "string"],
  ["wikidataProperty", "string"],
  ["note", "string"],
  ["anchor", "string"],
  ["quote", "string"],
  ["paragraphHash", "string"],
  ["extractor", "string"],
  ["model", "string"],
  ["date", "string"],
  ["confidence", "double"],
  ["status", "string"],
  ["when", "string"],
] as const;

export function toGraphML(g: EntityGraph): string {
  const { entities, edges } = exportable(g);
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">'];
  for (const [k, t] of NODE_KEYS) out.push(`  <key id="n_${k}" for="node" attr.name="${k}" attr.type="${t}"/>`);
  for (const [k, t] of EDGE_KEYS) out.push(`  <key id="e_${k}" for="edge" attr.name="${k}" attr.type="${t}"/>`);
  out.push('  <graph id="lumen-entities" edgedefault="directed">');
  const data = (k: string, v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "" : `<data key="${k}">${xmlText(String(v))}</data>`);
  for (const e of entities) {
    out.push(`    <node id="${xmlId(e.id)}">${data("n_type", e.type)}${data("n_name", e.name)}${data("n_aliases", joinGraphMLList(e.aliases))}${data("n_schema", TYPE_INFO[e.type].schema)}${data("n_wikidata", e.qid)}</node>`);
  }
  for (const x of edges) {
    const p = x.provenance;
    out.push(
      // Ids are escaped, not filtered (review 11, L10): XML 1.0 cannot carry the control characters even in an attribute.
      `    <edge id="${xmlId(x.id)}" source="${xmlId(x.subject)}" target="${xmlId(x.object)}">` +
        data("e_predicate", x.predicate) +
        data("e_wikidataProperty", predicateInfo(x.predicate)?.wikidata) +
        data("e_note", p.note) +
        data("e_anchor", p.anchor) +
        data("e_quote", p.quote) +
        data("e_paragraphHash", p.paragraphHash) +
        data("e_extractor", p.extractor) +
        data("e_model", p.model) +
        data("e_date", p.date) +
        data("e_confidence", x.confidence) +
        data("e_status", x.status) +
        data("e_when", x.when) +
        "</edge>",
    );
  }
  out.push("  </graph>", "</graphml>");
  return `${out.join("\n")}\n`;
}

// ---------------------------------------------------------------- Turtle

/** A Turtle string literal (STRING_LITERAL_LONG is not needed: newlines escaped). */
const lit = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
const langLit = (s: string) => (/[֐-׿]/.test(s) ? `${lit(s)}@he` : /[a-z]/i.test(s) ? `${lit(s)}@en` : lit(s));
const ref = (iri: string) => `<${iri}>`;

/**
 * Turtle with one full-IRI triple per line (a subset that is also
 * N-Triples apart from the language tags' shape), so any RDF tool reads it
 * and a diff is line per triple. Each edge is the direct triple plus a
 * reified `rdf:Statement` that is a `prov:Entity` derived from its
 * paragraph (`prov:wasDerivedFrom`), with `prov:value` the quote.
 */
export function toTurtle(g: EntityGraph): string {
  const { entities, edges } = exportable(g);
  const t: string[] = ["# Lumen entity graph — RDF 1.1 Turtle, PROV-O provenance per edge"];
  const T = (s: string, p: string, o: string) => t.push(`${s} ${p} ${o} .`);
  const a = ref(`${RDF}type`);
  for (const p of PREDICATES) if (edges.some((x) => x.predicate === p.id)) {
    T(ref(VOCAB + p.id), a, ref(`${RDF}Property`));
    T(ref(VOCAB + p.id), ref("http://www.w3.org/2000/01/rdf-schema#label"), langLit(p.en));
    T(ref(VOCAB + p.id), ref("http://www.w3.org/2000/01/rdf-schema#label"), langLit(p.he));
    if (p.wikidata) T(ref(VOCAB + p.id), ref("http://www.w3.org/2002/07/owl#equivalentProperty"), ref(`http://www.wikidata.org/prop/direct/${p.wikidata}`));
  }
  for (const e of entities) {
    const s = ref(entityIri(e.id));
    T(s, a, ref(SCHEMA + TYPE_INFO[e.type].schema));
    T(s, ref(`${SCHEMA}name`), langLit(e.name));
    for (const al of e.aliases) T(s, ref(`${SCHEMA}alternateName`), langLit(al));
    if (e.qid) T(s, ref(`${SCHEMA}sameAs`), ref(`http://www.wikidata.org/entity/${e.qid}`));
  }
  for (const x of edges) {
    const p = x.provenance;
    const st = ref(edgeIri(x));
    const agent = ref(`urn:lumen:agent:${iriPart(p.extractor)}`);
    T(ref(entityIri(x.subject)), ref(VOCAB + x.predicate), ref(entityIri(x.object)));
    T(st, a, ref(`${RDF}Statement`));
    T(st, a, ref(`${PROV}Entity`));
    T(st, ref(`${RDF}subject`), ref(entityIri(x.subject)));
    T(st, ref(`${RDF}predicate`), ref(VOCAB + x.predicate));
    T(st, ref(`${RDF}object`), ref(entityIri(x.object)));
    T(st, ref(`${PROV}wasDerivedFrom`), ref(sourceIri(p.note, p.anchor)));
    T(st, ref(`${PROV}value`), langLit(p.quote));
    T(st, ref(`${VOCAB}paragraphHash`), lit(p.paragraphHash));
    T(st, ref(`${PROV}wasAttributedTo`), agent);
    T(st, ref(`${PROV}generatedAtTime`), `${lit(p.date)}^^${ref(`${XSD}dateTime`)}`);
    T(st, ref(`${VOCAB}confidence`), `${lit(String(x.confidence))}^^${ref(`${XSD}decimal`)}`);
    T(st, ref(`${VOCAB}status`), lit(x.status));
    if (x.when) T(st, ref(`${VOCAB}when`), lit(x.when));
    T(agent, a, ref(`${PROV}SoftwareAgent`));
    if (p.model) T(agent, ref(`${VOCAB}model`), lit(p.model));
    T(ref(sourceIri(p.note, p.anchor)), ref(`${VOCAB}note`), lit(p.note));
  }
  // The same agent and source can repeat; Turtle allows it, but keep the file minimal.
  return `${[t[0], ...[...new Set(t.slice(1))]].join("\n")}\n`;
}

// ---------------------------------------------------------------- Neo4j CSV

/** RFC 4180 field: quoted when it holds a comma, quote or line break. */
const csv = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (xs: Array<string | number | null | undefined>) => xs.map(csv).join(",");
/** Neo4j relationship types: upper snake case. */
export const neo4jType = (predicate: string) => predicate.toUpperCase();

/**
 * Two files for `neo4j-admin database import full`: nodes with `:ID` and
 * `:LABEL`, relationships with `:START_ID`, `:END_ID` and `:TYPE`. Aliases
 * are a `string[]` (array delimiter `;`, so a `;` inside an alias becomes
 * `,`). A quote can span lines: import with `--multiline-fields=true`.
 */
export function toNeo4jCsv(g: EntityGraph): { nodes: string; relationships: string } {
  const { entities, edges } = exportable(g);
  const nodes = [row(["id:ID", "name", "aliases:string[]", "type", "wikidata", ":LABEL"])];
  for (const e of entities) nodes.push(row([e.id, e.name, e.aliases.map((a) => a.replace(/;/g, ",")).join(";"), e.type, e.qid ?? "", `Entity;${TYPE_INFO[e.type].schema}`]));
  const rels = [row([":START_ID", ":END_ID", ":TYPE", "id", "note", "anchor", "quote", "paragraphHash", "extractor", "model", "date:datetime", "confidence:float", "status", "when"])];
  for (const x of edges) {
    const p = x.provenance;
    rels.push(row([x.subject, x.object, neo4jType(x.predicate), x.id, p.note, p.anchor, p.quote, p.paragraphHash, p.extractor, p.model ?? "", p.date, x.confidence, x.status, x.when ?? ""]));
  }
  return { nodes: `${nodes.join("\n")}\n`, relationships: `${rels.join("\n")}\n` };
}

export type ExportFormat = "jsonld" | "graphml" | "turtle" | "neo4j";

/** Files to write for a format: path → text (UTF-8). */
export function exportGraph(g: EntityGraph, format: ExportFormat, base = "entities"): Record<string, string> {
  switch (format) {
    case "jsonld":
      return { [`${base}.jsonld`]: toJsonLd(g) };
    case "graphml":
      return { [`${base}.graphml`]: toGraphML(g) };
    case "turtle":
      return { [`${base}.ttl`]: toTurtle(g) };
    case "neo4j": {
      const { nodes, relationships } = toNeo4jCsv(g);
      return { [`${base}-nodes.csv`]: nodes, [`${base}-relationships.csv`]: relationships };
    }
  }
}
