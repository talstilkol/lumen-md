/**
 * The extraction worker (plan W12.E2) wired into the graph review (W12.E5).
 *
 * When the review panel opens, `EntityReviewHost` sends the vault's notes to
 * `extract.worker.ts` (off the main thread, one note at a time) and merges
 * what it finds into the proposals queue (`.lumen/entities/proposals.jsonl`).
 * Only the queue is written, and only through the review's controlled write
 * (`applyEntityOp`, which refuses when the queue changed meanwhile): nothing
 * reaches a note until the user approves it in the panel.
 *
 * - Incremental: the paragraph hashes already scanned are kept for the
 *   session, so a second opening scans only changed paragraphs.
 * - A rejected proposal is not proposed again (decisions.jsonl), and a
 *   mention of an approved entity that adds no new spelling is not proposed
 *   either: approving it would change nothing.
 * - With no NER model cached on the device the worker runs the rules alone
 *   and replies `rules-only`, which the panel shows as a notice.
 */
import type { Entity } from "../model";
import { ENTITY_ROOT } from "../model";
import { DECISIONS_PATH, PROPOSALS_PATH, mergeProposals, parseJsonl, toJsonl, type Decision, type Proposal } from "../store";
import type { Files, OpResult } from "../review";
import type { ExtractReply, ExtractRequest } from "./protocol";

export type ExtractRun = (req: Omit<ExtractRequest, "id">) => Promise<ExtractReply>;

/** The notes the extractor reads: Markdown outside dot folders and outside the entity notes themselves. */
export const isScannedNote = (path: string): boolean => path.endsWith(".md") && !path.split("/").some((s) => s.startsWith(".")) && !path.startsWith(`${ENTITY_ROOT}/`);

/** True when approving `p` would add nothing: it matches a known entity and every spelling is already the entity's. */
export function addsNothing(p: Proposal, known: readonly Entity[]): boolean {
  if (p.kind !== "entity" || !p.matches) return false;
  const e = known.find((k) => k.id === p.matches);
  if (!e) return false;
  const have = new Set([e.name, ...e.aliases].map((s) => s.trim()));
  return [...p.mentions.map((m) => m.text), ...p.aliases].every((s) => have.has(s.trim()));
}

let seen: Record<string, string[]> = {};

/** Forget the session's scanned paragraphs (tests; a vault switch). */
export function resetScan(): void {
  seen = {};
}

export interface ScanResult {
  mode: ExtractReply["mode"];
  /** New proposals for the queue (merge them with `queueWith`). */
  incoming: Proposal[];
  /** The paragraphs this run scanned: pass to `rememberScanned` once its proposals are in the queue. */
  seen: Record<string, string[]>;
}

/** Run the extractor over the notes in `files`; `known` are the approved entities. */
export async function scanNotes(files: Files, known: readonly Entity[], run: ExtractRun): Promise<ScanResult> {
  const notes = [...files].filter(([p]) => isScannedNote(p)).map(([path, content]) => ({ path, content }));
  const reply = await run({ notes, seen, known: [...known], useModel: true });
  return { mode: reply.mode, incoming: reply.proposals.filter((p) => !addsNothing(p, known)), seen: reply.seen };
}

/** A run's proposals reached the queue: the next run skips the paragraphs it scanned. */
export function rememberScanned(result: Pick<ScanResult, "seen">): void {
  seen = { ...seen, ...result.seen };
}

/** The queue with `incoming` merged in, as a review operation; null when nothing is added. */
export function queueWith(files: Files, incoming: readonly Proposal[]): OpResult | null {
  const before = files.get(PROPOSALS_PATH) ?? null;
  const queue = parseJsonl<Proposal>(before ?? "").rows;
  const decisions = parseJsonl<Decision>(files.get(DECISIONS_PATH) ?? "").rows;
  const merged = mergeProposals(queue, incoming, decisions);
  const text = merged.proposals.length ? toJsonl(merged.proposals) : null;
  if (text === before || text === null) return null;
  const next = new Map(files);
  next.set(PROPOSALS_PATH, text);
  return { files: next, undo: new Map([[PROPOSALS_PATH, before]]), written: [PROPOSALS_PATH], removed: [] };
}
