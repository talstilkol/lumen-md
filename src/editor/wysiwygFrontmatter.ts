/**
 * Split a leading YAML frontmatter block off a markdown document. Milkdown
 * has no frontmatter concept — fed raw, `---\ntitle: …\n---` renders as a
 * thematic break + loose text (ugly, and editing it corrupts the metadata).
 * We keep the block verbatim and re-prepend it on every emission, so the
 * metadata survives WYSIWYG editing invisibly.
 *
 * Its own module (no Milkdown import), so tests of the save path can use it
 * without loading the editor.
 */
export function splitFrontmatter(md: string): { fm: string; body: string } {
  const m = md.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: "", body: md };
  return { fm: m[0], body: md.slice(m[0].length) };
}
