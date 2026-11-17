/**
 * Day One (plan W13.F2): the JSON export (File → Export → JSON) is a .zip
 * of `<Journal>.json` (`{ metadata, entries: [...] }`) with the media in
 * `photos/`, `videos/`, `audios/` and `pdfs/`, each named by its MD5.
 *
 * Each entry becomes `<Journal>/<YYYY>/<YYYY-MM-DD> <title>.md`:
 *  - the text as Day One wrote it (Markdown), its `\.` / `\-` escapes undone
 *    where they are not needed, and every `dayone-moment://<id>` pointing at
 *    the file the export holds for it (a missing one is reported);
 *  - `created` / `updated`, `tags`, `starred`, `pinned`; the place as
 *    `place` (name, locality, country) and `coordinates: [lat, lng]`
 *    (what Lumen's map reads); the weather as `weather` (`Partly Cloudy,
 *    18°C`); the device, the time zone and the step count when present.
 */
import { claimPath, mdDest, relativeTo, safeName } from "./names";
import { isoDate, withFrontmatter, type Props } from "./frontmatter";
import { emptyVault, type ConvertedVault } from "./types";
import { swallowed } from "../../lib/logger";

interface Media {
  identifier?: string;
  md5?: string;
  type?: string;
}

interface Entry {
  uuid?: string;
  text?: string;
  creationDate?: string;
  modifiedDate?: string;
  timeZone?: string;
  tags?: string[];
  starred?: boolean;
  isPinned?: boolean;
  creationDevice?: string;
  location?: { placeName?: string; localityName?: string; administrativeArea?: string; country?: string; latitude?: number; longitude?: number };
  weather?: { conditionsDescription?: string; temperatureCelsius?: number; weatherCode?: string };
  userActivity?: { stepCount?: number; activityName?: string };
  photos?: Media[];
  videos?: Media[];
  audios?: Media[];
  pdfAttachments?: Media[];
}

/** Does this JSON look like a Day One export? */
export function looksLikeDayOne(json: unknown): boolean {
  const j = json as { metadata?: { version?: unknown }; entries?: unknown };
  return !!j && typeof j === "object" && Array.isArray(j.entries) && !!j.metadata && (j.entries as Entry[]).every((e) => e && typeof e === "object" && ("creationDate" in e || "uuid" in e));
}

/** Day One escapes Markdown punctuation it did not need to (`1\.`, `\-`, `\!`): undone outside code. */
export function dayOneText(text: string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) => (i % 2 ? part : part.replace(/\\([.\-!()+#>])/g, (m, c: string, off: number, s: string) => (c === "-" && /^\s*$/.test(s.slice(s.lastIndexOf("\n", off) + 1, off)) ? m : c))))
    .join("");
}

const MEDIA_DIRS: Record<string, string> = { photos: "photos", videos: "videos", audios: "audios", pdfAttachments: "pdfs" };
const MEDIA_KEYS = Object.keys(MEDIA_DIRS) as (keyof Entry)[];

function title(entry: Entry): string {
  const first = (entry.text ?? "").split("\n").find((l) => l.trim() && !/^!\[/.test(l.trim())) ?? "";
  return first
    .replace(/^#+\s*/, "")
    .replace(/[*_`~=[\]\\]/g, "")
    .replace(/\(dayone-moment:[^)]*\)/g, "")
    .trim()
    .slice(0, 60);
}

export function convertDayOne(files: Map<string, Uint8Array>): ConvertedVault {
  const vault = emptyVault();
  const taken = new Set<string>();
  const dec = new TextDecoder();
  // The media: `photos/<md5>.<type>` → kept at the same path.
  const byMd5 = new Map<string, string>();
  for (const [p, data] of files) {
    if (/\.json$/i.test(p)) continue;
    if (/(^|\/)(\.DS_Store|__MACOSX)/.test(p)) {
      vault.skipped.push({ path: p, reason: "appFolder" });
      continue;
    }
    vault.sourceAttachments++;
    const target = claimPath(taken, p.normalize("NFC"));
    vault.attachments.set(target, data);
    const m = /(^|\/)(photos|videos|audios|pdfs)\/([0-9a-f]{32})\.[a-z0-9]+$/i.exec(p);
    if (m) byMd5.set(`${m[2].toLowerCase()}/${m[3].toLowerCase()}`, target);
  }
  for (const [p, data] of files) {
    if (!/\.json$/i.test(p)) continue;
    let json: unknown;
    try {
      json = JSON.parse(dec.decode(data));
    } catch (e) {
      swallowed("import/dayOne: a file is not JSON; it is listed as skipped", e);
      vault.skipped.push({ path: p, reason: "unreadable" });
      continue;
    }
    if (!looksLikeDayOne(json)) {
      vault.skipped.push({ path: p, reason: "unreadable" });
      continue;
    }
    const journal = safeName(p.replace(/^.*\//, "").replace(/\.json$/i, ""), "Journal");
    for (const entry of (json as { entries: Entry[] }).entries) {
      if (!(entry.text ?? "").trim() && !MEDIA_KEYS.some((k) => (entry[k] as Media[] | undefined)?.length)) {
        vault.skipped.push({ path: `${p}#${entry.uuid ?? "?"}`, reason: "empty" });
        continue;
      }
      const created = isoDate(entry.creationDate ? new Date(entry.creationDate) : undefined);
      const day = created?.slice(0, 10);
      const name = [day, title(entry)].filter(Boolean).join(" ") || entry.uuid || "Entry";
      const notePath = claimPath(taken, `${journal}/${day ? `${day.slice(0, 4)}/` : ""}${safeName(name)}.md`);
      const fromDir = notePath.slice(0, notePath.lastIndexOf("/"));
      // Each moment id → the file the export holds for it.
      const moments = new Map<string, string>();
      let missing = 0;
      for (const [key, dir] of Object.entries(MEDIA_DIRS)) {
        for (const m of (entry[key as keyof Entry] as Media[] | undefined) ?? []) {
          const target = m.md5 ? byMd5.get(`${dir}/${m.md5.toLowerCase()}`) : undefined;
          if (m.identifier && target) moments.set(m.identifier.toUpperCase(), target);
          else missing++;
        }
      }
      const used = new Set<string>();
      let body = dayOneText(entry.text ?? "").replace(/(!?\[[^\]]*\])\(dayone-moment:\/*(?:[A-Za-z]+\/)?([0-9A-Fa-f-]+)\)/g, (m, label: string, id: string) => {
        const target = moments.get(id.toUpperCase());
        if (!target) return m;
        used.add(target);
        return `${label}(${mdDest(relativeTo(fromDir, target))})`;
      });
      // Media the text does not show: listed below it, so nothing is lost.
      const rest = [...moments.values()].filter((t) => !used.has(t));
      if (rest.length) body = `${body.trimEnd()}\n\n${rest.map((t) => `![](${mdDest(relativeTo(fromDir, t))})`).join("\n")}`;
      if (missing) vault.warnings.push({ path: notePath, reason: "missingAttachment", detail: String(missing) });
      const loc = entry.location;
      const w = entry.weather;
      const props: Props = {
        created,
        updated: isoDate(entry.modifiedDate ? new Date(entry.modifiedDate) : undefined),
        tags: entry.tags?.length ? entry.tags.map((t) => t.trim().replace(/\s+/g, "-")) : undefined,
        starred: entry.starred || undefined,
        pinned: entry.isPinned || undefined,
        place: loc ? [loc.placeName, loc.localityName, loc.administrativeArea, loc.country].filter(Boolean).join(", ") || undefined : undefined,
        coordinates: loc && typeof loc.latitude === "number" && typeof loc.longitude === "number" ? [loc.latitude, loc.longitude] : undefined,
        weather: w ? [w.conditionsDescription, typeof w.temperatureCelsius === "number" ? `${Math.round(w.temperatureCelsius)}°C` : undefined].filter(Boolean).join(", ") || undefined : undefined,
        steps: entry.userActivity?.stepCount,
        device: entry.creationDevice,
        timezone: entry.timeZone,
      };
      if (!created) vault.warnings.push({ path: notePath, reason: "noDates" });
      vault.notes.set(notePath, withFrontmatter(props, `${body.trim()}\n`));
    }
  }
  return vault;
}
