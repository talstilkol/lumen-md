/**
 * Incremental entity extraction (plan W12.E2): runs in a worker
 * (`extract.worker.ts`) over the paragraphs whose hash changed since the
 * last run, and turns rule hits and NER spans into entity proposals with
 * mentions. With no model on the device it runs the rules only and reports
 * `mode: "rules-only"`; it never fetches anything itself (the NER function
 * is passed in, or not).
 *
 * Mentions resolve against the known entities (W12.E3): a confident match
 * attaches to that entity (`matches`), anything else is a new proposal.
 */
import { entityId, type Entity, type EntityType } from "../model";
import { splitParagraphs, type Paragraph } from "../paragraphs";
import { EntityIndex, mentionStem, resolveMention, autoLinks, type ResolverOptions } from "../resolve";
import { entityProposalId, type EntityProposal, type Mention } from "../store";
import { ruleHits } from "./rules";
import { typeOfLabel } from "./labels";

export const RULES_EXTRACTOR = "lumen-rules@1";

export interface NerSpan {
  start: number;
  end: number;
  text: string;
  label: string;
  score: number;
}

export interface NerModel {
  id: string;
  version: string;
  scheme: "nemo" | "conll";
  run(text: string): Promise<NerSpan[]>;
}

export interface ExtractInput {
  notes: ReadonlyArray<{ path: string; content: string }>;
  /** Paragraph hashes already processed, per note (the last run's `seen`). */
  seen?: ReadonlyMap<string, ReadonlySet<string>>;
  known?: readonly Entity[];
  ner?: NerModel | null;
  resolver?: ResolverOptions;
  /** Called between notes so a worker can yield; may be async. */
  tick?: () => void | Promise<void>;
  minNerScore?: number;
}

export interface ExtractResult {
  mode: "rules-only" | "rules+ner";
  proposals: EntityProposal[];
  seen: Map<string, Set<string>>;
  paragraphs: { scanned: number; skipped: number };
}

/**
 * Proposals from the changed paragraphs of `notes`. Headings are scanned
 * (a name in a heading is a mention), code and front matter are not.
 */
export async function extractEntities(input: ExtractInput): Promise<ExtractResult> {
  const index = new EntityIndex(input.known ?? []);
  const byId = new Map<string, EntityProposal>();
  const seen = new Map<string, Set<string>>();
  let scanned = 0;
  let skipped = 0;
  const extractor = input.ner ? `${input.ner.id}@${input.ner.version}` : RULES_EXTRACTOR;
  const add = (note: string, p: Paragraph, start: number, end: number, raw: string, type: EntityType, name: string, conf: number, by: string, model: string | null) => {
    const mention: Mention = { note, anchor: p.anchor, paragraphHash: p.hash, start: p.start + start, end: p.start + end, text: raw };
    const m = resolveMention(name, index, input.resolver);
    const canonical = autoLinks(m) ? null : name === raw ? mentionStem(raw, index, input.resolver) : name;
    const id = autoLinks(m) ? `p:${m.entity}` : entityProposalId(type, canonical!);
    const cur = byId.get(id);
    if (cur) {
      cur.mentions.push(mention);
      cur.confidence = Math.max(cur.confidence, conf);
      return;
    }
    const prop: EntityProposal = { kind: "entity", id, type, name: canonical ?? name, aliases: [], mentions: [mention], extractor: by, model, confidence: conf };
    if (m.entity) prop.matches = m.entity;
    if (autoLinks(m)) {
      const known = (input.known ?? []).find((e) => e.id === m.entity);
      if (known) {
        prop.type = known.type;
        prop.name = known.name;
      }
    } else if (canonical && canonical !== raw.trim() && name === raw) prop.aliases.push(raw.trim());
    byId.set(id, prop);
  };
  for (const note of input.notes) {
    const before = input.seen?.get(note.path);
    const now = new Set<string>();
    for (const p of splitParagraphs(note.content)) {
      now.add(p.hash);
      if (before?.has(p.hash)) {
        skipped++;
        continue;
      }
      scanned++;
      const hits = ruleHits(p.text);
      for (const h of hits) add(note.path, p, h.start, h.end, h.text, h.type, h.name, 1, RULES_EXTRACTOR, null);
      if (input.ner) {
        const spans = await input.ner.run(p.text);
        for (const s of spans) {
          if (s.score < (input.minNerScore ?? 0.5)) continue;
          const type = typeOfLabel(s.label, input.ner.scheme);
          if (!type || hits.some((h) => s.start < h.end && h.start < s.end)) continue;
          add(note.path, p, s.start, s.end, s.text, type, s.text, s.score, extractor, `${input.ner.id}@${input.ner.version}`);
        }
      }
    }
    seen.set(note.path, now);
    await input.tick?.();
  }
  return { mode: input.ner ? "rules+ner" : "rules-only", proposals: [...byId.values()], seen, paragraphs: { scanned, skipped } };
}

/** Re-export for callers that build ids from proposals. */
export { entityId };
