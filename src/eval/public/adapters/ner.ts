/**
 * Hebrew NER on NEMO and BMC (plan W11.H11): entity-level F1, the metric
 * the HalleluBERT and DictaBERT papers report — an entity counts only when
 * its span AND its type match the gold exactly; precision, recall and F1
 * are micro over all entities, and per type.
 *
 * Format "conll-bioes": one token per line, the token and its tag separated
 * by whitespace (the last column is the tag), a blank line between
 * sentences; tags in BIO or BIOES (B-, I-, E-, S-, O; also L-/U- for BILOU).
 * This is how the NEMO corpus (OnlpLab/NEMO-Corpus, token-level files) and
 * the BMC corpus are distributed; the exact files are pinned in the
 * manifests (owed).
 */
import { r4 } from "../metrics";

export interface NerSentence {
  id: string;
  tokens: string[];
  tags: string[];
}

export interface Entity {
  start: number;
  /** Exclusive token index. */
  end: number;
  type: string;
}

export function parseConll(text: string, idPrefix = "s"): NerSentence[] {
  const out: NerSentence[] = [];
  let cur: NerSentence = { id: `${idPrefix}1`, tokens: [], tags: [] };
  const flush = () => {
    if (cur.tokens.length) out.push(cur);
    cur = { id: `${idPrefix}${out.length + 1}`, tokens: [], tags: [] };
  };
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return flush();
    if (line.startsWith("#") || line.startsWith("-DOCSTART-")) return;
    const cols = line.trim().split(/\s+/);
    if (cols.length < 2) throw new Error(`conll line ${i + 1}: expected a token and a tag`);
    const tag = cols[cols.length - 1];
    if (!/^(O|[BIESLU]-[A-Za-z_]+)$/.test(tag)) throw new Error(`conll line ${i + 1}: "${tag}" is not a BIO/BIOES tag`);
    cur.tokens.push(cols[0]);
    cur.tags.push(tag);
  });
  flush();
  return out;
}

/** Entities of a BIO/BIOES/BILOU tag sequence. An I- or E- without its B- opens an entity (the usual lenient decoding). */
export function entities(tags: readonly string[]): Entity[] {
  const out: Entity[] = [];
  let open: Entity | null = null;
  const close = (end: number) => {
    if (open) {
      open.end = end;
      out.push(open);
      open = null;
    }
  };
  tags.forEach((tag, i) => {
    if (tag === "O") return close(i);
    const [p, type] = [tag[0], tag.slice(2)];
    if (p === "S" || p === "U") {
      close(i);
      out.push({ start: i, end: i + 1, type });
    } else if (p === "B") {
      close(i);
      open = { start: i, end: i + 1, type };
    } else {
      if (!open || open.type !== type) {
        close(i);
        open = { start: i, end: i + 1, type };
      }
      if (p === "E" || p === "L") close(i + 1);
    }
  });
  close(tags.length);
  return out;
}

export interface NerEngine {
  id: string;
  /** One tag per token (BIO or BIOES), for a pre-tokenised sentence. */
  tag(tokens: readonly string[]): Promise<string[]>;
}

export interface NerScore {
  n: number;
  metrics: { precision: number; recall: number; f1: number };
  byType: Record<string, { gold: number; precision: number; recall: number; f1: number }>;
}

const f1 = (p: number, r: number) => (p + r ? (2 * p * r) / (p + r) : 0);

export async function scoreNer(sentences: readonly NerSentence[], engine: NerEngine): Promise<NerScore> {
  const tp: Record<string, number> = {};
  const gold: Record<string, number> = {};
  const pred: Record<string, number> = {};
  for (const s of sentences) {
    const tags = await engine.tag(s.tokens);
    if (tags.length !== s.tokens.length) throw new Error(`${engine.id} returned ${tags.length} tags for ${s.tokens.length} tokens in ${s.id}`);
    const g = entities(s.tags);
    const p = entities(tags);
    const key = (e: Entity) => `${e.start}:${e.end}:${e.type}`;
    const gk = new Set(g.map(key));
    for (const e of g) gold[e.type] = (gold[e.type] ?? 0) + 1;
    for (const e of p) {
      pred[e.type] = (pred[e.type] ?? 0) + 1;
      if (gk.has(key(e))) tp[e.type] = (tp[e.type] ?? 0) + 1;
    }
  }
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const P = sum(pred) ? sum(tp) / sum(pred) : 0;
  const R = sum(gold) ? sum(tp) / sum(gold) : 0;
  const byType = Object.fromEntries(
    Object.keys({ ...gold, ...pred })
      .sort()
      .map((t) => {
        const p = pred[t] ? (tp[t] ?? 0) / pred[t] : 0;
        const r = gold[t] ? (tp[t] ?? 0) / gold[t] : 0;
        return [t, { gold: gold[t] ?? 0, precision: r4(p), recall: r4(r), f1: r4(f1(p, r)) }];
      }),
  );
  return { n: sentences.length, metrics: { precision: r4(P), recall: r4(R), f1: r4(f1(P, R)) }, byType };
}

/** W11.H11 / R2.7 acceptance on NEMO: entity F1 ≥ 85, and browser int8 within 2 points of fp32. */
export function nerAccepted(int8F1: number, fp32F1: number | null): boolean {
  return int8F1 >= 0.85 && (fp32F1 === null || fp32F1 - int8F1 <= 0.02 + 1e-9);
}
