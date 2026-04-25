/**
 * Tiny BibTeX parser — handles the common subset (entry types, braced and
 * quoted values, comma-separated fields). Not a complete spec, but enough
 * for the typical academic bibliography format.
 */

export interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

const ENTRY_RE = /@(\w+)\s*\{\s*([^,]+?)\s*,([\s\S]*?)\n\s*\}\s*(?=@|\s*$)/g;

export function parseBibtex(input: string): BibEntry[] {
  const text = input.replace(/^\s*%[^\n]*$/gm, ""); // strip comments
  const out: BibEntry[] = [];
  let m: RegExpExecArray | null;
  ENTRY_RE.lastIndex = 0;
  while ((m = ENTRY_RE.exec(text)) !== null) {
    const type = m[1].toLowerCase();
    const key = m[2].trim();
    if (type === "comment" || type === "string" || type === "preamble") continue;
    const fields = parseFields(m[3]);
    out.push({ type, key, fields });
  }
  return out;
}

/** Parse the body between {} of a single entry into a field map. */
function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;
  const N = body.length;
  while (i < N) {
    // skip whitespace + commas
    while (i < N && /[\s,]/.test(body[i])) i++;
    // read field name
    const nameStart = i;
    while (i < N && /[A-Za-z_]/.test(body[i])) i++;
    if (i === nameStart) break;
    const name = body.slice(nameStart, i).toLowerCase();
    // skip whitespace + '='
    while (i < N && /[\s=]/.test(body[i])) i++;
    // read value: braced, quoted, or bare
    let value = "";
    if (body[i] === "{") {
      let depth = 0;
      while (i < N) {
        const ch = body[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        if (depth > 0 && i > 0) value += depth === 1 && ch === "{" ? "" : ch;
        i++;
      }
    } else if (body[i] === '"') {
      i++;
      while (i < N && body[i] !== '"') {
        value += body[i];
        i++;
      }
      i++;
    } else {
      while (i < N && body[i] !== ",") {
        value += body[i];
        i++;
      }
    }
    fields[name] = cleanValue(value.trim());
  }
  return fields;
}

function cleanValue(s: string): string {
  // Collapse whitespace and remove BibTeX `~` non-breaking-space markers.
  return s.replace(/\s+/g, " ").replace(/~/g, " ").trim();
}

/** Format a single BibEntry into a human-readable citation string. */
export function formatEntry(e: BibEntry, n: number): string {
  const author = e.fields.author ? formatAuthors(e.fields.author) : "";
  const title = e.fields.title ? `"${e.fields.title}"` : "";
  const venue =
    e.fields.journal ||
    e.fields.booktitle ||
    e.fields.publisher ||
    e.fields.school ||
    e.fields.institution ||
    "";
  const year = e.fields.year || "";
  const pages = e.fields.pages ? `pp. ${e.fields.pages}` : "";
  const doi = e.fields.doi ? `doi:${e.fields.doi}` : "";
  const url = e.fields.url || "";
  const parts = [`[${n}]`, author, title, venue, pages, year, doi, url].filter(
    Boolean,
  );
  return parts.join(". ");
}

function formatAuthors(raw: string): string {
  // BibTeX uses ` and ` to join multiple authors.
  return raw
    .split(/\s+and\s+/i)
    .map((a) => a.trim())
    .filter(Boolean)
    .join(", ");
}
