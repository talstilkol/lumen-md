/**
 * The reading profile in a note's frontmatter (plan W13.R1):
 *
 *     ---
 *     title: …
 *     lumen-reading: {mode: rsvp, wpm: 320, nikud: show, width: 60}
 *     ---
 *
 * One flow map on one line, only the keys the note changes. Reading accepts
 * a block map too (a hand-written one). Writing touches only that key's
 * line(s): the rest of the frontmatter and the body stay byte for byte
 * (src/properties/frontmatter.ts removes an old value; this module writes
 * the new line where the old one was). A frontmatter that does not parse is
 * never written — `writeFileProfile` throws `FrontmatterError` and the menu
 * offers "this device only" instead.
 *
 * "This device only" (`saveLocalNoteProfile`, ./settings.ts) never changes
 * the note: the hash of the file is the same before and after
 * (src/__tests__/readingProfile.test.ts).
 */
import { FrontmatterError, parseProperties, removeProperty } from "../properties/frontmatter";
import { applyReading, globalProfile, localNoteProfile, profileDiff, resolveProfile, sparseProfile, PROFILE_KEYS, type ProfileSource, type ReadingProfile } from "./settings";

export const PROFILE_KEY = "lumen-reading";

/** Cheap test (no YAML parse): may this note carry a profile? The app loads this module only then. */
export function mayHaveFileProfile(content: string): boolean {
  if (!content.startsWith("---") && !content.startsWith("\uFEFF---")) return false;
  const end = content.indexOf("\n---", 3);
  const fm = end < 0 ? content.slice(0, 4096) : content.slice(0, end + 1);
  return /(^|\n)lumen-reading\s*:/.test(fm);
}

/** The note's own profile from its frontmatter (sparse; {} when it has none or the YAML is invalid). */
export function fileProfile(content: string): Partial<ReadingProfile> {
  if (!mayHaveFileProfile(content)) return {};
  const p = parseProperties(content);
  if (p.status !== "ok") return {};
  const prop = p.properties.find((x) => x.key === PROFILE_KEY);
  return prop ? sparseProfile(prop.value) : {};
}

const PLAIN = /^[A-Za-z][\w-]*$/;
const YAML_WORDS = /^(true|false|yes|no|on|off|null|~)$/i;

/** One flow map, keys in the schema's order: `{mode: rsvp, wpm: 320}`. */
export function profileYaml(p: Partial<ReadingProfile>): string {
  const s = sparseProfile(p);
  const parts: string[] = [];
  for (const k of PROFILE_KEYS) {
    if (!(k in s)) continue;
    const v = s[k];
    const text = typeof v === "string" ? (PLAIN.test(v) && !YAML_WORDS.test(v) ? v : JSON.stringify(v)) : String(v);
    parts.push(`${k}: ${text}`);
  }
  return `{${parts.join(", ")}}`;
}

const FENCE = /^(\uFEFF?)---[ \t]*(\r?\n)([\s\S]*?)(^---[ \t]*\r?$)/m;

/**
 * `content` with its `lumen-reading` set to `p` (sparse). An empty `p`
 * removes the key. When the note has no frontmatter one is added at the top.
 * Throws FrontmatterError when the frontmatter does not parse.
 */
export function writeFileProfile(content: string, p: Partial<ReadingProfile> | null): string {
  const sparse = p ? sparseProfile(p) : {};
  const parsed = parseProperties(content);
  if (parsed.status === "invalid") throw new FrontmatterError(parsed.error ?? "invalid frontmatter");
  const has = parsed.properties.some((x) => x.key === PROFILE_KEY);
  if (!Object.keys(sparse).length) return has ? removeProperty(content, PROFILE_KEY) : content;
  const line = `${PROFILE_KEY}: ${profileYaml(sparse)}`;
  if (parsed.status === "none") {
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
    return `${bom}---${eol}${line}${eol}---${eol}${content.slice(bom.length)}`;
  }
  const m = FENCE.exec(content);
  if (!m || m.index !== 0) throw new FrontmatterError("frontmatter fence not found");
  const eol = m[2];
  const bodyStart = m[0].indexOf(eol) + eol.length;
  if (has) {
    // Where the old value started: the new line goes in its place.
    const at = new RegExp(`(^|\\n)${PROFILE_KEY}\\s*:`).exec(content.slice(bodyStart));
    const offset = at ? bodyStart + at.index + at[1].length : -1;
    const removed = removeProperty(content, PROFILE_KEY);
    if (offset >= 0 && offset <= removed.length) return removed.slice(0, offset) + line + eol + removed.slice(offset);
    return writeFileProfile(removed, sparse);
  }
  const close = m.index + m[0].length - m[4].length;
  const before = content.slice(0, close);
  const sep = before.endsWith("\n") ? "" : eol;
  return before + sep + line + eol + content.slice(close);
}

export interface NoteProfile {
  profile: ReadingProfile;
  from: Record<keyof ReadingProfile, ProfileSource>;
  /** The note's own keys, by where they are kept. */
  file: Partial<ReadingProfile>;
  device: Partial<ReadingProfile> | null;
}

/** Everything the reading menu needs for one note. */
export function noteProfile(path: string | null | undefined, content: string): NoteProfile {
  const file = fileProfile(content);
  const device = localNoteProfile(path);
  const { profile, from } = resolveProfile(globalProfile(), file, device);
  return { profile, from, file, device };
}

/** The keys of `p` a note keeps: where it differs from the global profile. */
export function noteKeys(p: Readonly<ReadingProfile>, global: Readonly<ReadingProfile> = globalProfile()): Partial<ReadingProfile> {
  return profileDiff(p, global);
}

/**
 * Put a profile on the page: the typography (W3.5 custom properties and
 * faces) and the aids (W5.6) — only when the profile asks for them or they
 * are already on, so a person who never used the aids loads nothing.
 */
export async function applyProfile(p: Readonly<ReadingProfile>, doc: Document = document): Promise<void> {
  await applyReading(p, doc.documentElement);
  const aidsOn = doc.documentElement.hasAttribute("data-reading-aids");
  if (p.aids || aidsOn) {
    const m = await import("./readingAids");
    const a = m.loadAids();
    m.applyAids({ ...a, dyslexia: p.aids, tint: p.tint, lineFocus: p.lineFocus > 0, rate: p.rate }, doc);
  }
  // W13.R4: anchor emphasis — its module loads only once it is on.
  if (p.anchor || doc.getElementById("lumen-anchor-css")) (await import("./anchorEmphasis")).setAnchor(p.anchor, doc);
  doc.documentElement.setAttribute("data-reading-line-focus", String(p.lineFocus));
  if (!p.lineFocus) doc.documentElement.removeAttribute("data-reading-line-focus");
}
