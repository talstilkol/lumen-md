/**
 * The entity graph's files (plan W12.E1).
 *
 * - `.lumen/entities/proposals.jsonl` — what the extractors propose. It is
 *   kept apart from the approved entities, and nothing in it reaches a note
 *   until the user approves it (W12.E5).
 * - `.lumen/entities/edges.jsonl` — approved edges, each with provenance.
 * - `.lumen/entities/decisions.jsonl` — rejections, so a rejected proposal
 *   is not proposed again.
 * - Approved entities are notes under `ישויות/<type>/` (`notes.ts`).
 *
 * JSON Lines: one object per line, appended; a bad line is skipped and
 * counted, never fatal (a hand edit must not lose the rest).
 */
import { assertEdge, validateEdge } from "./schema";
import { entityId, isEntityType, type Edge, type Entity, type EntityType } from "./model";

export const ENTITY_DIR = ".lumen/entities";
export const PROPOSALS_PATH = `${ENTITY_DIR}/proposals.jsonl`;
export const EDGES_PATH = `${ENTITY_DIR}/edges.jsonl`;
export const DECISIONS_PATH = `${ENTITY_DIR}/decisions.jsonl`;

/** One place a name occurs in the vault. */
export interface Mention {
  note: string;
  /** The paragraph's anchor, or null until approval creates one. */
  anchor: string | null;
  paragraphHash: string;
  /** Offsets in the note. */
  start: number;
  end: number;
  /** The text as written ("בירושלים"). */
  text: string;
}

export interface EntityProposal {
  kind: "entity";
  id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  mentions: Mention[];
  extractor: string;
  model: string | null;
  confidence: number;
  /** When resolution matched an existing entity, its id (W12.E3). */
  matches?: string;
}

export interface EdgeProposal {
  kind: "edge";
  id: string;
  edge: Edge;
}

export type Proposal = EntityProposal | EdgeProposal;

export interface Decision {
  /** The proposal's fingerprint (`proposalKey`). */
  key: string;
  verdict: "rejected";
  date: string;
}

export function parseJsonl<T>(text: string): { rows: T[]; bad: number } {
  const rows: T[] = [];
  let bad = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      bad++;
    }
  }
  return { rows, bad };
}

export const toJsonl = (rows: readonly unknown[]): string => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");

/** The same proposal from a later run has the same key, so a rejection sticks. */
export function proposalKey(p: Proposal): string {
  if (p.kind === "edge") return `edge|${p.edge.subject}|${p.edge.predicate}|${p.edge.object}|${p.edge.provenance.quote}`;
  return `entity|${entityId(p.type, p.name)}`;
}

export function entityProposalId(type: EntityType, name: string): string {
  return `p:${entityId(type, name)}`;
}

export interface MergeResult {
  proposals: Proposal[];
  added: number;
  /** Rejected before and so not proposed again. */
  suppressed: number;
  /** Edges that failed validation (no provenance, unknown predicate, …). */
  invalid: number;
}

/**
 * New proposals merged into the queue: an edge that fails `validateEdge`
 * is dropped and counted, a rejected one is suppressed, a repeat entity
 * gains the new mentions.
 */
export function mergeProposals(queue: readonly Proposal[], incoming: readonly Proposal[], decisions: readonly Decision[]): MergeResult {
  const rejected = new Set(decisions.filter((d) => d.verdict === "rejected").map((d) => d.key));
  const out = queue.map((p) => (p.kind === "entity" ? { ...p, mentions: [...p.mentions] } : p));
  const byKey = new Map(out.map((p, i) => [proposalKey(p), i]));
  let added = 0;
  let suppressed = 0;
  let invalid = 0;
  for (const p of incoming) {
    if (p.kind === "edge" && !validateEdge(p.edge).ok) {
      invalid++;
      continue;
    }
    if (p.kind === "entity" && (!isEntityType(p.type) || !p.name.trim())) {
      invalid++;
      continue;
    }
    const key = proposalKey(p);
    if (rejected.has(key)) {
      suppressed++;
      continue;
    }
    const at = byKey.get(key);
    if (at === undefined) {
      byKey.set(key, out.length);
      out.push(p.kind === "entity" ? { ...p, mentions: [...p.mentions] } : p);
      added++;
    } else if (p.kind === "entity") {
      const cur = out[at] as EntityProposal;
      const seen = new Set(cur.mentions.map((m) => `${m.note}:${m.start}`));
      for (const m of p.mentions) if (!seen.has(`${m.note}:${m.start}`)) cur.mentions.push(m);
      for (const a of p.aliases) if (!cur.aliases.includes(a)) cur.aliases.push(a);
    }
  }
  return { proposals: out, added, suppressed, invalid };
}

/** Approved edges from `edges.jsonl`; every row is validated on read too. */
export function readEdges(text: string): { edges: Edge[]; bad: number } {
  const { rows, bad } = parseJsonl<unknown>(text);
  const edges: Edge[] = [];
  let invalid = 0;
  for (const r of rows) {
    if (validateEdge(r).ok) edges.push(r as Edge);
    else invalid++;
  }
  return { edges, bad: bad + invalid };
}

export function appendEdge(text: string, edge: Edge): string {
  const e = assertEdge(edge);
  return (text && !text.endsWith("\n") ? `${text}\n` : text) + JSON.stringify(e) + "\n";
}

/** The graph the views and exports read: approved entities and edges. */
export interface EntityGraph {
  entities: Entity[];
  edges: Edge[];
}
