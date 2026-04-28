/**
 * Tiny YAML-frontmatter parser shared between the MCP server's
 * `update_frontmatter` / `list_tags` tools and any future caller.
 *
 * Handles the common subset that Lumen documents actually use:
 *   - Scalar string values (with optional quoting)
 *   - Inline arrays `[a, b, c]` with optional double-quoted entries
 *   - Nothing else — full YAML would pull a 30 KB dep we don't need.
 *
 * The split lives in its own file so vitest can import the helpers
 * without triggering `src/index.ts`'s top-level `server.connect()`
 * side effect.
 */

export interface Frontmatter {
  data: Record<string, unknown>;
  /** Offset in the original text at which the body (post-frontmatter) starts. */
  bodyStart: number;
  /** The raw header without the surrounding `---` lines, or null. */
  rawHeader: string | null;
}

export function parseFrontmatter(text: string): Frontmatter {
  if (!text.startsWith("---\n")) return { data: {}, bodyStart: 0, rawHeader: null };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { data: {}, bodyStart: 0, rawHeader: null };
  const header = text.slice(4, end);
  const data: Record<string, unknown> = {};
  for (const line of header.split("\n")) {
    const m = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^"(.+)"$/, "$1"))
        .filter((s) => s.length > 0);
    } else {
      data[key] = value.replace(/^"(.+)"$/, "$1");
    }
  }
  return { data, bodyStart: end + 5, rawHeader: header };
}

export function serializeFrontmatter(data: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`);
    } else if (typeof v === "string" && /[:#&*?{}|]/.test(v)) {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  return `---\n${lines.join("\n")}\n---\n`;
}

/**
 * Aggregate `tags:` values across many notes into a tag → count map.
 * Handles both array form (`tags: [a, b]`) and space-separated string
 * form (`tags: a b #c`).
 */
export function aggregateTags(notes: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of notes) {
    const fm = parseFrontmatter(text);
    const tags = fm.data.tags;
    if (Array.isArray(tags)) {
      for (const t of tags) {
        const key = String(t).toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    } else if (typeof tags === "string") {
      for (const t of tags.split(/[,\s]+/)) {
        const key = t.replace(/^#/, "").toLowerCase();
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}
