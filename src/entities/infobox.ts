/**
 * An entity's infobox (plan W13.G6), the way Wikipedia made it standard:
 * a card with the name, the type, a picture, the type's fields (W12.T1) and
 * the five key relations. One model for the two places it shows — embedded
 * as `![[Entity]]` and as the hover card of a mention.
 *
 * - Fields: per type, the type's relation fields (born in, works for,
 *   headquarters, …) from the entity note's front matter and from the
 *   approved relations; plus the scalar fields people write for that type
 *   (born, died, founded, population, website, …) when the note has them.
 * - Key relations: the entities not already in a field, one each, ranked by
 *   status (approved first), confidence, how often the pair is cited and how
 *   connected the other entity is; five at most.
 * - Picture: `image:` (or `cover:`, `תמונה:`) in the front matter, else the
 *   first image embedded in the note.
 *
 * Pure: the note's text and the edges come in, the model goes out.
 */
import { splitFrontmatter } from "./frontmatter";
import { ENTITY_ROOT, PREDICATES, TYPE_INFO, type Edge, type Entity, type EntityType } from "./model";
import { compareNames } from "../i18n/collate";

/** The folders entity notes live in (`ישויות/<folder>/<name>.md`). The embed check in the renderer mirrors this list. */
export const ENTITY_FOLDERS = Object.values(TYPE_INFO).map((t) => t.folder);

export interface InfoValue {
  text: string;
  /** The entity it names, when it is one (a link in the card). */
  id?: string;
}

export interface InfoRow {
  /** i18n key of the row's label. */
  label: string;
  values: InfoValue[];
}

export interface KeyRelation {
  edge: Edge;
  other: string;
  /** The relation reads entity → other. */
  outgoing: boolean;
  /** How many relations join the two (the card shows the strongest). */
  count: number;
}

export interface InfoboxModel {
  entity: Entity;
  image: string | null;
  rows: InfoRow[];
  key: KeyRelation[];
  /** Names of the entities the card mentions. */
  names: Map<string, string>;
}

/** Scalar fields shown per type, in order: [front matter keys (any of), i18n label key]. */
const SCALARS: Record<EntityType, Array<[readonly string[], string]>> = {
  person: [
    [["born", "birth", "birth-date", "date-of-birth", "נולד", "לידה"], "entityGraph.infobox.born"],
    [["died", "death", "death-date", "date-of-death", "נפטר", "פטירה"], "entityGraph.infobox.died"],
    [["occupation", "role", "עיסוק", "תפקיד"], "entityGraph.infobox.occupation"],
  ],
  place: [
    [["country", "מדינה"], "entityGraph.infobox.country"],
    [["population", "אוכלוסייה"], "entityGraph.infobox.population"],
    [["location", "coordinates", "coords", "מיקום"], "entityGraph.infobox.location"],
    [["founded", "נוסד", "הוקם"], "entityGraph.infobox.founded"],
  ],
  organization: [
    [["founded", "נוסד", "הוקם"], "entityGraph.infobox.founded"],
    [["industry", "kind", "תחום"], "entityGraph.infobox.industry"],
    [["website", "url", "אתר"], "entityGraph.infobox.website"],
  ],
  event: [
    [["date", "start", "תאריך", "התחלה"], "entityGraph.infobox.date"],
    [["end", "סיום"], "entityGraph.infobox.end"],
  ],
  law: [
    [["enacted", "date", "נחקק", "תאריך"], "entityGraph.infobox.enacted"],
    [["status", "מעמד"], "entityGraph.infobox.status"],
  ],
  source: [
    [["author", "מחבר"], "entityGraph.infobox.author"],
    [["year", "date", "שנה"], "entityGraph.infobox.date"],
  ],
  concept: [[["field", "domain", "תחום"], "entityGraph.infobox.field"]],
};

const IMAGE_KEYS = ["image", "cover", "picture", "photo", "תמונה"];
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** Is this vault path an entity note? (The renderer's embed check uses the same rule.) */
export const isEntityNotePath = (path: string) => {
  const m = new RegExp(`^${ENTITY_ROOT}/([^/]+)/[^/]+\\.md$`, "i").exec(path);
  return !!m && ENTITY_FOLDERS.includes(m[1]);
};

const asText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
};
const unlink = (s: string) => s.replace(/^!?\[\[|\]\]$/g, "").split("|")[0].trim();

/** The picture's vault path or URL, from the front matter or the first embedded image. */
export function infoboxImage(props: Record<string, unknown>, body: string): string | null {
  for (const k of IMAGE_KEYS) {
    const v = asText(Array.isArray(props[k]) ? (props[k] as unknown[])[0] : props[k]);
    if (v) return unlink(v);
  }
  for (const m of body.matchAll(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]|!\[[^\]]*\]\(([^)\s]+)/g)) {
    const p = (m[1] ?? m[2] ?? "").trim();
    if (IMAGE_EXT.test(p)) return p;
  }
  return null;
}

/**
 * Relations a reader expects in the card even though their object may be of
 * several types (so the type registry keeps them as plain properties): who
 * founded an organization, who wrote a source, who enacted a law.
 */
const CARD_RELATIONS: Partial<Record<EntityType, readonly string[]>> = {
  organization: ["founded_by"],
  place: ["founded_by", "part_of"],
  law: ["enacted_by"],
  source: ["author", "main_subject"],
  event: ["part_of", "main_subject"],
  concept: ["part_of"],
};

/** The card's relation fields for a type: the extras above, then the type's relation fields (W12.T1: one object type). */
export const relationFields = (type: EntityType) => {
  const own = PREDICATES.filter((p) => (!p.domain || p.domain.includes(type)) && p.range && p.range.length === 1).map((p) => p.id);
  const extra = CARD_RELATIONS[type] ?? [];
  // Founder / author / enacted by read first, as in Wikipedia's cards.
  return [...extra, ...own.filter((p) => !extra.includes(p))];
};

export interface InfoboxInput {
  entity: Entity;
  /** The entity note's text, when there is one. */
  noteText?: string;
  edges: readonly Edge[];
  /** Name of an entity id (unknown ids show their slug). */
  nameOf: (id: string) => string | undefined;
  /** Id of an entity by its name (front matter links are names). */
  idOf?: (name: string) => string | undefined;
  /** At most this many key relations (5). */
  maxKey?: number;
}

const slugName = (id: string) => id.slice(id.indexOf(":") + 1).replace(/-/g, " ");

export function infoboxModel(input: InfoboxInput): InfoboxModel {
  const { entity, edges } = input;
  const name = (id: string) => input.nameOf(id) ?? slugName(id);
  const { props, body } = input.noteText ? splitFrontmatter(input.noteText) : { props: {} as Record<string, unknown>, body: "" };
  const rows: InfoRow[] = [];
  const lower = new Map(Object.entries(props).map(([k, v]) => [k.toLowerCase(), v]));
  for (const [keys, label] of SCALARS[entity.type]) {
    const v = keys.map((k) => lower.get(k.toLowerCase())).find((x) => asText(Array.isArray(x) ? x[0] : x) !== null);
    if (v === undefined) continue;
    const values = (Array.isArray(v) ? v : [v]).map(asText).filter((x): x is string => !!x).map((text) => ({ text: unlink(text) }));
    if (values.length) rows.push({ label, values });
  }
  const live = edges.filter((e) => e.status !== "rejected");
  const shown = new Set<string>();
  for (const pred of relationFields(entity.type)) {
    const values: InfoValue[] = [];
    const seen = new Set<string>();
    const add = (v: InfoValue) => {
      const k = v.id ?? v.text;
      if (seen.has(k)) return;
      seen.add(k);
      values.push(v);
    };
    const fm = props[pred];
    for (const raw of (Array.isArray(fm) ? fm : fm === undefined ? [] : [fm]).map(asText)) {
      if (!raw) continue;
      const text = unlink(raw);
      add({ text, id: input.idOf?.(text) });
    }
    for (const e of live) if (e.subject === entity.id && e.predicate === pred && e.status === "approved") add({ text: name(e.object), id: e.object });
    if (!values.length) continue;
    for (const v of values) if (v.id) shown.add(v.id);
    rows.push({ label: `entityGraph.predicate.${pred}`, values });
  }
  // Key relations: one per other entity, strongest first, not already a field above.
  const degree = new Map<string, number>();
  for (const e of live) {
    degree.set(e.subject, (degree.get(e.subject) ?? 0) + 1);
    degree.set(e.object, (degree.get(e.object) ?? 0) + 1);
  }
  const byOther = new Map<string, KeyRelation>();
  for (const e of live) {
    const outgoing = e.subject === entity.id;
    if (!outgoing && e.object !== entity.id) continue;
    const other = outgoing ? e.object : e.subject;
    if (other === entity.id || shown.has(other)) continue;
    const cur = byOther.get(other);
    if (!cur) byOther.set(other, { edge: e, other, outgoing, count: 1 });
    else {
      cur.count++;
      if (score(e) > score(cur.edge)) Object.assign(cur, { edge: e, outgoing });
    }
  }
  const rank = (k: KeyRelation) => score(k.edge) + 0.1 * Math.min(5, k.count) + 0.05 * Math.log1p(degree.get(k.other) ?? 0);
  const key = [...byOther.values()].sort((a, b) => rank(b) - rank(a) || compareNames(name(a.other), name(b.other))).slice(0, input.maxKey ?? 5);
  const names = new Map<string, string>();
  for (const k of key) names.set(k.other, name(k.other));
  for (const r of rows) for (const v of r.values) if (v.id) names.set(v.id, v.text);
  return { entity, image: infoboxImage(props, body), rows, key, names };
}

const score = (e: Edge) => (e.status === "approved" ? 1 : 0) + e.confidence;
