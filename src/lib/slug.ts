/**
 * One slug for headings and one key for note names (MASTER_PLAN v3, T26).
 *
 * Headings: exactly what `rehype-slug` puts in the preview's `id`s
 * (github-slugger, Unicode-aware), so an outline entry, a `[[note#heading]]`
 * link and the scroll sync all land on the heading — including Hebrew
 * ones, which the four old ASCII-only copies turned into an empty id.
 *
 * Notes: a name compares by `noteKey` — case-, niqqud-, final-letter- and
 * whitespace-insensitive, `.md` dropped — never by slug, so `[[שלום עולם]]`
 * finds `שלום עולם.md` and no longer matches every other Hebrew note.
 */

import GithubSlugger, { slug as githubSlug } from "github-slugger";
import { normalizeForMatch } from "../text/hebrew";

/** The id rehype-slug gives a heading with this text (first occurrence). */
export function headingSlug(text: string): string {
  return githubSlug(text);
}

/** A slugger that numbers repeats (`a`, `a-1`, …) the way the preview does. */
export function headingSlugger(): { slug: (text: string) => string } {
  const s = new GithubSlugger();
  return { slug: (text: string) => s.slug(text) };
}

/** Comparison key for a note name or wiki-link target. */
export function noteKey(name: string): string {
  return normalizeForMatch(name.replace(/\.(md|markdown)$/i, ""))
    .replace(/[\s_]+/g, " ")
    .trim();
}
