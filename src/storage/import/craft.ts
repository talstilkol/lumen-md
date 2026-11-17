/**
 * Craft (plan W13.F1): Craft exports a space or documents as Markdown (a
 * folder or .zip of `.md` files with their images beside them) or as
 * TextBundle. Both come through here.
 *
 * What Craft adds on top of plain Markdown:
 *  - links between documents and to blocks are `craftdocs://open?blockId=…`
 *    URLs, which mean nothing outside Craft. A link whose text names a
 *    document of the export becomes `[[Document]]`; a link to a block of a
 *    document becomes `[[Document#^id]]` when the export carries that
 *    block's id (Craft writes `<!-- {"blockId":"…"} -->` style comments in
 *    some exports, and the TextBundle export keeps them); otherwise the
 *    link text is kept and the report counts the link as one that pointed
 *    into Craft.
 *  - a page's sub-pages are separate `.md` files in a folder named after
 *    the page; links to them resolve by name like any wikilink.
 *  - Craft's text highlight `<mark>` → `==…==`, its callout blocks
 *    (`> 💡 …`) stay quotes.
 */
import { safeName, stemOf } from "./names";
import { BUNDLE, convertTextBundle } from "./textbundle";
import type { ConvertedVault } from "./types";

const CRAFT_LINK = /\[([^\]\n]*)\]\(craftdocs:\/\/open\?([^)\s]+)\)/g;
const BLOCK_COMMENT = /<!--\s*\{\s*"blockId"\s*:\s*"([0-9A-Fa-f-]{8,})"[^}]*\}\s*-->/g;

/** The documents of the export (title, lower-cased → note name), and which document holds each block id. */
function indexExport(files: Map<string, Uint8Array>): { titles: Map<string, string>; blocks: Map<string, { doc: string; id: string }> } {
  const titles = new Map<string, string>();
  const blocks = new Map<string, { doc: string; id: string }>();
  const dec = new TextDecoder();
  for (const [p, data] of files) {
    const bundle = BUNDLE.exec(p);
    const isText = bundle ? /\/text\.(md|markdown|txt)$/i.test(p) : /\.(md|markdown)$/i.test(p);
    if (!isText) continue;
    const doc = bundle ? safeName(stemOf(bundle[1] + ".x").replace(/\.textbundle$/i, "")) : stemOf(p.normalize("NFC"));
    const text = dec.decode(data);
    titles.set(doc.toLowerCase(), doc);
    const h1 = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
    if (h1 && !titles.has(h1.toLowerCase())) titles.set(h1.toLowerCase(), doc);
    for (const m of text.matchAll(BLOCK_COMMENT)) blocks.set(m[1].toLowerCase(), { doc, id: m[1].toLowerCase().replace(/[^a-z0-9-]/g, "-") });
  }
  return { titles, blocks };
}

/** One Craft document's Markdown → Lumen Markdown, against the export's index. */
export function craftToMarkdown(md: string, index: ReturnType<typeof indexExport>, counts: { intoCraft: number }): string {
  let out = md.replace(/\r\n/g, "\n");
  // A block-id comment marks the block before it: `^id` at its end.
  out = out.replace(/[ \t]*\n?[ \t]*<!--\s*\{\s*"blockId"\s*:\s*"([0-9A-Fa-f-]{8,})"[^}]*\}\s*-->/g, (_, id: string) => ` ^${id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`);
  out = out.replace(CRAFT_LINK, (m, text: string, query: string) => {
    const params = new URLSearchParams(query.replace(/&amp;/g, "&"));
    const blockId = (params.get("blockId") ?? "").toLowerCase();
    const block = index.blocks.get(blockId);
    if (block) return `[[${block.doc}#^${block.id}${text && text !== block.doc ? `|${text}` : ""}]]`;
    const doc = index.titles.get(text.trim().toLowerCase());
    if (doc) return `[[${doc}${doc !== text.trim() ? `|${text.trim()}` : ""}]]`;
    counts.intoCraft++;
    return text || m;
  });
  out = out.replace(/<mark>([^<\n]*)<\/mark>/g, "==$1==");
  return out;
}

export function convertCraft(files: Map<string, Uint8Array>): ConvertedVault {
  const index = indexExport(files);
  const left = new Map<string, number>();
  const vault = convertTextBundle(files, {
    transform: (md, notePath) => {
      const counts = { intoCraft: 0 };
      const out = craftToMarkdown(md, index, counts);
      if (counts.intoCraft) left.set(notePath, counts.intoCraft);
      return out;
    },
  });
  // A link that pointed into Craft at something the export does not hold: its text is kept, the report says how many.
  for (const [path, n] of left) vault.warnings.push({ path, reason: "craftLink", detail: String(n) });
  return vault;
}
