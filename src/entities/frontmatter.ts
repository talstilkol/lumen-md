/**
 * YAML front matter of entity notes (plan W12.E1): split and parse, the
 * body kept byte for byte. Own small helper, so the entity graph does not
 * reach into the lazily loaded import wizard (storage/import/).
 */
import { parse } from "yaml";

export type Props = Record<string, unknown>;

/** The front matter block and its offsets; null when the note has none. */
export const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/;

/** A note's front matter (parsed; {} when none or broken) and body. */
export function splitFrontmatter(text: string): { props: Props; body: string; broken: boolean } {
  const m = FRONTMATTER.exec(text);
  if (!m) return { props: {}, body: text, broken: false };
  try {
    const v = parse(m[1]) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return { props: v as Props, body: text.slice(m[0].length), broken: false };
    return { props: {}, body: text.slice(m[0].length), broken: v !== null && v !== undefined };
  } catch {
    return { props: {}, body: text, broken: true };
  }
}
