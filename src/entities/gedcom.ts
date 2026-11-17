/**
 * GEDCOM for the entity graph (plan W13.G7): family trees in and out.
 *
 * Read: GEDCOM 7.0 and 5.5.1 (the format MyHeritage, Ancestry, Gramps and
 * FamilySearch write) — a UTF-8 BOM, CRLF, `CONT` / `CONC` continuations,
 * `@@` escapes, names `Given /Surname/` (Hebrew included), sex, birth and
 * death with date and place (dates kept as written: `ABT 1900`, `HEBREW 1
 * TSH 5660`, `@#DHEBREW@ …`), and families (`HUSB`, `WIFE`, `CHIL`).
 *
 * Into the vault: every individual becomes a person entity note under
 * `ישויות/אנשים/` (two people with one name are told apart by their birth
 * year, then by a number — nobody is lost or merged), with `born`, `died`,
 * `birth-place`, `death-place`, `sex` and `gedcom` (the xref) in its front
 * matter; every family becomes a paragraph of one import note
 * (`ייבוא/GEDCOM …md`, anchored `^gF1`), and its `spouse` and `child` edges
 * are approved edges whose provenance quotes that paragraph — the same
 * contract as every other edge (W12.E1).
 *
 * Write: GEDCOM 7.0 from the person entities and their `spouse` / `child`
 * edges: `HEAD` with `GEDC.VERS 7.0`, `INDI` records with `NAME`, `SEX`,
 * `BIRT` / `DEAT`, `FAMC` / `FAMS`, `FAM` records (one per couple, and one
 * per single parent), `TRLR`; UTF-8, CONT for line breaks, no CONC (7.0
 * dropped it).
 *
 * Pure: the caller reads and writes the files.
 */
import { splitFrontmatter } from "./frontmatter";
import { edgeId, entityId, entityNotePath, type Edge, type Entity } from "./model";
import { makeProvenance } from "./provenance";
import { stringify } from "yaml";

export interface GedLine {
  level: number;
  xref: string | null;
  tag: string;
  value: string;
  children: GedLine[];
}

/** The record tree of a GEDCOM file; `problems` lists lines that do not parse (skipped, never fatal). */
export function parseGedcomLines(text: string): { records: GedLine[]; problems: string[] } {
  const records: GedLine[] = [];
  const problems: string[] = [];
  const stack: GedLine[] = [];
  text
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/)
    .forEach((raw, i) => {
      const line = raw.replace(/^\s+/, "");
      if (!line) return;
      const m = /^(\d{1,2}) (?:(@[^@ ]+@) )?([A-Za-z0-9_]+)(?: (.*))?$/.exec(line);
      if (!m) return void problems.push(`line ${i + 1}: ${raw.slice(0, 40)}`);
      const level = Number(m[1]);
      const node: GedLine = { level, xref: m[2] ?? null, tag: m[3].toUpperCase(), value: (m[4] ?? "").replace(/@@/g, "@"), children: [] };
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      if (level === 0) records.push(node);
      else if (!stack.length || stack[stack.length - 1].level !== level - 1) return void problems.push(`line ${i + 1}: level ${level} out of place`);
      else stack[stack.length - 1].children.push(node);
      stack.push(node);
    });
  // CONT / CONC: fold into the parent's value.
  const fold = (n: GedLine) => {
    const kept: GedLine[] = [];
    for (const c of n.children) {
      if (c.tag === "CONT") n.value += `\n${c.value}`;
      else if (c.tag === "CONC") n.value += c.value;
      else kept.push(c);
    }
    n.children = kept;
    kept.forEach(fold);
  };
  records.forEach(fold);
  return { records, problems };
}

export interface GedPerson {
  xref: string;
  /** "Given Surname" (the slashes dropped). */
  name: string;
  given: string;
  surname: string;
  /** The NAME as written, one line ("Maria /de la Cruz/"): kept so the export writes the surname the file had. Absent: no NAME. */
  rawName?: string;
  sex?: "M" | "F" | "X" | "U";
  /** PEDI of the person's FAMC links (family xref → BIRTH, ADOPTED, FOSTER, SEALING or OTHER), when the file gives one. */
  pedigree?: Record<string, string>;
  born?: string;
  died?: string;
  birthPlace?: string;
  deathPlace?: string;
}

export interface GedFamily {
  xref: string;
  partners: string[];
  children: string[];
}

export interface Gedcom {
  version: string;
  people: GedPerson[];
  families: GedFamily[];
  problems: string[];
}

const sub = (n: GedLine, tag: string) => n.children.find((c) => c.tag === tag);

/** Read a GEDCOM file (7.0 or 5.5.1). */
export function parseGedcom(text: string): Gedcom {
  const { records, problems } = parseGedcomLines(text);
  const head = records.find((r) => r.tag === "HEAD");
  const version = (head && sub(head, "GEDC") && sub(sub(head, "GEDC")!, "VERS")?.value) || "";
  const people: GedPerson[] = [];
  const families: GedFamily[] = [];
  for (const r of records) {
    if (r.tag === "INDI" && r.xref) {
      const nameLine = sub(r, "NAME");
      // One line: a CONT inside a NAME (malformed, or crafted) must not become a line of the note (review-13 M5).
      const oneLine = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
      const raw = oneLine(nameLine?.value);
      const surname = oneLine(/\/([^/]*)\//.exec(raw)?.[1] ?? sub(nameLine ?? r, "SURN")?.value);
      const given = oneLine(raw.replace(/\/[^/]*\//, " ") || sub(nameLine ?? r, "GIVN")?.value);
      // No name in the file: the importer names the person (never the xref, "P9").
      const name = [given, surname].filter(Boolean).join(" ");
      const pedigree: Record<string, string> = {};
      for (const c of r.children) {
        const pedi = c.tag === "FAMC" ? sub(c, "PEDI")?.value.trim().toUpperCase() : undefined;
        if (pedi) pedigree[c.value.trim()] = pedi;
      }
      const sex = sub(r, "SEX")?.value.trim().toUpperCase();
      const event = (tag: string) => {
        const e = sub(r, tag);
        return e ? { date: sub(e, "DATE")?.value.trim() || undefined, place: sub(e, "PLAC")?.value.trim() || undefined } : {};
      };
      const b = event("BIRT");
      const d = event("DEAT");
      people.push({ xref: r.xref, name, given, surname, ...(nameLine ? { rawName: raw } : {}), ...(Object.keys(pedigree).length ? { pedigree } : {}), ...(sex === "M" || sex === "F" || sex === "X" || sex === "U" ? { sex } : {}), ...(b.date ? { born: b.date } : {}), ...(b.place ? { birthPlace: b.place } : {}), ...(d.date ? { died: d.date } : {}), ...(d.place ? { deathPlace: d.place } : {}) });
    } else if (r.tag === "FAM" && r.xref) {
      families.push({
        xref: r.xref,
        partners: r.children.filter((c) => c.tag === "HUSB" || c.tag === "WIFE").map((c) => c.value.trim()),
        children: r.children.filter((c) => c.tag === "CHIL").map((c) => c.value.trim()),
      });
    }
  }
  const known = new Set(people.map((p) => p.xref));
  for (const f of families) for (const x of [...f.partners, ...f.children]) if (!known.has(x)) problems.push(`${f.xref}: ${x} is not an individual`);
  return { version, people, families, problems };
}

/** A year from a GEDCOM date, when it is a Gregorian one ("ABT 1900", "1 JAN 1900", "BET 1890 AND 1900" → its first year). */
export function gedcomYear(date: string | undefined): string | null {
  if (!date || /HEBREW|@#D(?!GREGORIAN)/i.test(date)) return null;
  return /\b(\d{3,4})\b/.exec(date)?.[1] ?? null;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** An exact Gregorian GEDCOM date ("1 JAN 1900") as ISO, else null. */
export function gedcomIso(date: string | undefined): string | null {
  const m = /^(\d{1,2}) ([A-Z]{3}) (\d{4})$/.exec((date ?? "").trim().toUpperCase());
  if (!m || !MONTHS.includes(m[2])) return null;
  return `${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export interface ImportPlan {
  /** Path → content of every file to create (entity notes and the import note) or change (edges.jsonl). */
  files: Map<string, string>;
  entities: Entity[];
  edges: Edge[];
  /** xref → entity id: every individual of the file has one (0 lost). */
  idOf: Map<string, string>;
  problems: string[];
}

export interface ImportOptions {
  /** The GEDCOM file's name, for the import note. */
  fileName: string;
  /** Entity ids already in the vault (a new person never takes one). */
  taken?: ReadonlySet<string>;
  date?: Date;
  /** Labels of the import note (localised by the caller). */
  labels?: { title: string; family: string; children: string; unnamed?: string };
}

/**
 * A FAMC link the edges cannot carry, kept in the child's front matter
 * (`gedcom-famc`) for the export: a family with children and no known
 * partner (siblings of unknown parents), or a PEDI (adopted, foster, …).
 * `parents` are the family's partners' xrefs (without @).
 */
export interface FamcLink {
  family: string;
  parents: string[];
  pedigree?: string;
}

/** A string YAML reads back as the same string when written bare: a word-like name, a place, an ISO date. */
const PLAIN = /^(?:\d{4}-\d{2}-\d{2}|[\p{L}][\p{L}\p{M}\p{N} ._'\u05F3\u05F4-]*[\p{L}\p{M}\p{N}.)]?)$/u;
const RESERVED = /^(?:true|false|null|yes|no|on|off|y|n|~)$/i;
/**
 * The front matter block. Simple scalars are written directly; anything
 * else goes through the YAML library. `stringify` per note was ~0.4 ms, the
 * bulk of a 30,000-person import (review-13 M5).
 */
const yamlBlock = (props: Record<string, unknown>) => {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === "string" && PLAIN.test(v) && !RESERVED.test(v) && !/\s$/.test(v)) lines.push(`${k}: ${v}`);
    else if (typeof v === "string" && v === "") lines.push(`${k}: ""`);
    else lines.push(stringify({ [k]: v }, { lineWidth: 0 }).trimEnd());
  }
  return `---\n${lines.join("\n")}\n---\n`;
};

/** What importing `ged` writes: an entity note per person, an import note, and the approved edges. */
export function planGedcomImport(ged: Gedcom, opts: ImportOptions): ImportPlan {
  const labels = { title: "GEDCOM import", family: "Family", children: "children", unnamed: "Unnamed", ...opts.labels };
  const taken = new Set(opts.taken ?? []);
  const idOf = new Map<string, string>();
  const entities: Entity[] = [];
  const files = new Map<string, string>();
  const byXref = new Map(ged.people.map((p) => [p.xref, p]));
  const bare = (x: string) => x.replace(/@/g, "");
  // The FAMC links the edges cannot carry (see FamcLink): per child xref.
  const famcOf = new Map<string, FamcLink[]>();
  for (const f of ged.families) {
    const parents = f.partners.filter((x) => byXref.has(x));
    for (const c of f.children) {
      const pedigree = byXref.get(c)?.pedigree?.[f.xref];
      if (!byXref.has(c) || (parents.length && !pedigree)) continue;
      (famcOf.get(c) ?? famcOf.set(c, []).get(c)!).push({ family: bare(f.xref), parents: parents.map(bare), ...(pedigree ? { pedigree } : {}) });
    }
  }
  const entityOf = new Map<string, Entity>();
  for (const p of ged.people) {
    // A unique name: the name, then with the birth year, then numbered.
    const year = gedcomYear(p.born);
    const own = p.name || labels.unnamed;
    let name = own;
    if (taken.has(entityId("person", name)) && year) name = `${own} (${year})`;
    for (let k = 2; taken.has(entityId("person", name)); k++) name = `${own} (${year ? `${year}, ` : ""}${k})`;
    const id = entityId("person", name);
    taken.add(id);
    idOf.set(p.xref, id);
    const e: Entity = { id, type: "person", name, aliases: name !== own ? [own] : [] };
    entityOf.set(p.xref, e);
    entities.push(e);
    const props: Record<string, unknown> = { type: "person", "entity-type": "person" };
    if (e.aliases.length) props.aliases = e.aliases;
    if (p.sex) props.sex = p.sex;
    if (p.born) props.born = gedcomIso(p.born) ?? p.born;
    if (p.birthPlace) props["birth-place"] = p.birthPlace;
    if (p.died) props.died = gedcomIso(p.died) ?? p.died;
    if (p.deathPlace) props["death-place"] = p.deathPlace;
    props.gedcom = bare(p.xref);
    // The NAME as the file wrote it (its /surname/), "" for none; a nameless person also keeps the label it was given.
    props["gedcom-name"] = p.name ? (p.rawName ?? "") : "";
    if (!p.name) props["gedcom-label"] = own;
    const famc = famcOf.get(p.xref);
    if (famc) props["gedcom-famc"] = famc;
    files.set(entityNotePath(e), `${yamlBlock(props)}\n# ${name}\n`);
  }
  // The import note: one paragraph per family, which every edge of that family quotes.
  const notePath = `ייבוא/GEDCOM ${opts.fileName.replace(/\.ged(com)?$/i, "").replace(/[\\/:*?"<>|#^[\]]/g, " ").trim() || "family"}.md`;
  // Maps, not finds (review-13 M5: the import was quadratic, ~minutes for 10,000 families).
  const nameOf = (x: string) => entityOf.get(x)?.name ?? x;
  const paras: string[] = [];
  const edges: Edge[] = [];
  const edgeIds = new Set<string>();
  const problems = [...ged.problems];
  const date = opts.date ?? new Date();
  for (const f of ged.families) {
    const partners = f.partners.filter((x) => byXref.has(x));
    const children = f.children.filter((x) => byXref.has(x));
    if (!partners.length && !children.length) continue;
    const anchor = `g${f.xref.replace(/[^A-Za-z0-9]/g, "")}`;
    const text = `${labels.family} ${f.xref.replace(/@/g, "")}: ${partners.map(nameOf).join(" + ") || "?"}${children.length ? `; ${labels.children}: ${children.map(nameOf).join(", ")}` : ""}.`;
    paras.push(`${text} ^${anchor}`);
    // The quote: the paragraph, cut at a word within the 400 characters a quote may have.
    let quote = text.replace(/\.$/, "");
    if (quote.length > 400) quote = quote.slice(0, 400).replace(/[\s,;:+]+\S*$/, "");
    const prov = makeProvenance({ note: notePath, anchor, paragraph: text, quote, extractor: "gedcom@7", model: null, date });
    const add = (s: string, p: string, o: string) => {
      const e: Edge = { id: edgeId(s, p, o, notePath, anchor), subject: s, predicate: p, object: o, provenance: prov, confidence: 1, status: "approved" };
      if (!edgeIds.has(e.id)) (edgeIds.add(e.id), edges.push(e));
    };
    for (let i = 0; i < partners.length; i++) for (let j = i + 1; j < partners.length; j++) add(idOf.get(partners[i])!, "spouse", idOf.get(partners[j])!);
    for (const p of partners) for (const c of children) add(idOf.get(p)!, "child", idOf.get(c)!);
  }
  files.set(notePath, `${yamlBlock({ source: opts.fileName, imported: date.toISOString().slice(0, 10), gedcom: ged.version || "?" })}\n# ${labels.title}: ${opts.fileName}\n\n${paras.join("\n\n")}\n`);
  return { files, entities, edges, idOf, problems };
}

export interface ExportPerson {
  entity: Entity;
  /** The entity note's front matter (sex, born, died, birth-place, death-place). */
  props?: Record<string, unknown>;
}

const gedDate = (v: unknown): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (iso) return `${Number(iso[3])} ${MONTHS[Number(iso[2]) - 1]} ${iso[1]}`;
  // 5.5.1 calendar escapes become 7.0 calendar names ("@#DHEBREW@ 1 TSH 5665" → "HEBREW 1 TSH 5665").
  return v
    .trim()
    .replace(/@#D(HEBREW|JULIAN|GREGORIAN|FRENCH R)@\s*/gi, (_, c: string) => (c.toUpperCase() === "GREGORIAN" ? "" : `${c.toUpperCase().replace(" ", "_")} `));
};
/** One GEDCOM payload line, with CONT for line breaks and `@` doubled at the start (7.0). */
const line = (level: number, tag: string, value?: string, xref?: string): string[] => {
  const parts = (value ?? "").split(/\r?\n/);
  const esc = (v: string) => (/^@[A-Z0-9_]+@$/.test(v) ? v : v.replace(/^@/, "@@")); // a pointer stays as it is
  const head = `${level}${xref ? ` ${xref}` : ""} ${tag}${value !== undefined && value !== "" ? ` ${esc(parts[0])}` : ""}`;
  return [head, ...parts.slice(1).map((p) => `${level + 1} CONT${p ? ` ${p.replace(/^@/, "@@")}` : ""}`)];
};

const PEDI = new Set(["ADOPTED", "BIRTH", "FOSTER", "SEALING", "OTHER"]);

/** The NAME to write: the file's own (with its /surname/) while the person's name is still the one it gives, else "Given /Last/". Null: no NAME. */
function nameValue(name: string, props: Record<string, unknown>): string | null {
  const raw = props["gedcom-name"];
  if (typeof raw === "string") {
    if (raw === "") {
      if (name === props["gedcom-label"]) return null; // nameless in the file, and not renamed since
    } else {
      const surname = /\/([^/]*)\//.exec(raw)?.[1]?.trim() ?? "";
      const given = raw.replace(/\/[^/]*\//, " ").replace(/\s+/g, " ").trim();
      if ([given, surname].filter(Boolean).join(" ") === name) return raw;
    }
  }
  const parts = name.trim().split(/\s+/);
  const surname = parts.length > 1 ? parts.pop()! : "";
  return surname ? `${parts.join(" ")} /${surname}/` : parts.join(" ");
}

const famcLinks = (v: unknown): FamcLink[] =>
  Array.isArray(v)
    ? v.filter((x): x is FamcLink => !!x && typeof x === "object" && typeof (x as FamcLink).family === "string").map((x) => ({ family: String(x.family), parents: Array.isArray(x.parents) ? x.parents.map(String) : [], ...(typeof x.pedigree === "string" ? { pedigree: x.pedigree } : {}) }))
    : [];

/** GEDCOM 7.0 of the people and their spouse / child edges. */
export function exportGedcom(people: readonly ExportPerson[], edges: readonly Edge[], opts: { date?: Date; source?: string } = {}): string {
  const ids = new Map(people.map((p, i) => [p.entity.id, `@I${i + 1}@`]));
  const propsOf = new Map(people.map((p) => [p.entity.id, p.props ?? {}]));
  // The xref each person had in the file it came from (front matter `gedcom`), for its kept FAMC links.
  const byOldXref = new Map<string, string>();
  for (const p of people) if (typeof p.props?.gedcom === "string" || typeof p.props?.gedcom === "number") byOldXref.set(String(p.props.gedcom), p.entity.id);
  const rel = edges.filter((e) => e.status === "approved" && ids.has(e.subject) && ids.has(e.object) && (e.predicate === "spouse" || e.predicate === "child"));
  const parentsOf = new Map<string, Set<string>>();
  for (const e of rel) if (e.predicate === "child") (parentsOf.get(e.object) ?? parentsOf.set(e.object, new Set()).get(e.object)!).add(e.subject);
  // Families: every couple, then every parent set of a child that is not a known couple.
  const fams = new Map<string, { partners: string[]; children: Set<string> }>();
  const key = (ps: string[]) => [...ps].sort().join("|");
  for (const e of rel) if (e.predicate === "spouse") {
    const k = key([e.subject, e.object]);
    if (!fams.has(k)) fams.set(k, { partners: [e.subject, e.object].sort(), children: new Set() });
  }
  for (const [child, ps] of parentsOf) {
    const list = [...ps].sort();
    // A child of two known parents belongs to their couple's family; of one, to a single-parent family.
    const k = key(list);
    (fams.get(k) ?? fams.set(k, { partners: list, children: new Set() }).get(k)!).children.add(child);
  }
  // The links the edges cannot carry (audit r4 A3 #8): siblings of unknown parents (a FAM with CHIL only), and PEDI.
  const pedigreeOf = new Map<string, string>(); // `${child}\u0000${family key}` → PEDI
  for (const p of people) {
    for (const l of famcLinks(p.props?.["gedcom-famc"])) {
      const parents = l.parents.map((x) => byOldXref.get(x)).filter((x): x is string => !!x);
      if (parents.length !== l.parents.length) continue; // a parent is not in this export
      const k = parents.length ? key(parents) : `chil:${l.family}`;
      if (!parents.length) (fams.get(k) ?? fams.set(k, { partners: [], children: new Set() }).get(k)!).children.add(p.entity.id);
      if (l.pedigree && fams.get(k)?.children.has(p.entity.id)) pedigreeOf.set(`${p.entity.id}\u0000${k}`, l.pedigree.toUpperCase());
    }
  }
  const famList = [...fams.entries()];
  const famId = new Map(famList.map(([k], i) => [k, `@F${i + 1}@`]));
  const famcOf = new Map<string, string[]>();
  const famsOf = new Map<string, string[]>();
  for (const [k, f] of famList) {
    for (const c of f.children) (famcOf.get(c) ?? famcOf.set(c, []).get(c)!).push(k);
    for (const p of f.partners) (famsOf.get(p) ?? famsOf.set(p, []).get(p)!).push(k);
  }
  const out: string[] = [];
  out.push("0 HEAD", "1 GEDC", "2 VERS 7.0", "1 SOUR LUMEN", "2 NAME Lumen", "1 DATE " + gedDate((opts.date ?? new Date()).toISOString().slice(0, 10)));
  out.push("1 LANG he");
  for (const p of people) {
    const id = ids.get(p.entity.id)!;
    const pr = p.props ?? {};
    out.push(...line(0, "INDI", undefined, id));
    // A name told apart on import ("דוד כהן (1900)") goes out as the person's own name, kept as the first alias.
    const own = p.entity.aliases[0];
    const name = (own && p.entity.name.startsWith(own) ? own : p.entity.name).replace(/\s+/g, " ").trim();
    const nv = nameValue(name, pr);
    if (nv !== null) out.push(...line(1, "NAME", nv));
    if (["M", "F", "X", "U"].includes(String(pr.sex ?? "").toUpperCase())) out.push(...line(1, "SEX", String(pr.sex).toUpperCase()));
    for (const [tag, d, pl] of [["BIRT", pr.born, pr["birth-place"]], ["DEAT", pr.died, pr["death-place"]]] as const) {
      const date = gedDate(d);
      const place = typeof pl === "string" && pl.trim() ? pl.trim() : null;
      if (!date && !place) continue;
      out.push(...line(1, tag));
      if (date) out.push(...line(2, "DATE", date));
      if (place) out.push(...line(2, "PLAC", place));
    }
    for (const k of famcOf.get(p.entity.id) ?? []) {
      out.push(...line(1, "FAMC", famId.get(k)!));
      const pedi = pedigreeOf.get(`${p.entity.id}\u0000${k}`);
      if (pedi) {
        out.push(...line(2, "PEDI", PEDI.has(pedi) ? pedi : "OTHER"));
        if (!PEDI.has(pedi)) out.push(...line(3, "PHRASE", pedi));
      }
    }
    for (const k of famsOf.get(p.entity.id) ?? []) out.push(...line(1, "FAMS", famId.get(k)!));
  }
  const sexOf = (id: string) => String(propsOf.get(id)?.sex ?? "").toUpperCase();
  for (const [k, f] of famList) {
    out.push(...line(0, "FAM", undefined, famId.get(k)!));
    // GEDCOM 7: HUSB and WIFE are the two partner slots; a man goes first, a single mother is WIFE.
    const ordered = [...f.partners].sort((a, b) => Number(sexOf(b) === "M") - Number(sexOf(a) === "M") || Number(sexOf(a) === "F") - Number(sexOf(b) === "F"));
    if (ordered.length === 1) out.push(...line(1, sexOf(ordered[0]) === "F" ? "WIFE" : "HUSB", ids.get(ordered[0])!));
    else ordered.slice(0, 2).forEach((p, i) => out.push(...line(1, i === 0 ? "HUSB" : "WIFE", ids.get(p)!)));
    for (const c of [...f.children].sort((a, b) => ids.get(a)!.localeCompare(ids.get(b)!, "en", { numeric: true }))) out.push(...line(1, "CHIL", ids.get(c)!));
  }
  out.push("0 TRLR");
  return out.join("\n") + "\n";
}

/** The person entities of a vault with their notes' front matter, for the export and the tree. */
export function peopleOf(entities: readonly Entity[], noteOf: ReadonlyMap<string, string>, texts: ReadonlyMap<string, string>): ExportPerson[] {
  return entities.filter((e) => e.type === "person").map((entity) => {
    const path = noteOf.get(entity.id);
    const text = path ? texts.get(path) : undefined;
    return { entity, props: text ? splitFrontmatter(text).props : {} };
  });
}
