/** Split out of exportFormats.ts (W12 format round trip) so the exporters can share it without an import cycle. */

/**
 * CommonMark-style fenced-code tracker. A fence opens with ``` or ~~~ (3+,
 * up to 3 spaces indent) and closes only on a line of the SAME character,
 * at least as long, with nothing else on it — so a ```` block that
 * demonstrates a ``` fence (or a ~~~ line inside ```) stays code.
 * Feed every line in order; returns whether it is a fence line and whether
 * we're inside code after it.
 */
export function createFenceTracker(): (line: string) => { fence: boolean; inCode: boolean } {
  let open: { ch: string; len: number } | null = null;
  return (line: string) => {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open) {
      if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
        open = { ch: m[1][0], len: m[1].length };
        return { fence: true, inCode: true };
      }
      return { fence: false, inCode: false };
    }
    if (m && m[1][0] === open.ch && m[1].length >= open.len && m[2].trim() === "") {
      open = null;
      return { fence: true, inCode: false };
    }
    return { fence: false, inCode: true };
  };
}
