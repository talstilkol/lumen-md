/**
 * W12.E8 — a full round trip of every field, not only the counts: 60
 * seeded random graphs whose names, aliases, notes, anchors and quotes are
 * built from the characters that break exporters (quotes, backslashes,
 * CR/LF/tab, XML and IRI specials, `|` and `;` separators, C0 controls,
 * astral emoji, bidi marks, niqqud). Each export is written to UTF-8 bytes
 * and decoded again, as a file would be, then read back by an independent
 * reader:
 *   • JSON-LD: JSON.parse
 *   • GraphML: the DOM's XML parser
 *   • Turtle: a reader of the W3C RDF 1.1 N-Triples grammar written here
 *     from the spec (IRIREF, STRING_LITERAL_QUOTE with ECHAR and UCHAR,
 *     LANGTAG, datatypes) — the writer emits one full triple per line;
 *   • Neo4j CSV: papaparse.
 * No fast-check here (not installed); the generator is a seeded PRNG, so a
 * failure prints its seed and reproduces.
 *
 * The n3 round trip (the plan's Turtle reader) is the last block. It runs
 * when n3 is installed and is skipped, with its reason, until then.
 */
import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { edgeId, entityId, ENTITY_TYPES, PREDICATES, type Edge, type Entity } from "../entities/model";
import { makeProvenance } from "../entities/provenance";
import { entityIri, edgeIri, splitGraphMLList, toGraphML, toJsonLd, toNeo4jCsv, toTurtle } from "../entities/export";
import type { EntityGraph } from "../entities/store";
import { prepareForExportSync } from "../lib/redaction";

// ------------------------------------------------------------ generator

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ALPHABET = [
  ..."אבגדהוזחטיכלמנסעפצקרשתךםןףץ",
  ..."abcXYZ019",
  " ", " ", "\"", "'", "\\", "\n", "\r", "\t", "<", ">", "&", "{", "}", "|", "^", "`", ";", ",", "#", "%", ":", "/", "?", "=", "@", "_", "-", ".",
  "ָ", "ּ", // niqqud
  "‏", "‎", "‫", // bidi marks
  "\u0001", "\u000B", "\u001F", "\u007F", // controls
  "😀", "𝔸", "״", "׳", "€",
];
const word = (r: () => number, min = 1, max = 14) => {
  const n = min + Math.floor(r() * (max - min + 1));
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(r() * ALPHABET.length)];
  return s;
};
/** Names must keep a visible letter (a name of only marks would be refused upstream). */
const name = (r: () => number) => `${"אבגדabc"[Math.floor(r() * 7)]}${word(r, 0, 12)}`;

function randomGraph(seed: number): EntityGraph {
  const r = prng(seed);
  const entities: Entity[] = [];
  const seen = new Set<string>();
  const n = 2 + Math.floor(r() * 8);
  while (entities.length < n) {
    const type = ENTITY_TYPES[Math.floor(r() * ENTITY_TYPES.length)];
    const nm = name(r);
    const id = entityId(type, nm);
    if (seen.has(id)) continue;
    seen.add(id);
    const aliases = Array.from({ length: Math.floor(r() * 3) }, () => name(r));
    entities.push({ id, type, name: nm, aliases, ...(r() < 0.3 ? { qid: `Q${1 + Math.floor(r() * 99999)}` } : {}) });
  }
  const edges: Edge[] = [];
  const m = Math.floor(r() * 10);
  for (let i = 0; i < m; i++) {
    const s = entities[Math.floor(r() * n)];
    const o = entities[Math.floor(r() * n)];
    const predicate = PREDICATES[Math.floor(r() * PREDICATES.length)].id;
    const note = `${word(r, 1, 8)}/${word(r, 1, 8)}.md`;
    const anchor = `a${i}${word(r, 0, 4)}`;
    const quote = `${name(r)}${word(r, 0, 30)}${name(r)}`;
    const id = edgeId(s.id, predicate, o.id, note, anchor);
    if (edges.some((e) => e.id === id)) continue;
    edges.push({
      id,
      subject: s.id,
      predicate,
      object: o.id,
      provenance: makeProvenance({ note, anchor, paragraph: quote, quote, extractor: r() < 0.5 ? "rules@1" : `llm ${word(r, 1, 4)}`, model: r() < 0.5 ? null : `m-${word(r, 1, 5)}`, date: new Date(Date.UTC(2026, 0, 1) + Math.floor(r() * 3e10)) }),
      confidence: Math.round(r() * 100) / 100,
      status: r() < 0.5 ? "approved" : "proposed",
      ...(r() < 0.3 ? { when: `2026-0${1 + Math.floor(r() * 9)}` } : {}),
    } as Edge);
  }
  return { entities, edges };
}

/** As a file: UTF-8 bytes and back (a lone surrogate would not survive this). */
const asFile = (s: string) => new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(s));
const clean = (s: string) => prepareForExportSync(s, { keepImageMetadata: true });
/** What XML 1.0 can carry: the exporter drops the C0 controls other than tab, LF, CR. */
const xmlable = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
const sortStr = (xs: string[]) => [...xs].sort();

const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i * 7919);

// ------------------------------------------------- N-Triples reader (W3C RDF 1.1)

type Term = { kind: "iri"; value: string } | { kind: "bnode"; value: string } | { kind: "literal"; value: string; lang?: string; datatype?: string };
type Triple = [Term, Term, Term];

/**
 * https://www.w3.org/TR/n-triples/#n-triples-grammar. IRIREF holds no
 * #x00-#x20 < > " { } | ^ ` \ except as UCHAR; STRING_LITERAL_QUOTE holds no
 * raw " \ LF CR; ECHAR is \t \b \n \r \f \" \' \\; UCHAR is \uXXXX or
 * \UXXXXXXXX and must not be a surrogate. Anything else throws.
 */
export function parseNTriples(text: string): Triple[] {
  const out: Triple[] = [];
  let i = 0;
  const fail = (why: string): never => {
    const line = text.slice(0, i).split("\n").length;
    throw new Error(`N-Triples: ${why} at line ${line}: ${JSON.stringify(text.split("\n")[line - 1])}`);
  };
  const ws = () => {
    while (text[i] === " " || text[i] === "\t") i++;
  };
  const uchar = (): string => {
    const len = text[i] === "u" ? 4 : text[i] === "U" ? 8 : fail("bad escape");
    const hex = text.slice(i + 1, i + 1 + len);
    if (!new RegExp(`^[0-9A-Fa-f]{${len}}$`).test(hex)) fail("bad UCHAR");
    const cp = parseInt(hex, 16);
    if ((cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff) fail("UCHAR is not a scalar value");
    i += 1 + len;
    return String.fromCodePoint(cp);
  };
  const iri = (): string => {
    if (text[i] !== "<") fail("expected <");
    i++;
    let v = "";
    for (;;) {
      const c = text[i];
      if (c === undefined) fail("unterminated IRI");
      if (c === ">") break;
      if (c === "\\") {
        i++;
        v += uchar();
        continue;
      }
      if (c <= " " || '<"{}|^`'.includes(c)) fail(`character U+${c.codePointAt(0)!.toString(16)} not allowed in an IRI`);
      v += c;
      i++;
    }
    i++;
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(v)) fail("IRI is not absolute");
    return v;
  };
  const literal = (): Term => {
    i++;
    let v = "";
    for (;;) {
      const c = text[i];
      if (c === undefined || c === "\n" || c === "\r") fail("unterminated literal");
      if (c === '"') break;
      if (c === "\\") {
        i++;
        const e = text[i];
        const map: Record<string, string> = { t: "\t", b: "\b", n: "\n", r: "\r", f: "\f", '"': '"', "'": "'", "\\": "\\" };
        if (e in map) {
          v += map[e];
          i++;
        } else v += uchar();
        continue;
      }
      v += c;
      i++;
    }
    i++;
    if (text[i] === "@") {
      const m = /^@([a-zA-Z]+(?:-[a-zA-Z0-9]+)*)/.exec(text.slice(i));
      if (!m) fail("bad LANGTAG");
      i += m![0].length;
      return { kind: "literal", value: v, lang: m![1].toLowerCase() };
    }
    if (text.startsWith("^^", i)) {
      i += 2;
      return { kind: "literal", value: v, datatype: iri() };
    }
    return { kind: "literal", value: v };
  };
  const term = (pos: "s" | "p" | "o"): Term => {
    if (text[i] === "<") return { kind: "iri", value: iri() };
    if (pos !== "p" && text.startsWith("_:", i)) {
      const m = /^_:[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?/.exec(text.slice(i));
      if (!m) fail("bad blank node");
      i += m![0].length;
      return { kind: "bnode", value: m![0] };
    }
    if (pos === "o" && text[i] === '"') return literal();
    return fail(`bad ${pos === "s" ? "subject" : pos === "p" ? "predicate" : "object"}`);
  };
  while (i < text.length) {
    ws();
    if (text[i] === "#") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text[i] !== "\n" && text[i] !== "\r" && i < text.length) {
      const s = term("s");
      ws();
      const p = term("p");
      ws();
      const o = term("o");
      ws();
      if (text[i] !== ".") fail("expected .");
      i++;
      ws();
      if (text[i] === "#") while (i < text.length && text[i] !== "\n") i++;
      out.push([s, p, o]);
    }
    if (text[i] === "\r") i++;
    if (text[i] === "\n") i++;
    else if (i < text.length) fail("expected end of line");
  }
  return out;
}

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const PROV = "http://www.w3.org/ns/prov#";
const SCHEMA = "https://schema.org/";
const VOCAB = "urn:lumen:vocab:";

describe("the N-Triples reader is strict (so the round trip below means something)", () => {
  it.each([
    ["<urn:a> <urn:b> <urn:c> .\n", 1],
    ['<urn:a> <urn:b> "x\\u05D0\\U0001F600\\"\\\\"@he-IL .\n', 1],
    ['<urn:a> <urn:b> "1.5"^^<http://www.w3.org/2001/XMLSchema#decimal> . # c\n', 1],
  ])("reads %j", (t, n) => expect(parseNTriples(t)).toHaveLength(n));
  it.each([
    "<urn:a b> <urn:b> <urn:c> .\n",
    "<urn:a> <urn:b> <urn:c>\n",
    '<urn:a> <urn:b> "a\nb" .\n',
    '<urn:a> <urn:b> "\\uD800" .\n',
    "<urn:a> <urn:b> <urn:{c}> .\n",
    "<urn:a> <urn:b> <urn:c|d> .\n",
    "<urn:a> <urn:b> <urn:c^d> .\n",
    "<a> <urn:b> <urn:c> .\n",
    '<urn:a> "p" <urn:c> .\n',
    "<urn:a> <urn:b> <urn:c> . <urn:a> <urn:b> <urn:c> .\n",
    "<urn:a> <urn:b> <urn:\u0001c> .\n",
  ])("refuses %j", (t) => expect(() => parseNTriples(t)).toThrow(/N-Triples/));
});

// ------------------------------------------------------------ the round trips

describe("W12.E8 every field round-trips through each format (60 seeded random graphs)", () => {
  it("JSON-LD: every entity and statement, field by field", () => {
    for (const seed of SEEDS) {
      const g = randomGraph(seed);
      const doc = JSON.parse(asFile(toJsonLd(g)));
      const nodes = new Map<string, Record<string, unknown>>(doc["@graph"].map((n: Record<string, unknown>) => [n["@id"], n]));
      for (const e of g.entities) {
        const n = nodes.get(entityIri(e.id));
        expect(n, `seed ${seed}: ${e.id}`).toBeDefined();
        expect(n!.name, `seed ${seed}`).toBe(clean(e.name));
        expect(sortStr((n!.alternateName as string[]) ?? []), `seed ${seed}`).toEqual(sortStr(e.aliases.map(clean)));
      }
      for (const x of g.edges) {
        const s = nodes.get(edgeIri(x))!;
        expect(s, `seed ${seed}: ${x.id}`).toBeDefined();
        expect([s["prov:value"], s["lumen:note"], s["lumen:anchor"], s["lumen:paragraphHash"], s["lumen:status"], s["lumen:confidence"]], `seed ${seed}`).toEqual([clean(x.provenance.quote), x.provenance.note, x.provenance.anchor, x.provenance.paragraphHash, x.status, x.confidence]);
        expect((s["rdf:subject"] as { "@id": string })["@id"]).toBe(entityIri(x.subject));
      }
      expect(nodes.size, `seed ${seed}`).toBe(g.entities.length + g.edges.length);
    }
  });

  it("GraphML: well-formed for every seed; ids, names, aliases (with | inside), quotes and notes come back", () => {
    for (const seed of SEEDS) {
      const g = randomGraph(seed);
      const doc = new DOMParser().parseFromString(asFile(toGraphML(g)), "application/xml");
      expect(doc.getElementsByTagName("parsererror"), `seed ${seed}`).toHaveLength(0);
      const dataOf = (el: Element, key: string) => [...el.getElementsByTagName("data")].find((d) => d.getAttribute("key") === key)?.textContent ?? "";
      const nodes = new Map([...doc.getElementsByTagName("node")].map((n) => [n.getAttribute("id")!, n]));
      expect(nodes.size, `seed ${seed}`).toBe(g.entities.length);
      for (const e of g.entities) {
        const n = nodes.get(xmlable(e.id));
        expect(n, `seed ${seed}: ${JSON.stringify(e.id)}`).toBeDefined();
        expect(dataOf(n!, "n_name"), `seed ${seed}`).toBe(xmlable(clean(e.name)));
        expect(sortStr(splitGraphMLList(dataOf(n!, "n_aliases"))), `seed ${seed}`).toEqual(sortStr(e.aliases.map((a) => xmlable(clean(a)))));
      }
      const edges = new Map([...doc.getElementsByTagName("edge")].map((n) => [n.getAttribute("id")!, n]));
      expect(edges.size, `seed ${seed}`).toBe(g.edges.length);
      for (const x of g.edges) {
        const el = edges.get(xmlable(x.id));
        expect(el, `seed ${seed}: ${JSON.stringify(x.id)}`).toBeDefined();
        expect([el!.getAttribute("source"), el!.getAttribute("target")]).toEqual([xmlable(x.subject), xmlable(x.object)]);
        expect(nodes.has(el!.getAttribute("source")!) && nodes.has(el!.getAttribute("target")!), `seed ${seed}: the edge ends are nodes`).toBe(true);
        expect([dataOf(el!, "e_quote"), dataOf(el!, "e_note"), dataOf(el!, "e_anchor")], `seed ${seed}`).toEqual([xmlable(clean(x.provenance.quote)), xmlable(x.provenance.note), xmlable(x.provenance.anchor)]);
      }
    }
  });

  it("Turtle: valid N-Triples for every seed; every literal and IRI decodes back to the graph", () => {
    for (const seed of SEEDS) {
      const g = randomGraph(seed);
      const triples = parseNTriples(asFile(toTurtle(g)));
      const objects = (s: string, p: string) => triples.filter(([a, b]) => a.value === s && b.value === p).map(([, , o]) => o);
      const lits = (s: string, p: string) => objects(s, p).map((o) => (o.kind === "literal" ? o.value : `<${o.value}>`));
      for (const e of g.entities) {
        const s = entityIri(e.id);
        expect(objects(s, `${RDF}type`).map((o) => o.value), `seed ${seed}: ${e.id}`).toHaveLength(1);
        expect(lits(s, `${SCHEMA}name`), `seed ${seed}`).toEqual([clean(e.name)]);
        expect(sortStr(lits(s, `${SCHEMA}alternateName`)), `seed ${seed}`).toEqual(sortStr([...new Set(e.aliases.map(clean))]));
      }
      for (const x of g.edges) {
        const st = edgeIri(x);
        expect(lits(st, `${PROV}value`), `seed ${seed}`).toEqual([clean(x.provenance.quote)]);
        expect(objects(st, `${RDF}subject`).map((o) => o.value)).toEqual([entityIri(x.subject)]);
        expect(objects(st, `${RDF}object`).map((o) => o.value)).toEqual([entityIri(x.object)]);
        const src = objects(st, `${PROV}wasDerivedFrom`);
        expect(src, `seed ${seed}`).toHaveLength(1);
        expect(lits(src[0].value, `${VOCAB}note`), `seed ${seed}`).toEqual([x.provenance.note]);
        expect(triples.some(([a, b, c]) => a.value === entityIri(x.subject) && b.value === VOCAB + x.predicate && c.value === entityIri(x.object)), `seed ${seed}: the direct triple`).toBe(true);
      }
      const stmts = triples.filter(([, p, o]) => p.value === `${RDF}type` && o.value === `${RDF}Statement`);
      expect(stmts, `seed ${seed}`).toHaveLength(g.edges.length);
    }
  });

  it("Neo4j CSV: every node and relationship field comes back through a CSV parser", () => {
    for (const seed of SEEDS) {
      const g = randomGraph(seed);
      const { nodes, relationships } = toNeo4jCsv(g);
      const n = Papa.parse<string[]>(asFile(nodes), { skipEmptyLines: true }).data.slice(1);
      const r = Papa.parse<string[]>(asFile(relationships), { skipEmptyLines: true }).data.slice(1);
      expect(n, `seed ${seed}`).toHaveLength(g.entities.length);
      expect(r, `seed ${seed}`).toHaveLength(g.edges.length);
      const byId = new Map(n.map((row) => [row[0], row]));
      for (const e of g.entities) {
        const row = byId.get(e.id)!;
        expect(row, `seed ${seed}: ${JSON.stringify(e.id)}`).toBeDefined();
        expect(row[1], `seed ${seed}`).toBe(clean(e.name));
        // neo4j-admin splits a string[] on ';' (it has no escape): a ';' inside an alias is written as ','.
        expect(sortStr(row[2] === "" ? [] : row[2].split(";")), `seed ${seed}`).toEqual(sortStr(e.aliases.map((a) => clean(a).replace(/;/g, ","))));
      }
      const relById = new Map(r.map((row) => [row[3], row]));
      for (const x of g.edges) {
        const row = relById.get(x.id)!;
        expect(row, `seed ${seed}: ${JSON.stringify(x.id)}`).toBeDefined();
        expect([row[0], row[1], row[4], row[5], row[6]], `seed ${seed}`).toEqual([x.subject, x.object, x.provenance.note, x.provenance.anchor, clean(x.provenance.quote)]);
      }
    }
  });

  it("every export is well-formed Unicode (no lone surrogate reaches a file)", () => {
    const g = randomGraph(42);
    g.entities[0] = { ...g.entities[0], aliases: ["x\uD800y"] };
    for (const t of [toJsonLd(g), toGraphML(g), toTurtle(g), toNeo4jCsv(g).nodes]) expect(() => asFile(t)).not.toThrow();
  });
});

// ------------------------------------------------------------ n3 (owed until installed)

let n3: { Parser: new (o?: { format?: string }) => { parse(t: string): Array<{ subject: { value: string }; predicate: { value: string }; object: { value: string; termType: string } }> } } | null = null;
try {
  const m = (await import(/* @vite-ignore */ ["n", "3"].join(""))) as { Parser?: unknown; default?: { Parser?: unknown } };
  const Parser = typeof m.Parser === "function" ? m.Parser : m.default?.Parser;
  const probe = typeof Parser === "function" ? ({ Parser } as NonNullable<typeof n3>) : null;
  // A stand-in module (an offline runner stubs unknown packages) is not n3: it must really parse.
  n3 = probe && new probe.Parser({ format: "text/turtle" }).parse("<urn:a> <urn:b> <urn:c> .\n").length === 1 ? probe : null;
} catch {
  n3 = null;
}

describe("W12.E8 Turtle through n3", () => {
  // skip-reason: n3 (MIT) is the plan's Turtle reader for this test only; it is not installed and the registry is offline here. On the Mac: npm i -D n3 && npx vitest run src/__tests__/entityExportRoundTrip.test.ts | task: W12.E8 | until: 2027-05-16
  it.skipIf(!n3)("n3 reads every seed's Turtle and gives the same triples as the grammar reader", () => {
    for (const seed of SEEDS) {
      const text = toTurtle(randomGraph(seed));
      const ours = parseNTriples(text).map(([s, p, o]) => `${s.value} ${p.value} ${o.value}`).sort();
      const theirs = new n3!.Parser({ format: "text/turtle" }).parse(text).map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`).sort();
      expect(theirs, `seed ${seed}`).toEqual(ours);
    }
  });
});
