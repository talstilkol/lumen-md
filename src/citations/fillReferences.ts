/**
 * "Fill references from OpenAlex" (plan W12.X3): the caller of the gated
 * OpenAlex lookup (./openAlexLookup.ts) for a source note with a DOI.
 *
 *  - Only a source note (`type: source`, W12.X2) whose `doi:` (or a
 *    doi.org `url:`) holds a DOI is looked up.
 *  - The lookup is the gated one: nothing is sent while the Settings switch
 *    is off, the user is asked before every lookup, and only the DOI goes
 *    to api.openalex.org.
 *  - What OpenAlex returns becomes a proposal in the property review queue
 *    (properties/autofill.ts, the queue "AI: Fill Properties…" uses):
 *    `references:` before → after. Nothing is written here; the queue's
 *    approve() is the only writer, and only while the note is still the
 *    text the proposal was computed from.
 *
 * `references:` keeps what the note had and adds the DOIs it lacked (bare,
 * lower case, as the citation graph reads them).
 */
import { readProperties, setProperty } from "../properties/frontmatter";
import type { AutofillQueue, Proposal } from "../properties/autofill";
import type { LookupOptions } from "./openAlexLookup";

/** A DOI's bare, lower-case form (`https://doi.org/…` and `doi:` stripped). */
export const normDoi = (v: string): string =>
  v
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();

const DOI_RE = /^10\.\d{4,9}\/\S+$/;

/** The note's DOI when it is a source note that has one; null otherwise. */
export function sourceDoi(text: string): string | null {
  let props;
  try {
    props = readProperties(text);
  } catch {
    return null; // why: a broken front matter is not a source note
  }
  const get = (k: string) => props.find((p) => p.key.toLowerCase() === k)?.value;
  const type = get("type");
  const types = Array.isArray(type) ? type : [type];
  if (!types.some((x) => typeof x === "string" && x.trim().toLowerCase() === "source")) return null;
  for (const k of ["doi", "url"]) {
    const v = get(k);
    if (typeof v !== "string" || !v.trim()) continue;
    if (k === "url" && !/^https?:\/\/(dx\.)?doi\.org\//i.test(v.trim())) continue;
    const d = normDoi(v);
    if (DOI_RE.test(d)) return d;
  }
  return null;
}

/** The `references:` proposal for `path`: the note's references plus the DOIs it lacks; null when none is new. */
export function referencesProposal(path: string, text: string, dois: readonly string[]): Proposal | null {
  const before = readProperties(text).find((p) => p.key === "references")?.value;
  const had = (Array.isArray(before) ? before : typeof before === "string" && before.trim() ? [before] : []).filter((x): x is string => typeof x === "string");
  const seen = new Set(had.map(normDoi));
  const after = [...had];
  for (const d of dois) {
    const n = normDoi(d);
    if (!DOI_RE.test(n) || seen.has(n)) continue;
    seen.add(n);
    after.push(n);
  }
  if (after.length === had.length) return null;
  return {
    id: `${path}#openalex-references`,
    path,
    base: text,
    next: setProperty(text, "references", after),
    changes: [{ key: "references", before: before ?? null, after }],
  };
}

export type FillResult =
  | { status: "no-doi" | "off" | "declined" | "unchanged" }
  | { status: "queued"; added: number; proposal: Proposal };

/**
 * Look up the references of the source note at `path` (its saved text is
 * `text`) and queue them for review. Writes nothing.
 */
export async function fillReferencesFromOpenAlex(
  note: { path: string; text: string },
  queue: Pick<AutofillQueue, "add">,
  opts: Pick<LookupOptions, "ask" | "fetch"> = {},
): Promise<FillResult> {
  const doi = sourceDoi(note.text);
  if (!doi) return { status: "no-doi" };
  const { lookupOpenAlexReferences } = await import("./openAlexLookup");
  const r = await lookupOpenAlexReferences(doi, opts);
  if (r.status !== "done") return { status: r.status };
  const proposal = referencesProposal(note.path, note.text, r.dois);
  if (!proposal) return { status: "unchanged" };
  queue.add(proposal);
  const c = proposal.changes[0];
  const had = Array.isArray(c.before) ? c.before.length : c.before ? 1 : 0;
  return { status: "queued", added: (c.after as string[]).length - had, proposal };
}
