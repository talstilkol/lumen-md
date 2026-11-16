/**
 * One slug for headings and one key for note names (MASTER_PLAN v3, T26).
 *
 * Headings: exactly what `rehype-slug` puts in the preview's `id`s
 * (github-slugger, Unicode-aware), so an outline entry, a `[[note#heading]]`
 * link and the scroll sync all land on the heading — including Hebrew
 * ones, which the four old ASCII-only copies turned into an empty id.
 *
 * Release tags: `releaseTagSlug`, ASCII only, because a git tag and a GitHub
 * release URL carry it (plan 12.2: the one slug module; it was
 * ai/modelHosting.ts's own `slug`). lib/utils.ts's ASCII `slugify` (it
 * dropped every Hebrew letter) and renderer/remarkLumen.ts's `slug` (a copy
 * of headingSlug) are gone.
 *
 * Notes: a name compares by `noteKey` — case-, niqqud-, final-letter- and
 * whitespace-insensitive, `.md` dropped — never by slug, so `[[שלום עולם]]`
 * finds `שלום עולם.md` and no longer matches every other Hebrew note.
 */

import GithubSlugger, { slug as githubSlug } from "github-slugger";
import { normalizeForMatch, stripNiqqud } from "../text/hebrew";

/** The id rehype-slug gives a heading with this text (first occurrence). */
export function headingSlug(text: string): string {
  return githubSlug(text);
}

/**
 * The element id a wiki link's `#fragment` names: a block reference (`^id`,
 * plan 4.8) is the block's own id; anything else is a heading, by its slug.
 */
export function wikiFragmentId(fragment: string): string {
  return fragment.startsWith("^") ? fragment : headingSlug(fragment);
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

/**
 * A page file name for a title in an exported site (plan 9.3): the heading
 * slug — Unicode-aware, so `מדריך התקנה` → `מדריך-התקנה` and not an empty
 * string turned into `page-3` — with niqqud and cantillation removed (a URL
 * and a file name should not depend on vowel marks), runs of dashes folded,
 * at most 80 characters. Empty → `fallback`.
 */
export function pageFileSlug(title: string, fallback: string): string {
  const s = githubSlug(stripNiqqud(title))
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return Array.from(s).slice(0, 80).join("").replace(/-+$/, "") || fallback;
}

/**
 * Words joined by `-` (plan 12.2, audit r3 W10.E27: the copies in
 * research/clipTemplateStore.ts, research/clipTemplates.ts, capture/voiceCapture.ts
 * and mobile/captureQueue.ts are this one function): every run of characters
 * that is not a letter or a digit (any script, so Hebrew stays) becomes one
 * `-`, none at either end. `lower` lowercases first, `nfc` normalises first,
 * `max` cuts to that many UTF-16 units and drops a `-` left at the cut.
 * Template ids and attachment names depend on it: its output must not change.
 */
export function wordSlug(text: string, opts: { lower?: boolean; nfc?: boolean; max?: number } = {}): string {
  let s = opts.nfc ? text.normalize("NFC") : text;
  if (opts.lower) s = s.toLowerCase();
  s = s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return opts.max === undefined ? s : s.slice(0, opts.max).replace(/-+$/, "");
}

/**
 * A release-tag segment for a model id: "onnx-community/whisper-base" →
 * "onnx-community-whisper-base". ASCII letters, digits, `.`, `_` and `-`;
 * anything else becomes one `-`; no leading or trailing `-`. Published tags
 * (`models-<slug>`) depend on it, so its output must never change.
 */
export function releaseTagSlug(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
