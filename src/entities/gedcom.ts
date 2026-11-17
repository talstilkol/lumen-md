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
  sex?: "M" | "F" | "X" | "U";
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
      const raw = (nameLine?.value ?? "").trim();
      const surname = (/\/([^/]*)\//.exec(raw)?.[1] ?? sub(nameLine ?? r, "SURN")?.value ?? "").trim();
      const given = (raw.replace(/\/[^/]*\//, " ").replace(/\s+/g, " ").trim() || sub(nameLine ?? r, "GIVN")?.value || "").trim();
      const name = [given, surname].filter(Boolean).join(" ") || r.xref.replace(/@/g, "");
      const sex = sub(r, "SEX")?.value.trim().toUpperCase();
      const event = (tag: string) => {
        const e = sub(r, tag);
        return e ? { date: sub(e, "DATE")?.value.trim() || undefined, place: sub(e, "PLAC")?.value.trim() || undefined } : {};
      };
      const b = event("BIRT");
      const d = event("DEAT");
      people.push({ xref: r.xref, name, given, surname, ...(sex === "M" || sex === "F" || sex === "X" || sex === "U" ? { sex } : {}), ...(b.date ? { born: b.date } : {}), ...(b.place ? { birthPlace: b.place } : {}), ...(d.date ? { died: d.date } : {}), ...(d.place ? { deathPlace: d.place } : {}) });
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
  labels?: { title: string; family: string; children: string };
}

const yamlBlock = (props: Record<string, unknown>) => `---\n${stringify(props, { lineWidth: 0 }).trimEnd()}\n---\n`;

/** What importing `ged` writes: an entity note per person, an import note, and the approved edges. */
export function planGedcomImport(ged: Gedcom, opts: ImportOptions): ImportPlan {
  const labels = opts.labels ?? { title: "GEDCOM import", family: "Family", children: "children" };
  const taken = new Set(opts.taken ?? []);
  const idOf = new Map<string, string>();
  const entities: Entity[] = [];
  const files = new Map<string, string>();
  const byXref = new Map(ged.people.map((p) => [p.xref, p]));
  for (const p of ged.people) {
    // A unique name: the name, then with the birth year, then numbered.
    const year = gedcomYear(p.born);
    let name = p.name;
    if (taken.has(entityId("person", name)) && year) name = `${p.name} (${year})`;
    for (let k = 2; taken.has(entityId("person", name)); k++) name = `${p.name} (${year ? `${year}, ` : ""}${k})`;
    const id = entityId("person", name);
    taken.add(id);
    idOf.set(p.xref, id);
    const e: Entity = { id, type: "person", name, aliases: name !== p.name ? [p.name] : [] };
    entities.push(e);
    const props: Record<string, unknown> = { type: "person", "entity-type": "person" };
    if (e.aliases.length) props.aliases = e.aliases;
    if (p.sex) props.sex = p.sex;
    if (p.born) props.born = gedcomIso(p.born) ?? p.born;
    if (p.birthPlace) props["birth-place"] = p.birthPlace;
    if (p.died) props.died = gedcomIso(p.died) ?? p.died;
    if (p.deathPlace) props["death-place"] = p.deathPlace;
    props.gedcom = p.xref.replace(/@/g, "");
    files.set(entityNotePath(e), `${yamlBlock(props)}\n# ${name}\n`);
  }
  // The import note: one paragraph per family, which every edge of that family quotes.
  const notePath = `ייבוא/GEDCOM ${opts.fileName.replace(/\.ged(com)?$/i, "").replace(/[\\/:*?"<>|#^[\]]/g, " ").trim() || "family"}.md`;
  const nameOf = (x: string) => entities.find((e) => e.id === idOf.get(x))?.name ?? x;
  const paras: string[] = [];
  const edges: Edge[] = [];
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
      if (!edges.some((x) => x.id === e.id)) edges.push(e);
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

/** GEDCOM 7.0 of the people and their spouse / child edges. */
export function exportGedcom(people: readonly ExportPerson[], edges: readonly Edge[], opts: { date?: Date; source?: string } = {}): string {
  const ids = new Map(people.map((p, i) => [p.entity.id, `@I${i + 1}@`]));
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
  const famList = [...fams.values()];
  const famId = new Map(famList.map((f, i) => [f, `@F${i + 1}@`]));
  const out: string[] = [];
  out.push("0 HEAD", "1 GEDC", "2 VERS 7.0", "1 SOUR LUMEN", "2 NAME Lumen", "1 DATE " + gedDate((opts.date ?? new Date()).toISOString().slice(0, 10)));
  out.push("1 LANG he");
  for (const p of people) {
    const id = ids.get(p.entity.id)!;
    const pr = p.props ?? {};
    out.push(...line(0, "INDI", undefined, id));
    // A name told apart on import ("דוד כהן (1900)") goes out as the person's own name, kept as the first alias.
    const own = p.entity.aliases[0];
    const name = own && p.entity.name.startsWith(own) ? own : p.entity.name;
    const parts = name.trim().split(/\s+/);
    const surname = parts.length > 1 ? parts.pop()! : "";
    out.push(...line(1, "NAME", surname ? `${parts.join(" ")} /${surname}/` : parts.join(" ")));
    if (["M", "F", "X", "U"].includes(String(pr.sex ?? "").toUpperCase())) out.push(...line(1, "SEX", String(pr.sex).toUpperCase()));
    for (const [tag, d, pl] of [["BIRT", pr.born, pr["birth-place"]], ["DEAT", pr.died, pr["death-place"]]] as const) {
      const date = gedDate(d);
      const place = typeof pl === "string" && pl.trim() ? pl.trim() : null;
      if (!date && !place) continue;
      out.push(...line(1, tag));
      if (date) out.push(...line(2, "DATE", date));
      if (place) out.push(...line(2, "PLAC", place));
    }
    for (const f of famList) if (f.children.has(p.entity.id)) out.push(...line(1, "FAMC", famId.get(f)!));
    for (const f of famList) if (f.partners.includes(p.entity.id)) out.push(...line(1, "FAMS", famId.get(f)!));
  }
  for (const f of famList) {
    out.push(...line(0, "FAM", undefined, famId.get(f)!));
    const sexOf = (id: string) => String(people.find((p) => p.entity.id === id)?.props?.sex ?? "").toUpperCase();
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
