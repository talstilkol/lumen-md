/**
 * The suggestion session (plan W13.W1): the suggestions on screen for one
 * document, editor-agnostic. The editor bridges keep it in step with the
 * text (`mapThrough` after every edit; a suggestion whose words the user
 * edited is dropped, never applied to text it was not made on), and turn
 * an accept into one transaction (`planChanges`).
 *
 * Writing agents never see this module's write side: they return
 * suggestions and the user decides (the static check in
 * writingSuggestions.test.ts keeps it that way).
 */
import { replacementWith, type WritingSuggestion } from "./suggestion";

/** What the user accepts for one suggestion: everything, some hunks, an edited text, or an alternative. */
export interface AcceptChoice {
  id: string;
  /** Only these word-level hunks (default: all). */
  hunks?: ReadonlySet<number>;
  /** The user's own edit of the replacement (the card's Edit button). */
  text?: string;
  /** One of `alternatives` instead of the replacement. */
  alternative?: number;
}

export interface PlannedChange {
  from: number;
  to: number;
  insert: string;
  id: string;
  /** The inserted text is a model's (the AI tag goes on the transaction). */
  ai: boolean;
}

export interface ChangePlan {
  /** In document order, not overlapping: one transaction applies them all. */
  changes: PlannedChange[];
  /** Not applied: stale (the text changed), overlapping a surer one, advice only, or blocked by a guard. */
  skipped: Array<{ id: string; reason: "stale" | "overlap" | "advice" | "blocked" | "unknown" | "unchanged" }>;
}

/** The text a choice puts in place of the suggestion's range. */
export function chosenText(s: WritingSuggestion, c: AcceptChoice): string | null {
  if (c.text !== undefined) return c.text;
  const base = c.alternative !== undefined ? (s.alternatives?.[c.alternative] ?? null) : s.replacement;
  if (base === null) return null;
  return c.hunks ? replacementWith(s, c.hunks, base) : base;
}

/**
 * The changes that accepting `choices` makes to `doc`. Overlapping
 * suggestions: the surer one wins (an earlier one on a tie). A suggestion
 * whose original text is no longer at its range is skipped as stale.
 */
export function planChanges(doc: string, suggestions: readonly WritingSuggestion[], choices: readonly AcceptChoice[]): ChangePlan {
  const byId = new Map(suggestions.map((s) => [s.id, s]));
  const skipped: ChangePlan["skipped"] = [];
  const cands: Array<PlannedChange & { confidence: number; order: number }> = [];
  choices.forEach((c, order) => {
    const s = byId.get(c.id);
    if (!s) return void skipped.push({ id: c.id, reason: "unknown" });
    if (s.blocked && c.text === undefined) return void skipped.push({ id: s.id, reason: "blocked" });
    if (doc.slice(s.range.from, s.range.to) !== s.original) return void skipped.push({ id: s.id, reason: "stale" });
    const insert = chosenText(s, c);
    if (insert === null) return void skipped.push({ id: s.id, reason: "advice" });
    if (insert === s.original) return void skipped.push({ id: s.id, reason: "unchanged" });
    // The user's own edit is the user's text; a model's replacement (or its alternative) is AI text.
    const ai = c.text === undefined && s.aiAuthored;
    cands.push({ from: s.range.from, to: s.range.to, insert, id: s.id, ai, confidence: s.confidence, order });
  });
  const ranked = [...cands].sort((a, b) => b.confidence - a.confidence || a.order - b.order);
  const kept: typeof cands = [];
  for (const c of ranked) {
    // Overlapping ranges, or two insertions at the same point (their order would be a guess).
    const clash = kept.some((k) => (c.from < k.to && k.from < c.to) || (c.from === c.to && k.from === k.to && c.from === k.from));
    if (clash) skipped.push({ id: c.id, reason: "overlap" });
    else kept.push(c);
  }
  kept.sort((a, b) => a.from - b.from || a.to - b.to);
  return { changes: kept.map(({ from, to, insert, id, ai }) => ({ from, to, insert, id, ai })), skipped };
}

/** `doc` with the plan applied (for tests, previews and the WYSIWYG bridge's check). */
export function applyPlan(doc: string, plan: ChangePlan): string {
  let out = "";
  let at = 0;
  for (const c of plan.changes) {
    out += doc.slice(at, c.from) + c.insert;
    at = c.to;
  }
  return out + doc.slice(at);
}

export type MapPos = (pos: number, assoc: -1 | 1) => number;

/** A change the editor made: the old range [fromA, toA) became [fromB, toB). */
export interface TouchedRange {
  fromA: number;
  toA: number;
}

/**
 * The suggestions after an edit: ranges mapped, and every suggestion whose
 * range the edit touched dropped (its words are not the ones it was made on).
 */
export function mapSuggestions(list: readonly WritingSuggestion[], mapPos: MapPos, touched: readonly TouchedRange[], doc: string): WritingSuggestion[] {
  const out: WritingSuggestion[] = [];
  for (const s of list) {
    const hit = touched.some((t) => t.fromA < s.range.to && s.range.from < t.toA || (t.fromA === t.toA && t.fromA > s.range.from && t.fromA < s.range.to));
    if (hit) continue;
    const from = mapPos(s.range.from, 1);
    const to = Math.max(from, mapPos(s.range.to, -1));
    if (doc.slice(from, to) !== s.original) continue;
    out.push(from === s.range.from && to === s.range.to ? s : { ...s, range: { from, to } });
  }
  return out;
}

type Listener = (list: readonly WritingSuggestion[]) => void;

/**
 * The suggestions of one document, with what the user did to each. The
 * panel and the editor decorations both read it.
 */
export class SuggestionSession {
  private list: WritingSuggestion[] = [];
  private listeners = new Set<Listener>();
  readonly decided = { accepted: 0, rejected: 0 };

  constructor(readonly docKey: string) {}

  all(): readonly WritingSuggestion[] {
    return this.list;
  }

  get(id: string): WritingSuggestion | undefined {
    return this.list.find((s) => s.id === id);
  }

  /** Replace an agent's suggestions (a new run of the same agent replaces its old ones). */
  setFor(agentId: string, next: readonly WritingSuggestion[]): void {
    const kept = this.list.filter((s) => s.agentId !== agentId);
    const ids = new Set(kept.map((s) => s.id));
    this.list = [...kept, ...next.filter((s) => !ids.has(s.id))].sort((a, b) => a.range.from - b.range.from || b.confidence - a.confidence);
    this.emit();
  }

  replace(next: readonly WritingSuggestion[]): void {
    this.list = [...next];
    this.emit();
  }

  reject(ids: Iterable<string>): void {
    const drop = new Set(ids);
    const before = this.list.length;
    this.list = this.list.filter((s) => !drop.has(s.id));
    this.decided.rejected += before - this.list.length;
    this.emit();
  }

  /** The bridge applied these: they leave the list. */
  accepted(ids: Iterable<string>): void {
    const drop = new Set(ids);
    const before = this.list.length;
    this.list = this.list.filter((s) => !drop.has(s.id));
    this.decided.accepted += before - this.list.length;
    this.emit();
  }

  clear(): void {
    this.list = [];
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.list);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l(this.list);
  }
}
