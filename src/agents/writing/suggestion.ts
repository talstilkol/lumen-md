/**
 * The writing-suggestion contract (plan W13.W1): every writing agent — the
 * clarity coach, the tone shifter, concision, the proofreader and the ones
 * that follow (W13.W3–W15) — hands the user the same thing, the way
 * Grammarly and Apple Writing Tools do: a range of the text, what kind of
 * change it is, why, how sure the agent is, and the replacement. Nothing
 * here touches the note: an agent returns suggestions, the user accepts or
 * rejects each (or each word-level hunk of one), and only then does the
 * editor bridge (cmBridge / pmBridge) apply the accepted ones in a single
 * undoable transaction.
 */
import { wordDiff, type DiffOp } from "../../collab/wordDiff";

export const SUGGESTION_KINDS = [
  "grammar",
  "spelling",
  "clarity",
  "concision",
  "wordiness",
  "passive",
  "hedge",
  "nominalization",
  "redundancy",
  "tone",
  "register",
  "expansion",
  "structure",
  "logic",
  "consistency",
  "readability",
  "repetition",
  "wordChoice",
] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export interface TextRange {
  from: number;
  to: number;
}

export interface WritingSuggestion {
  /** Stable within a session: agent, rule and range. */
  id: string;
  /** Offsets into the text the agent read (the editor bridge maps them). */
  range: TextRange;
  kind: SuggestionKind;
  /** One short line for the card ("Long sentence: 41 words"). */
  message: string;
  /** Why: the rule or the model's reason, shown when the card is opened. */
  rationale: string;
  /** 0..1 — how sure the agent is; the panel sorts and filters by it. */
  confidence: number;
  /** The text the range should become; null = advice only (nothing to accept, only to dismiss). */
  replacement: string | null;
  /** The text the range held when the agent read it (a stale suggestion is dropped, never applied). */
  original: string;
  agentId: string;
  /** The model that wrote the replacement, or "rules" for a deterministic rule. */
  model: string;
  /** The replacement is a model's text: accepting it carries the AI tag (plan 5.9). */
  aiAuthored: boolean;
  /** The rule that fired (rules-based agents). */
  ruleId?: string;
  /** Other versions to pick from (the tone shifter offers three). */
  alternatives?: string[];
  /** A guard refused the replacement (a changed number, a dropped name): shown, never acceptable. */
  blocked?: string;
}

export class SuggestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuggestionError";
  }
}

const isKind = (k: unknown): k is SuggestionKind => typeof k === "string" && (SUGGESTION_KINDS as readonly string[]).includes(k);

/** Every problem with a suggestion against the text it was made on (empty = valid). */
export function validateSuggestion(s: Partial<WritingSuggestion>, text: string): string[] {
  const p: string[] = [];
  if (!s.id) p.push("id: missing");
  if (!s.agentId) p.push("agentId: missing");
  if (!s.model) p.push("model: missing (\"rules\" for a deterministic rule)");
  if (!isKind(s.kind)) p.push(`kind: ${String(s.kind)} is not a suggestion kind`);
  if (!s.message?.trim()) p.push("message: missing");
  if (typeof s.rationale !== "string") p.push("rationale: missing");
  if (typeof s.confidence !== "number" || !(s.confidence >= 0 && s.confidence <= 1)) p.push("confidence: must be 0..1");
  const r = s.range;
  if (!r || !Number.isInteger(r.from) || !Number.isInteger(r.to) || r.from < 0 || r.to < r.from || r.to > text.length) p.push("range: outside the text");
  else if (s.original !== text.slice(r.from, r.to)) p.push("original: is not the text at the range");
  if (s.replacement !== null && typeof s.replacement !== "string") p.push("replacement: a string or null");
  if (s.replacement === s.original) p.push("replacement: the same as the original");
  if (typeof s.aiAuthored !== "boolean") p.push("aiAuthored: missing");
  else if (s.aiAuthored !== (s.model !== "rules")) p.push("aiAuthored: must be true exactly when a model wrote the replacement");
  return p;
}

export type SuggestionDraft = Omit<WritingSuggestion, "id" | "original" | "aiAuthored"> & { id?: string };

/** A checked suggestion for `text` (throws SuggestionError when it is not valid). */
export function makeSuggestion(text: string, d: SuggestionDraft): WritingSuggestion {
  const s: WritingSuggestion = {
    ...d,
    id: d.id ?? `${d.agentId}:${d.ruleId ?? d.kind}:${d.range.from}-${d.range.to}`,
    original: text.slice(d.range.from, d.range.to),
    aiAuthored: d.model !== "rules",
    confidence: Math.round(d.confidence * 1000) / 1000,
  };
  const problems = validateSuggestion(s, text);
  if (problems.length) throw new SuggestionError(`${s.id}: ${problems.join("; ")}`);
  return s;
}

/**
 * What a rule-based checker of W13.W6–W15 emits (L5's `suggestionShape`,
 * L6's `writingSuggestion` are this type): W1's fields with the checker's
 * own finding kind ("fact-conflict", "heading-skip", "cliche" …), and where
 * it points. `fromFinding` makes it a W1 suggestion — the finding kind
 * becomes `ruleId`, the W1 kind comes from it (or from the agent) — and that
 * is the only form a finding reaches the review (agents/writingReview.ts).
 */
export interface CheckerFinding extends Omit<SuggestionDraft, "kind" | "ruleId" | "id"> {
  kind: string;
  /** Vault path of the note `range` is in (vault-wide checkers). */
  path?: string;
  /** Paragraph links (`path#^anchor`) the finding rests on. */
  links?: string[];
  /** Check-specific details (the lemma, the phrase, the term …). */
  data?: Record<string, unknown>;
}

/** A W1 suggestion that came from a checker finding, with where it points. */
export type FindingSuggestion = WritingSuggestion & Pick<CheckerFinding, "path" | "links" | "data">;

const LOGIC = ["ad-hominem", "appeal-to-popularity", "false-dilemma", "hasty-generalization", "logical-leap", "map-unsupported", "post-hoc", "slippery-slope", "straw-man", "unsupported-claim"];
const STRUCTURE = ["duplicate-heading", "empty-section", "heading-skip", "lone-subheading", "long-paragraph", "no-conclusion", "no-intro", "topic-sentence"];
const CONSISTENCY = ["fact-conflict", "foreign-script-name", "name-variant", "term-variant"];
/** The finding kinds of W13.W6–W15, as W1 kinds. */
export const FINDING_KINDS: Readonly<Record<string, SuggestionKind>> = {
  ...Object.fromEntries(LOGIC.map((k) => [k, "logic"])),
  ...Object.fromEntries(STRUCTURE.map((k) => [k, "structure"])),
  ...Object.fromEntries(CONSISTENCY.map((k) => [k, "consistency"])),
  readability: "readability",
  repetition: "repetition",
  doubled: "redundancy",
  cliche: "wordChoice",
  loanword: "wordChoice",
};
/** A checker's group, as a W1 kind, for a finding kind not listed above. */
export const CHECKER_KINDS: Readonly<Record<string, SuggestionKind>> = {
  consistency: "consistency",
  structureCritic: "structure",
  argumentChecker: "logic",
  readability: "readability",
  harperGrammar: "grammar",
  repetition: "repetition",
  loanwords: "wordChoice",
};

/** The W1 kind of a finding (Harper's `grammar:<lint>` is grammar); undefined = not a known finding. */
export function findingKind(f: Pick<CheckerFinding, "kind" | "agentId">): SuggestionKind | undefined {
  if (isKind(f.kind)) return f.kind;
  if (f.kind.startsWith("grammar:")) return "grammar";
  return FINDING_KINDS[f.kind] ?? CHECKER_KINDS[f.agentId];
}

/** FNV-1a, base 36: a short, stable tag of a finding's content. */
function contentTag(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The finding as a checked W1 suggestion for `text` (throws SuggestionError when it does not fit it).
 * Review 13 L5: the id also carries a tag of the replacement and message, so two findings of one rule on one
 * range (two fixes, a fix and a comment) never share an id — a session keyed by id kept only one of them.
 */
export function fromFinding(text: string, f: CheckerFinding): FindingSuggestion {
  const kind = findingKind(f);
  if (!kind) throw new SuggestionError(`${f.agentId}: ${f.kind} is not a known finding kind`);
  const { path, links, data, kind: ruleId, ...rest } = f;
  const s: FindingSuggestion = makeSuggestion(text, { ...rest, kind, ruleId, id: `${f.agentId}:${ruleId}:${path ?? ""}:${f.range.from}-${f.range.to}:${contentTag(`${f.replacement ?? "\u0000"}\u0001${f.message}`)}` });
  if (path !== undefined) s.path = path;
  if (links) s.links = links;
  if (data) s.data = data;
  return s;
}

/** One word-level change inside a suggestion, which the user can take or leave on its own. */
export interface Hunk {
  index: number;
  del: string;
  ins: string;
}

/** The suggestion as equal / delete / insert runs (Hebrew-aware words, W3.11). */
export function suggestionDiff(s: Pick<WritingSuggestion, "original" | "replacement">, replacement = s.replacement): DiffOp[] {
  return replacement === null ? [{ type: "equal", text: s.original }] : wordDiff(s.original, replacement);
}

/** The changes of a diff, a deletion and the insertion right after it counting as one hunk. */
export function hunksOf(ops: readonly DiffOp[]): Hunk[] {
  const out: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const op of ops) {
    if (op.type === "equal") {
      cur = null;
      continue;
    }
    if (!cur) out.push((cur = { index: out.length, del: "", ins: "" }));
    if (op.type === "delete") cur.del += op.text;
    else cur.ins += op.text;
  }
  return out;
}

/** The replacement with only the hunks in `accepted` applied (all hunks = the replacement). */
export function replacementWith(s: Pick<WritingSuggestion, "original" | "replacement">, accepted: ReadonlySet<number>, replacement = s.replacement): string {
  if (replacement === null) return s.original;
  let out = "";
  let h = -1;
  let inHunk = false;
  for (const op of suggestionDiff(s, replacement)) {
    if (op.type === "equal") {
      inHunk = false;
      out += op.text;
      continue;
    }
    if (!inHunk) {
      h++;
      inHunk = true;
    }
    const take = accepted.has(h);
    if (op.type === "insert" && take) out += op.text;
    if (op.type === "delete" && !take) out += op.text;
  }
  return out;
}
