/**
 * The note's list numbering (plan W13.H5), on its own so the preview reads
 * it without loading the numerals and the stylesheet (lib/hebrewListNumbering,
 * loaded only for a note that asks).
 */
export type ListNumbering = "decimal" | "hebrew";

/** From the parsed frontmatter: `listNumbering: hebrew` (or `list-numbering`, `he`, `עברית`). */
export function listNumberingOf(frontmatter: Record<string, unknown> | null | undefined): ListNumbering {
  const v = frontmatter?.listNumbering ?? frontmatter?.["list-numbering"];
  return typeof v === "string" && /^(hebrew|he|עברי(ת)?)$/i.test(v.trim()) ? "hebrew" : "decimal";
}
