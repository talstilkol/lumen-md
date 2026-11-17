/**
 * W12.S2 — "then vs now", paragraph by paragraph, and restoring one
 * paragraph of the past into today's note.
 *
 * Paragraphs are blocks separated by blank lines. The two versions are
 * aligned with a longest common subsequence over paragraph texts; what is
 * left is a list of hunks, each with the offsets in today's text it would
 * replace (an empty range for a paragraph that is gone, inserted where it
 * stood). Applying a hunk is one text change, so in the editor it is one
 * transaction that Ctrl+Z undoes.
 */

export interface Paragraph {
  text: string;
  /** Offsets in its version's text. */
  from: number;
  to: number;
}

export interface RestoreHunk {
  /** "changed": then's paragraphs replace now's; "removed": then's were deleted since; "added": now's are new. */
  kind: "changed" | "removed" | "added";
  /** Then's paragraphs, joined as they stood. */
  then: string;
  /** Now's paragraphs this hunk replaces, joined as they stand ("" when removed). */
  now: string;
  /** Offsets in today's text to replace; `from === to` inserts. */
  from: number;
  to: number;
  /** The text to put there so the paragraph reads as it did. */
  insert: string;
}

/** The paragraphs of `text`, with their offsets. */
export function paragraphs(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  const re = /\n[ \t]*\n+/g;
  let start = 0;
  for (let m = re.exec(text); ; m = re.exec(text)) {
    const end = m ? m.index : text.length;
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (body) out.push({ text: body, from: start + lead, to: start + lead + body.length });
    if (!m) break;
    start = m.index + m[0].length;
  }
  return out;
}

/** The hunks between `then` and `now`, in today's order. */
export function restoreHunks(then: string, now: string): RestoreHunk[] {
  const a = paragraphs(then);
  const b = paragraphs(now);
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i].text === b[j].text ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const hunks: RestoreHunk[] = [];
  let i = 0;
  let j = 0;
  /** End offset in `now` of the last paragraph both share (where a removed paragraph goes back). */
  let anchor = 0;
  const flush = (ai: number, bj: number) => {
    const olds = a.slice(ai, i);
    const news = b.slice(bj, j);
    if (!olds.length && !news.length) return;
    const thenText = olds.map((p) => p.text).join("\n\n");
    if (news.length) {
      const from = news[0].from;
      const to = news[news.length - 1].to;
      hunks.push({ kind: olds.length ? "changed" : "added", then: thenText, now: now.slice(from, to), from, to, insert: thenText });
    } else {
      const atStart = anchor === 0 && b.length > 0;
      hunks.push({
        kind: "removed",
        then: thenText,
        now: "",
        from: atStart ? b[0].from : anchor,
        to: atStart ? b[0].from : anchor,
        insert: atStart ? `${thenText}\n\n` : anchor === 0 ? thenText : `\n\n${thenText}`,
      });
    }
  };
  while (i < n || j < m) {
    const ai = i;
    const bj = j;
    while ((i < n || j < m) && !(i < n && j < m && a[i].text === b[j].text)) {
      if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) i++;
      else j++;
    }
    flush(ai, bj);
    if (i < n && j < m) {
      anchor = b[j].to;
      i++;
      j++;
    }
  }
  return hunks;
}

/** Today's text with one hunk restored to how it read then. */
export function applyRestore(now: string, h: Pick<RestoreHunk, "from" | "to" | "insert">): string {
  return now.slice(0, h.from) + h.insert + now.slice(h.to);
}
