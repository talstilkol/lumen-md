/**
 * Size and nesting bounds for YAML that comes from a note (front matter) or
 * a `.base` file, checked in one linear pass before the YAML parser runs.
 *
 * The `yaml` parser's cost grows steeply with flow-collection depth: in the
 * fuzz run (W1.27, seed 1 #6) 11 KB of nested `[` under one key hung the
 * front-matter decoder on a loaded machine, and a 3 KB `.base` file of nested
 * `[` took 0.6–2 s (W4.16). Real front matter nests two or three levels and
 * stays a few KB, so text past these bounds is refused like any other
 * invalid YAML: the caller sees "no front matter", never a frozen tab.
 */
import YAML from "yaml";

/** The deepest run of unclosed `[` / `{` a YAML block may have. */
export const MAX_YAML_FLOW_DEPTH = 64;

/** The largest front-matter block (UTF-16 code units) that is parsed. */
export const MAX_FRONTMATTER_CHARS = 256 * 1024;

/** The deepest run of unclosed `[` / `{` in `text`. Quotes are not considered, so it can only over-count. */
export function yamlFlowDepth(text: string): number {
  let depth = 0;
  let max = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 91 || c === 123) {
      if (++depth > max) max = depth;
    } else if ((c === 93 || c === 125) && depth > 0) depth--;
  }
  return max;
}

/** Why `text` is refused before parsing, or null when it is within the bounds. */
export function yamlBoundsError(text: string, maxChars = MAX_FRONTMATTER_CHARS): string | null {
  if (text.length > maxChars) return `longer than ${maxChars} characters`;
  if (yamlFlowDepth(text) > MAX_YAML_FLOW_DEPTH) return `nested deeper than ${MAX_YAML_FLOW_DEPTH} levels`;
  return null;
}

/**
 * Parse a front-matter block (the text between the `---` lines). Returns
 * the parsed value, or null for a block past the bounds. Throws what
 * YAML.parse throws for invalid YAML, as before, so callers keep their own
 * catch.
 */
export function parseFrontmatterYaml(block: string): unknown {
  if (yamlBoundsError(block) !== null) return null;
  return YAML.parse(block);
}
