/**
 * Gap links through the approval screen (plan W13.G8): each chosen gap
 * becomes one staged change — the bridge note gains a "See also" line with
 * a link to the note across the gap and the terms they share — proposed by
 * the link agent and waiting in the review panel. Nothing is written here:
 * only the user's approval writes (agents/staging.ts), and the panel shows
 * the diff first.
 *
 * A note that changed since it was read is not overwritten: staging keeps
 * the text it was computed from (`before`), and approval refuses a change
 * whose file moved on (`conflict`).
 */
import { stageChange } from "../agents/staging";
import type { StagedChange } from "../agents/types";
import type { Gap } from "./clusterGaps";

export const GAP_TOOL = "suggest_gap_links";
export const GAP_AGENT = "links";

/** `[[name]]` when the name is unique among `paths`, else `[[folder/name]]`. */
export function wikiLink(path: string, paths: readonly string[]): string {
  const base = path.split("/").pop()!.replace(/\.md$/i, "");
  const same = paths.filter((p) => p.split("/").pop()!.replace(/\.md$/i, "").toLowerCase() === base.toLowerCase()).length;
  return `[[${same > 1 ? path.replace(/\.md$/i, "") : base}]]`;
}

/** The note with the "See also" line added (once: a note that already links there is left as it is). */
export function withSeeAlso(text: string, link: string, line: string): string | null {
  const target = link.slice(2, -2).toLowerCase();
  const linked = [...text.matchAll(/\[\[([^\]|#]+)/g)].some((m) => m[1].trim().toLowerCase() === target || m[1].trim().toLowerCase().endsWith(`/${target}`));
  if (linked) return null;
  return `${text.replace(/\s*$/, "")}\n\n${line}\n`;
}

export interface StageGapsOptions {
  gaps: readonly Gap[];
  /** Every note path in the graph (for unique link names). */
  paths: readonly string[];
  read: (path: string) => Promise<string>;
  /** The line to add, from the link and the shared terms (localised by the caller). */
  line: (link: string, terms: string) => string;
  summary: (from: string, to: string) => string;
  /** Tests: stage elsewhere. */
  stage?: typeof stageChange;
}

/** One staged proposal per gap (skipping a note that already links across); the changes, in gap order. */
export async function stageGapLinks(o: StageGapsOptions): Promise<StagedChange[]> {
  const stage = o.stage ?? stageChange;
  const out: StagedChange[] = [];
  for (const g of o.gaps) {
    const before = await o.read(g.from);
    const link = wikiLink(g.to, o.paths);
    const after = withSeeAlso(before, link, o.line(link, g.shared.slice(0, 3).join(", ")));
    if (after === null) continue;
    out.push(stage({ kind: "file", path: g.from, before, after, summary: o.summary(g.from, g.to) }, { tool: GAP_TOOL, agentId: GAP_AGENT }));
  }
  return out;
}
