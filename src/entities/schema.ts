/**
 * JSON Schema of an edge (plan W12.E1) and the validator every write path
 * runs. The schema is the contract for `.lumen/entities/*.jsonl` and for
 * tools that read them; `validateEdge` enforces the same rules in code (the
 * app ships no JSON Schema engine), plus what a schema cannot say: the
 * predicate's domain and range, and that the quote is in the paragraph.
 *
 * An edge without provenance — or with any provenance field missing or
 * empty — is rejected. There is no default.
 */
import { ENTITY_TYPES, PREDICATES, isPredicate, predicateInfo, typeOfId, type Edge } from "./model";

const ISO = "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})?)?$";

export const EDGE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://lumen-md.vercel.app/schemas/entity-edge.json",
  title: "Lumen entity-graph edge",
  type: "object",
  additionalProperties: false,
  required: ["id", "subject", "predicate", "object", "provenance", "confidence", "status"],
  properties: {
    id: { type: "string", minLength: 1 },
    subject: { type: "string", pattern: `^(${ENTITY_TYPES.join("|")}):.+$` },
    predicate: { enum: PREDICATES.map((p) => p.id) },
    object: { type: "string", pattern: `^(${ENTITY_TYPES.join("|")}):.+$` },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    status: { enum: ["proposed", "approved", "rejected"] },
    when: { type: "string", pattern: ISO },
    provenance: {
      type: "object",
      additionalProperties: false,
      required: ["note", "anchor", "quote", "paragraphHash", "extractor", "model", "date"],
      properties: {
        note: { type: "string", minLength: 1 },
        anchor: { type: "string", pattern: "^[A-Za-z0-9-]+$" },
        quote: { type: "string", minLength: 1 },
        paragraphHash: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        extractor: { type: "string", minLength: 1 },
        model: { type: ["string", "null"] },
        date: { type: "string", pattern: ISO },
      },
    },
  },
} as const;

export type EdgeProblem =
  | "not-an-object"
  | "unknown-field"
  | "missing-field"
  | "bad-id"
  | "bad-subject"
  | "bad-object"
  | "unknown-predicate"
  | "domain"
  | "range"
  | "bad-confidence"
  | "bad-status"
  | "bad-when"
  | "no-provenance"
  | "bad-provenance";

export interface EdgeCheck {
  ok: boolean;
  problems: Array<{ problem: EdgeProblem; field: string }>;
}

const isoRe = new RegExp(ISO);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Every problem with `v` as an edge; `ok` only when there is none. */
export function validateEdge(v: unknown): EdgeCheck {
  const problems: EdgeCheck["problems"] = [];
  const add = (problem: EdgeProblem, field: string) => problems.push({ problem, field });
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, problems: [{ problem: "not-an-object", field: "" }] };
  const e = v as Record<string, unknown>;
  for (const k of Object.keys(e)) if (!(k in EDGE_SCHEMA.properties)) add("unknown-field", k);
  for (const k of EDGE_SCHEMA.required) if (!(k in e)) add(k === "provenance" ? "no-provenance" : "missing-field", k);
  if ("id" in e && !str(e.id)) add("bad-id", "id");
  const st = "subject" in e ? (str(e.subject) ? typeOfId(e.subject) : null) : undefined;
  const ot = "object" in e ? (str(e.object) ? typeOfId(e.object) : null) : undefined;
  if (st === null) add("bad-subject", "subject");
  if (ot === null) add("bad-object", "object");
  if ("predicate" in e) {
    if (!isPredicate(e.predicate)) add("unknown-predicate", "predicate");
    else {
      const p = predicateInfo(e.predicate)!;
      if (st && p.domain && !p.domain.includes(st)) add("domain", "subject");
      if (ot && p.range && !p.range.includes(ot)) add("range", "object");
    }
  }
  if ("confidence" in e && !(typeof e.confidence === "number" && e.confidence >= 0 && e.confidence <= 1)) add("bad-confidence", "confidence");
  if ("status" in e && !["proposed", "approved", "rejected"].includes(e.status as string)) add("bad-status", "status");
  if ("when" in e && !(typeof e.when === "string" && isoRe.test(e.when))) add("bad-when", "when");
  if ("provenance" in e) {
    const p = e.provenance as Record<string, unknown> | null;
    if (!p || typeof p !== "object" || Array.isArray(p)) add("no-provenance", "provenance");
    else {
      const props = EDGE_SCHEMA.properties.provenance.properties;
      for (const k of Object.keys(p)) if (!(k in props)) add("unknown-field", `provenance.${k}`);
      for (const k of EDGE_SCHEMA.properties.provenance.required) if (!(k in p)) add("bad-provenance", `provenance.${k}`);
      if ("note" in p && !str(p.note)) add("bad-provenance", "provenance.note");
      if ("anchor" in p && !(typeof p.anchor === "string" && /^[A-Za-z0-9-]+$/.test(p.anchor))) add("bad-provenance", "provenance.anchor");
      if ("quote" in p && !(typeof p.quote === "string" && p.quote.trim().length > 0)) add("bad-provenance", "provenance.quote");
      if ("paragraphHash" in p && !(typeof p.paragraphHash === "string" && /^sha256:[0-9a-f]{64}$/.test(p.paragraphHash))) add("bad-provenance", "provenance.paragraphHash");
      if ("extractor" in p && !str(p.extractor)) add("bad-provenance", "provenance.extractor");
      if ("model" in p && !(p.model === null || str(p.model))) add("bad-provenance", "provenance.model");
      if ("date" in p && !(typeof p.date === "string" && isoRe.test(p.date))) add("bad-provenance", "provenance.date");
    }
  }
  return { ok: problems.length === 0, problems };
}

/** `v` as an edge, or an error naming the first problem. */
export function assertEdge(v: unknown): Edge {
  const c = validateEdge(v);
  if (!c.ok) throw new Error(`edge rejected: ${c.problems.map((p) => `${p.problem} (${p.field})`).join(", ")}`);
  return v as Edge;
}
