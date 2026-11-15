/**
 * Citations to your own notes in "Ask the vault" answers (T29).
 *
 * The model is asked to back each claim with a source number and a short
 * verbatim quote: `[2] "the exact words"`. Here each citation is checked
 * against the note it names — the quote must really be there, word for word
 * (`quoteContained`: the prompt promises an exact quote, and an approximate
 * match would pass a quote that drops a "not") — and is
 * resolved to the paragraph it sits in (W12.A1, ./paragraphAnchors), so the
 * answer links to note + paragraph. A quote must sit inside one paragraph
 * of the note: words picked from two places do not back a claim.
 * An answer with no verified citation is flagged as unsupported, and so is
 * each claim (sentence) without a verified citation of its own.
 */
import { quoteContained } from "../research/citations";
import { normalizeForMatch } from "../text/hebrew";
import { paragraphOfQuote, type Paragraph } from "./paragraphAnchors";

export interface VaultSource {
  path: string;
  content: string;
}

export interface VaultCitation {
  /** 1-based source number as written in the answer. */
  n: number;
  path: string | null;
  quote: string | null;
  /** 1-based line of the quote in the note, when found. */
  line: number | null;
  /** The paragraph that holds the quote (W12.A1): its anchor and line range, when verified. */
  paragraph: Pick<Paragraph, "anchor" | "blockId" | "index" | "startLine" | "endLine"> | null;
  verified: boolean;
}

export const CITE_INSTRUCTIONS =
  'Answer only from the context files. After every claim, cite its source as [n] followed by a short exact quote from that file in double quotes, e.g. [2] "the meeting moved to Tuesday". Quote the file\'s own words (same language), at most ~20 words, from a single paragraph. Answer in the language of the question, even when the quoted file is in another language. If the context does not contain the answer, say so instead of guessing.';

const CITE_RE = /\[(\d{1,2})\](?:\s*[:—-]?\s*["“„«]([^"”«»\n]{3,300})["”»])?/g;
const HAS_CITE = /\[\d{1,2}\]/;

/** Every [n] (with its quote, if one follows) in order of appearance. */
export function parseVaultCitations(answer: string): Array<{ n: number; quote: string | null }> {
  const out: Array<{ n: number; quote: string | null }> = [];
  for (const m of answer.matchAll(CITE_RE)) out.push({ n: Number(m[1]), quote: m[2]?.trim() || null });
  return out;
}

/** 1-based line where `quote` starts in `content`, or null. */
export function lineOfQuote(content: string, quote: string): number | null {
  const lines = content.split("\n");
  const q = normalizeForMatch(quote);
  if (!q) return null;
  // Exact (normalised) containment on one line first, then the best line by
  // shared words — a quote may span a line break.
  for (let i = 0; i < lines.length; i++) if (normalizeForMatch(lines[i]).includes(q)) return i + 1;
  const qWords = new Set(q.split(/\s+/).filter((w) => w.length > 1));
  let best = -1;
  let bestHits = 0;
  for (let i = 0; i < lines.length; i++) {
    const hits = normalizeForMatch(lines[i]).split(/\s+/).filter((w) => qWords.has(w)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = i;
    }
  }
  return best >= 0 && bestHits >= Math.min(3, qWords.size) ? best + 1 : null;
}

export function verifyVaultCitations(answer: string, sources: readonly VaultSource[]): { citations: VaultCitation[]; verifiedCount: number } {
  const seen = new Set<string>();
  const citations: VaultCitation[] = [];
  for (const { n, quote } of parseVaultCitations(answer)) {
    const key = `${n}\u0000${quote ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const src = sources[n - 1];
    if (!src) {
      citations.push({ n, path: null, quote, line: null, paragraph: null, verified: false });
      continue;
    }
    const p = quote ? paragraphOfQuote(src.content, quote, quoteContained) : null;
    const paragraph = p ? { anchor: p.anchor, blockId: p.blockId, index: p.index, startLine: p.startLine, endLine: p.endLine } : null;
    const line = quote ? (p ? (lineOfQuote(p.text, quote) ?? 1) + p.startLine - 1 : lineOfQuote(src.content, quote)) : null;
    citations.push({ n, path: src.path, quote, line, paragraph, verified: !!p });
  }
  return { citations, verifiedCount: citations.filter((c) => c.verified).length };
}

/**
 * The answer with every failed citation flagged in place, so a saved report
 * still shows which quote didn't check out after the toast is gone.
 */
export function markVaultCitations(answer: string, citations: readonly VaultCitation[]): string {
  const byKey = new Map(citations.map((c) => [`${c.n}\u0000${c.quote ?? ""}`, c]));
  return answer.replace(CITE_RE, (m: string, num: string, quote: string | undefined) => {
    const c = byKey.get(`${Number(num)}\u0000${quote?.trim() || ""}`);
    if (!c || c.verified) return m;
    if (!c.path) return `${m} ⚠️ *cites a page that wasn't given*`;
    if (!c.quote) return `${m} ⚠️ *no supporting quote given*`;
    return `${m} ⚠️ *quote not found in the page*`;
  });
}

export interface ClaimSupport {
  /** The claim as written in the answer (one sentence or list item). */
  text: string;
  /** It carries at least one verified citation. */
  supported: boolean;
}

/** Sentences of an answer: split after . ! ? (and the Hebrew ׃) or at line breaks, keeping quotes whole. */
function sentences(answer: string): string[] {
  const out: string[] = [];
  for (const line of answer.split(/\n+/)) {
    let buf = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      buf += c;
      if (c === '"' || c === "“" || c === "”" || c === "„" || c === "«" || c === "»") inQuote = c === "“" || c === "„" || c === "«" ? true : c === "”" || c === "»" ? false : !inQuote;
      if (!inQuote && /[.!?׃]/.test(c) && (i + 1 >= line.length || /\s/.test(line[i + 1]))) {
        // A citation right after the full stop belongs to this sentence: "… Tuesday. [1] "quote"".
        const rest = line.slice(i + 1);
        const tail = /^\s*(?:\[\d{1,2}\](?:\s*[:—-]?\s*["“„«][^"”«»\n]{3,300}["”»])?\s*)+/.exec(rest);
        if (tail) {
          buf += tail[0];
          i += tail[0].length;
        }
        out.push(buf);
        buf = "";
      }
    }
    out.push(buf);
  }
  return out.map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]{2,}/u.test(s.replace(CITE_RE, "")));
}

/**
 * Each claim of the answer, and whether a verified citation backs it.
 * A sentence that only says the notes do not cover the question is no
 * claim (`noAnswer` matches it), so "I don't know" is not flagged.
 */
export function claimSupport(answer: string, citations: readonly VaultCitation[], noAnswer: RegExp = /not (?:in|covered by) the (?:context|notes|files)|don't know|no information|אין (?:בפתקים|מידע)|לא (?:מופיע|נמצא) ב/i): ClaimSupport[] {
  const ok = new Set(citations.filter((c) => c.verified).map((c) => `${c.n}\u0000${c.quote ?? ""}`));
  const out: ClaimSupport[] = [];
  for (const text of sentences(answer)) {
    if (noAnswer.test(text) && !HAS_CITE.test(text)) continue;
    let supported = false;
    for (const m of text.matchAll(CITE_RE)) if (ok.has(`${Number(m[1])}\u0000${m[2]?.trim() || ""}`)) supported = true;
    out.push({ text, supported });
  }
  return out;
}

/** The answer with " ⚠️ *<label>*" after every claim no verified citation backs (W12.A1). */
export function markUnsupportedClaims(answer: string, claims: readonly ClaimSupport[], label: string): string {
  let out = answer;
  let from = 0;
  for (const c of claims) {
    if (c.supported) continue;
    const at = out.indexOf(c.text, from);
    if (at < 0) continue;
    const end = at + c.text.length;
    const mark = ` ⚠️ *${label}*`;
    out = out.slice(0, end) + mark + out.slice(end);
    from = end + mark.length;
  }
  return out;
}
