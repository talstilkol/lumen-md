/**
 * Tag index — scans every note in the workspace for `tags:` frontmatter
 * and produces an inverted index (tag → list of notes). The Tag panel
 * uses this to render a flat browse view; the auto-tag agent uses it
 * to bias suggestions toward the user's existing vocabulary.
 *
 * Cheap: <100ms on a few hundred notes. Re-runs on `lumen-workspace-changed`.
 */

import {
  isOPFSAvailable,
  listWorkspace,
  readWorkspaceFile,
  isAssetName,
} from "../storage/workspace";
import { extractFrontmatter } from "../renderer/pipeline";

export interface TagBucket {
  tag: string;
  count: number;
  paths: string[];
}

export interface TagsIndex {
  buckets: TagBucket[];
  /** Total number of notes (denominator for "X% tagged" stats). */
  totalNotes: number;
  /** Notes that have no `tags:` field at all. */
  untaggedPaths: string[];
}

function tagsFromFrontmatter(fm: unknown): string[] {
  if (!fm || typeof fm !== "object") return [];
  const tags = (fm as Record<string, unknown>).tags;
  if (Array.isArray(tags)) {
    return tags.map((t) => String(t).toLowerCase()).filter(Boolean);
  }
  if (typeof tags === "string") {
    return tags
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, "").toLowerCase())
      .filter(Boolean);
  }
  return [];
}

export async function buildTagsIndex(): Promise<TagsIndex> {
  if (!isOPFSAvailable()) {
    return { buckets: [], totalNotes: 0, untaggedPaths: [] };
  }
  const list = await listWorkspace({ includeAssets: false });
  const buckets = new Map<string, string[]>();
  const untagged: string[] = [];
  let totalNotes = 0;

  for (const f of list) {
    if (!/\.(md|markdown)$/i.test(f.path)) continue;
    if (isAssetName(f.name)) continue;
    totalNotes++;
    let body: string;
    try {
      body = await readWorkspaceFile(f.path);
    } catch {
      continue;
    }
    const fm = extractFrontmatter(body) ?? {};
    const tags = tagsFromFrontmatter(fm);
    if (tags.length === 0) {
      untagged.push(f.path);
      continue;
    }
    for (const t of tags) {
      const arr = buckets.get(t) ?? [];
      arr.push(f.path);
      buckets.set(t, arr);
    }
  }

  // Sort buckets by descending size so the densest tags surface first.
  const out: TagBucket[] = [...buckets.entries()]
    .map(([tag, paths]) => ({ tag, count: paths.length, paths: paths.sort() }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  return { buckets: out, totalNotes, untaggedPaths: untagged.sort() };
}
