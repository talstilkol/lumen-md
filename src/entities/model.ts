/**
 * The entity graph's data model (plan W12.E1).
 *
 * - Seven entity types. An approved entity is a plain Markdown note under
 *   `ישויות/<type folder>/`, so Obsidian opens it as any other note.
 * - A relation is a triple (subject, predicate, object) whose predicate
 *   comes from a fixed list in code (a subset of Wikidata properties).
 * - Every edge carries provenance: the note, the `^id` paragraph anchor
 *   (plan 4.8), the exact quote, the paragraph's hash, the extractor and
 *   model with their versions, and the date. An edge without it is
 *   rejected (`validateEdge`), and an edge whose paragraph changed is
 *   marked "source changed" (`staleness.ts`), never shown as if it still
 *   had a basis.
 *
 * Proposals live in `.lumen/entities/proposals.jsonl`, apart from the
 * approved entities; nothing is written to a note without approval.
 *
 * Design reference only: IsraelConnect's claim model (a verbatim quote
 * with its hash between the source and the claim; unknown dates left
 * empty). This is a clean implementation; no code, schema or data of
 * IsraelConnect is copied or adapted here.
 */

export const ENTITY_TYPES = ["person", "place", "organization", "event", "law", "source", "concept"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface EntityTypeInfo {
  id: EntityType;
  he: string;
  en: string;
  /** The folder under `ישויות/` its approved notes go into. */
  folder: string;
  /** schema.org class for JSON-LD export (W12.E8). */
  schema: string;
}

export const ENTITY_ROOT = "ישויות";

export const TYPE_INFO: Record<EntityType, EntityTypeInfo> = {
  person: { id: "person", he: "אדם", en: "Person", folder: "אנשים", schema: "Person" },
  place: { id: "place", he: "מקום", en: "Place", folder: "מקומות", schema: "Place" },
  organization: { id: "organization", he: "ארגון", en: "Organization", folder: "ארגונים", schema: "Organization" },
  event: { id: "event", he: "אירוע/תאריך", en: "Event / date", folder: "אירועים", schema: "Event" },
  law: { id: "law", he: "חוק", en: "Law", folder: "חוקים", schema: "Legislation" },
  source: { id: "source", he: "מקור/פסוק", en: "Source / verse", folder: "מקורות", schema: "CreativeWork" },
  concept: { id: "concept", he: "מושג", en: "Concept", folder: "מושגים", schema: "DefinedTerm" },
};

export const isEntityType = (v: unknown): v is EntityType => typeof v === "string" && (ENTITY_TYPES as readonly string[]).includes(v);

export interface PredicateInfo {
  id: string;
  /** The Wikidata property it stands for, when there is one. */
  wikidata: string | null;
  he: string;
  en: string;
  /** Subject types allowed; null = any. */
  domain: readonly EntityType[] | null;
  /** Object types allowed; null = any. */
  range: readonly EntityType[] | null;
}

const P = (id: string, wikidata: string | null, he: string, en: string, domain: readonly EntityType[] | null, range: readonly EntityType[] | null): PredicateInfo => ({ id, wikidata, he, en, domain, range });

/**
 * The fixed predicate list. A relation the extractor proposes that is not
 * here is rejected (W12.E4). Wikidata ids from its property pages.
 */
export const PREDICATES: readonly PredicateInfo[] = [
  P("born_in", "P19", "נולד ב", "born in", ["person"], ["place"]),
  P("died_in", "P20", "נפטר ב", "died in", ["person"], ["place"]),
  P("member_of", "P463", "חבר ב", "member of", ["person", "organization"], ["organization"]),
  P("employer", "P108", "מועסק ב", "works for", ["person"], ["organization"]),
  P("position_held", "P39", "מכהן כ", "position held", ["person"], ["concept", "organization"]),
  P("located_in", "P131", "נמצא ב", "located in", ["place", "organization", "event"], ["place"]),
  P("part_of", "P361", "חלק מ", "part of", null, null),
  P("participant_in", "P1344", "השתתף ב", "participant in", ["person", "organization"], ["event"]),
  P("point_in_time", "P585", "התרחש ב", "point in time", ["event"], ["event"]),
  P("enacted_by", "P790", "נחקק על ידי", "enacted by", ["law"], ["organization", "person"]),
  P("amends", "P2568", "מתקן את", "amends", ["law"], ["law"]),
  P("cites", "P2860", "מצטט", "cites", ["source", "law", "person", "organization"], ["source", "law"]),
  P("author", "P50", "נכתב על ידי", "author", ["source", "law"], ["person", "organization"]),
  P("main_subject", "P921", "עוסק ב", "main subject", ["source", "event", "law"], null),
  P("founded_by", "P112", "נוסד על ידי", "founded by", ["organization", "place"], ["person", "organization"]),
  P("headquarters", "P159", "מטה ב", "headquarters", ["organization"], ["place"]),
  P("spouse", "P26", "בן/בת זוג של", "spouse", ["person"], ["person"]),
  P("child", "P40", "הורה של", "child", ["person"], ["person"]),
  P("student_of", "P1066", "תלמיד של", "student of", ["person"], ["person"]),
  P("related_to", null, "קשור ל", "related to", null, null),
];

const BY_ID = new Map(PREDICATES.map((p) => [p.id, p]));
export const predicateInfo = (id: string): PredicateInfo | undefined => BY_ID.get(id);
export const isPredicate = (v: unknown): v is string => typeof v === "string" && BY_ID.has(v);

export interface Entity {
  /** Stable id: `<type>:<slug>` (see `entityId`). */
  id: string;
  type: EntityType;
  /** The preferred name, as the user writes it. */
  name: string;
  /** Other names: Hebrew and English forms, abbreviations (״רמב״ם״). */
  aliases: string[];
  /** Optional Wikidata QID (W12.E10, opt-in). */
  qid?: string;
}

/** Where an edge comes from — required on every edge. */
export interface Provenance {
  /** Vault path of the note the edge was read from. */
  note: string;
  /** The paragraph's `^id` anchor (plan 4.8); created when missing. */
  anchor: string;
  /** Word-for-word quote from that paragraph. */
  quote: string;
  /** `sha256:<hex>` of the paragraph text (see `paragraphs.ts`). */
  paragraphHash: string;
  /** What produced it: `rules@1`, `dictabert-ner@…`, `user`, … */
  extractor: string;
  /** Model and version, or null for rules and the user. */
  model: string | null;
  /** ISO 8601 date-time it was extracted. */
  date: string;
}

export type EdgeStatus = "proposed" | "approved" | "rejected";

export interface Edge {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  provenance: Provenance;
  /** 0..1; rules give 1. */
  confidence: number;
  status: EdgeStatus;
  /** Optional ISO date the relation holds at (an event's date), for the time slider (W12.E7). */
  when?: string;
}

/** `<type>:<slug>`: NFC, lower-case, spaces to `-`; Hebrew kept as written. */
export function entityId(type: EntityType, name: string): string {
  const slug = name
    .normalize("NFC")
    .replace(/[֑-ׇ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s/\\:#?%]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${type}:${slug || "_"}`;
}

export const typeOfId = (id: string): EntityType | null => {
  const t = id.slice(0, id.indexOf(":"));
  return isEntityType(t) ? t : null;
};

/** Edge id: the same triple from the same paragraph is the same edge. */
export function edgeId(subject: string, predicate: string, object: string, note: string, anchor: string): string {
  return `${subject}|${predicate}|${object}|${note}#^${anchor}`;
}

/** The vault path of an approved entity's note. */
export function entityNotePath(e: Pick<Entity, "type" | "name">): string {
  const safe = e.name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim() || "ללא שם";
  return `${ENTITY_ROOT}/${TYPE_INFO[e.type].folder}/${safe}.md`;
}
