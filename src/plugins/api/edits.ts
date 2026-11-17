/**
 * `lumen.document.applyEdits` (plugin API 1.1.0, W13.L1): a batch of
 * replacements in the coordinates of the text before the batch, applied as
 * one change. It replaces `document.setText`, which rewrote the whole note
 * and lost the cursor, the selection and the user's undo steps.
 */

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

export const MAX_TEXT_EDITS = 5000;
export const MAX_EDIT_INSERT = 1024 * 1024;

/** Validate a plugin's edits against a text of `length` UTF-16 units: sorted, in range, not overlapping. Throws RangeError/TypeError. */
export function validateEdits(input: unknown, length: number): TextEdit[] {
  if (!Array.isArray(input)) throw new TypeError("edits must be an array of { from, to, insert }");
  if (input.length > MAX_TEXT_EDITS) throw new RangeError(`at most ${MAX_TEXT_EDITS} edits in one call`);
  let total = 0;
  const edits = input.map((e, i): TextEdit => {
    if (!e || typeof e !== "object") throw new TypeError(`edits[${i}] must be { from, to, insert }`);
    const { from, to, insert } = e as Record<string, unknown>;
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new TypeError(`edits[${i}]: from and to must be integers`);
    if (typeof insert !== "string") throw new TypeError(`edits[${i}].insert must be a string`);
    const f = from as number;
    const t = to as number;
    if (f < 0 || t < f || t > length) throw new RangeError(`edits[${i}]: [${f}, ${t}) is outside the note (length ${length})`);
    total += insert.length;
    if (total > MAX_EDIT_INSERT) throw new RangeError(`edits insert more than ${MAX_EDIT_INSERT} characters`);
    return { from: f, to: t, insert };
  });
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from < sorted[i - 1].to) throw new RangeError(`edits overlap at ${sorted[i].from}`);
  }
  return sorted;
}

/** Apply validated, sorted edits to `text`. */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  let out = "";
  let at = 0;
  for (const e of edits) {
    out += text.slice(at, e.from) + e.insert;
    at = e.to;
  }
  return out + text.slice(at);
}
