/**
 * Apple Journal (plan W13.F2): the export (Journal → Settings → Export)
 * is a folder of `Entries/<date>.html` with the photos, audio and the rest in
 * `Resources/`, and an `index.html` that lists them.
 *
 * Each entry becomes `Entries/<date> <title>.md`: the reflection prompt as a
 * quote, the text as paragraphs, every photo or file of the entry embedded
 * below it (so none is lost), and the rest of the entry's grid — place,
 * state of mind, activity, contact, music or podcast — as properties.
 * The date comes from the page header (English or Hebrew), or the file name.
 */
import { claimPath, dirOf, mdEmbed, resolveRel, safeName, stemOf } from "./names";
import { withFrontmatter, type Props } from "./frontmatter";
import { emptyVault, type ConvertedVault } from "./types";
import { swallowed } from "../../lib/logger";

const EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

/** `Sunday, 3 November 2024`, `Sunday, November 3, 2024`, `יום ראשון, 3 בנובמבר 2024` → `2024-11-03`. */
export function journalHeaderDate(header: string): string | null {
  const s = header.normalize("NFC").trim();
  const iso = (y: string, m: number, d: string) => (m >= 0 && +d >= 1 && +d <= 31 ? `${y}-${String(m + 1).padStart(2, "0")}-${d.padStart(2, "0")}` : null);
  let m = /(\d{1,2}) ([A-Za-z]+),? (\d{4})/.exec(s);
  if (m) return iso(m[3], EN_MONTHS.indexOf(m[2].toLowerCase()), m[1]);
  m = /([A-Za-z]+) (\d{1,2}),? (\d{4})/.exec(s);
  if (m) return iso(m[3], EN_MONTHS.indexOf(m[1].toLowerCase()), m[2]);
  m = /(\d{1,2}) ב?([א-ת]+) (\d{4})/.exec(s);
  if (m) return iso(m[3], HE_MONTHS.indexOf(m[2]), m[1]);
  return null;
}

/** The grid item's kind (`assetType_stateOfMind` → `state-of-mind`). */
const kindOf = (cls: string) => cls.replace(/^assetType_/, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();

/** Kinds whose text is a property; photos, videos and audio are files, embedded. */
const PROPERTY_KINDS: Record<string, string> = {
  "multi-pin-map": "place",
  location: "place",
  "state-of-mind": "state-of-mind",
  contact: "contact",
  "motion-activity": "motion-activity",
  workout: "workout",
  "third-party-media": "third-party-media",
  "generic-media": "media",
};

/** A paragraph's inline HTML → Markdown text (bold, italic, links; the rest as text). */
function inlineMd(node: Node): string {
  if (node.nodeType === 3) return (node.nodeValue ?? "").replace(/\s+/g, " ");
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const inner = Array.from(el.childNodes).map(inlineMd).join("");
  const tag = el.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (!inner.trim()) return inner;
  if (tag === "b" || tag === "strong") return `**${inner.trim()}**`;
  if (tag === "i" || tag === "em") return `*${inner.trim()}*`;
  if (tag === "a" && el.getAttribute("href")) return `[${inner.trim()}](${el.getAttribute("href")})`;
  return inner;
}

export function convertAppleJournal(files: Map<string, Uint8Array>): ConvertedVault {
  const vault = emptyVault();
  const taken = new Set<string>();
  const dec = new TextDecoder();
  const resources = new Map<string, string>();
  for (const [p, data] of files) {
    if (/\.html?$/i.test(p)) continue;
    if (/(^|\/)\.DS_Store$/.test(p)) {
      vault.skipped.push({ path: p, reason: "appFolder" });
      continue;
    }
    vault.sourceAttachments++;
    const target = claimPath(taken, p.normalize("NFC"));
    vault.attachments.set(target, data);
    resources.set(p.normalize("NFC").toLowerCase(), target);
  }
  for (const [p, data] of files) {
    if (!/\.html?$/i.test(p)) continue;
    const doc = new DOMParser().parseFromString(dec.decode(data), "text/html");
    const page = doc.querySelector(".pageContainer");
    if (!page) {
      // index.html (the export's list of entries), or a page that is not an entry.
      vault.skipped.push({ path: p, reason: /(^|\/)index\.html?$/i.test(p) ? "appFolder" : "unreadable" });
      continue;
    }
    const header = doc.querySelector(".pageHeader")?.textContent ?? "";
    const date = journalHeaderDate(header) ?? /(\d{4}-\d{2}-\d{2})/.exec(stemOf(p))?.[1] ?? null;
    const title = doc.querySelector(".title")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const props: Props = {};
    const embeds: string[] = [];
    const fromDir = dirOf(p);
    for (const item of Array.from(doc.querySelectorAll(".gridItem"))) {
      const cls = Array.from(item.classList).find((c) => c.startsWith("assetType_"));
      const kind = cls ? kindOf(cls) : "";
      const texts = Array.from(item.querySelectorAll(".gridItemOverlayText, .gridItemOverlayHeader, .gridItemOverlayFooter, .activityType, .activityMetrics, .mediaTitle, .mediaCategory"))
        .map((e) => e.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean);
      const key = PROPERTY_KINDS[kind];
      if (key && texts.length) {
        const list = (props[key] as string[] | undefined) ?? [];
        for (const t of [...new Set(texts)]) for (const part of kind === "state-of-mind" ? t.split(/,\s*/) : [t]) if (!list.includes(part)) list.push(part);
        props[key] = list;
      }
      for (const el of Array.from(item.querySelectorAll("img[src], video[src], audio[src], source[src], a[href]"))) {
        const src = el.getAttribute("src") ?? el.getAttribute("href") ?? "";
        if (/^[a-z][a-z0-9+.-]*:/i.test(src)) continue;
        let rel = src;
        try {
          rel = decodeURIComponent(src);
        } catch (e) {
          swallowed("import/appleJournal: a resource link is not URI-encoded; it is used as written", e);
          rel = src;
        }
        const target = resources.get(resolveRel(fromDir, rel).normalize("NFC").toLowerCase());
        if (target && !embeds.includes(target)) embeds.push(target);
      }
    }
    const notePath = claimPath(taken, `${dirOf(p) ? `${dirOf(p)}/` : ""}${safeName([date ?? stemOf(p), title].filter(Boolean).join(" "))}.md`);
    const parts: string[] = [];
    const prompt = doc.querySelector(".reflectionPrompt")?.textContent?.replace(/\s+/g, " ").trim();
    if (prompt) parts.push(`> ${prompt}`);
    // The export wraps its layout in a <p> it never closes properly, and parsers mend that differently: the
    // entry's paragraphs are every <p> that is not part of the layout (header, grid, title, prompt).
    const LAYOUT = ".pageHeader, .assetGrid, .title, .reflectionPrompt";
    const paras = Array.from(doc.querySelectorAll("p")).filter((el) => !el.querySelector(LAYOUT) && !el.closest(LAYOUT));
    for (const para of paras) {
      const t = inlineMd(para).replace(/ *\n */g, "\n").trim();
      if (t) parts.push(t);
    }
    if (embeds.length) parts.push(embeds.map((t) => mdEmbed(t, dirOf(notePath))).join("\n"));
    if (!parts.length && !Object.keys(props).length) {
      vault.skipped.push({ path: p, reason: "empty" });
      continue;
    }
    if (!date) vault.warnings.push({ path: notePath, reason: "noDates" });
    vault.notes.set(notePath, withFrontmatter({ ...props, date: date ?? undefined, title: title || undefined }, `${parts.join("\n\n")}\n`));
  }
  return vault;
}
