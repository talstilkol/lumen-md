/**
 * TextBundle and TextPack (plan W13.F1): the open bundle format of
 * Ulysses, iA Writer, Craft, Bear and others — one `<name>.textbundle/`
 * folder per document holding `text.md` (or `.markdown`, `.txt`),
 * `info.json` and `assets/`. A `.textpack` is one bundle zipped; a zip
 * may hold many. Spec: http://textbundle.org/spec/
 *
 * Each bundle becomes one note named after the bundle; its assets move to
 * `assets/<note>/` and the links to them follow. `info.json`'s `transient`
 * flag and creator are read; a bundle without text is reported, never
 * dropped silently. Bear's own bundles go through ./bear.ts, which adds
 * its dates and syntax on top of this.
 */
import { claimPath, dirOf, mdDest, relativeTo, safeName, safePath, stemOf } from "./names";
import { withFrontmatter, type Props } from "./frontmatter";
import { emptyVault, type ConvertedVault } from "./types";
import { swallowed } from "../../lib/logger";

export const BUNDLE = /^(.*?[^/]+\.textbundle)\//i;

interface BundleInfo {
  /** The parsed info.json ({} when missing or broken). */
  json: Record<string, unknown>;
  broken: boolean;
}

/** The export's files grouped per bundle (bundle path → path inside it → bytes), and the rest. */
function groupBundles(files: Map<string, Uint8Array>): { bundles: Map<string, Map<string, Uint8Array>>; loose: Map<string, Uint8Array> } {
  const bundles = new Map<string, Map<string, Uint8Array>>();
  const loose = new Map<string, Uint8Array>();
  for (const [p, data] of files) {
    const m = BUNDLE.exec(p);
    if (m) {
      if (!bundles.has(m[1])) bundles.set(m[1], new Map());
      bundles.get(m[1])!.set(p.slice(m[1].length + 1), data);
    } else loose.set(p, data);
  }
  return { bundles, loose };
}

function readInfo(parts: Map<string, Uint8Array>): BundleInfo {
  const bytes = parts.get("info.json");
  if (!bytes) return { json: {}, broken: false };
  try {
    const j = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return j && typeof j === "object" && !Array.isArray(j) ? { json: j as Record<string, unknown>, broken: false } : { json: {}, broken: true };
  } catch (e) {
    swallowed("import/textbundle: info.json is not JSON; the bundle is marked broken", e);
    return { json: {}, broken: true };
  }
}

/** `fn` over the text outside fenced and inline code. */
function outsideCode(text: string, fn: (s: string) => string): string {
  return text
    .split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$|`[^`\n]+`)/m)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join("");
}

const textKeyOf = (parts: Map<string, Uint8Array>) => [...parts.keys()].find((k) => /^text\.(md|markdown|txt)$/i.test(k));

/**
 * Move one bundle's assets to `assets/<note>/` and point its links at them.
 * Assets nothing links to are listed at the end, so none is lost.
 */
function placeBundle(vault: ConvertedVault, taken: Set<string>, notePath: string, parts: Map<string, Uint8Array>, text: string): string {
  const assets = [...parts.keys()].filter((k) => /^assets\/./i.test(k));
  vault.sourceAttachments += assets.length;
  const assetDir = `${dirOf(notePath) ? `${dirOf(notePath)}/` : ""}assets/${stemOf(notePath)}`;
  const moved = new Map<string, string>();
  for (const a of assets) {
    const target = claimPath(taken, `${assetDir}/${safePath(a.slice("assets/".length))}`);
    vault.attachments.set(target, parts.get(a)!);
    moved.set(a.normalize("NFC"), target);
  }
  const fromDir = dirOf(notePath);
  const decode = (raw: string) => {
    try {
      return decodeURIComponent(raw);
    } catch (e) {
      swallowed("import/textbundle: an asset link is not URI-encoded; it is used as written", e);
      return raw;
    }
  };
  const find = (dest: string) => moved.get(decode(dest.replace(/^<|>$/g, "")).replace(/^\.\//, "").normalize("NFC"));
  // Markdown links and images (not inside code, where they are examples)…
  let body = outsideCode(text, (part) => part.replace(/(!?\[[^\]]*\]\()(<[^>]+>|[^)\s]+)((?:\s+"[^"]*")?\))/g, (m, open: string, dest: string, close: string) => {
    const target = find(dest);
    return target ? `${open}${mdDest(relativeTo(fromDir, target))}${close}` : m;
  }));
  // …and HTML <img src> (Ulysses and iA write these for sized images).
  body = body.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi, (m, open: string, dest: string, close: string) => {
    const target = find(dest);
    return target ? `${open}${relativeTo(fromDir, target)}${close}` : m;
  });
  const linked = new Set<string>();
  for (const x of body.matchAll(/\]\((?:<([^>]+)>|([^)\s]+))|src="([^"]+)"/g)) linked.add(decode(x[1] ?? x[2] ?? x[3]));
  const unused = [...moved.values()].filter((t) => !linked.has(relativeTo(fromDir, t)));
  if (unused.length) body = `${body.trimEnd()}\n\n${unused.map((t) => `[${stemOf(t)}](${mdDest(relativeTo(fromDir, t))})`).join("\n")}\n`;
  return body;
}

/** Name of the app that wrote a bundle, from info.json's creator fields (for the `source` property). */
export function bundleCreator(info: Record<string, unknown>): string | undefined {
  const id = typeof info.creatorIdentifier === "string" ? info.creatorIdentifier : "";
  if (/ulysses/i.test(id)) return "Ulysses";
  if (/pro\.writer|ia\.writer|iawriter/i.test(id)) return "iA Writer";
  if (/craft|lukilabs/i.test(id)) return "Craft";
  if (/shinyfrog|bear/i.test(id)) return "Bear";
  return undefined;
}

interface TextBundleOptions {
  /** Rewrite the text of each bundle (Bear's syntax, Craft's links). */
  transform?: (md: string, notePath: string) => string;
}

export function convertTextBundle(files: Map<string, Uint8Array>, opts: TextBundleOptions = {}): ConvertedVault {
  const vault = emptyVault();
  const taken = new Set<string>();
  const dec = new TextDecoder();
  const { bundles, loose } = groupBundles(files);
  const transform = opts.transform ?? ((s: string) => s);
  for (const [bundle, parts] of bundles) {
    const textKey = textKeyOf(parts);
    if (!textKey) {
      vault.skipped.push({ path: bundle, reason: "unreadable", detail: "no text.md" });
      continue;
    }
    const info = readInfo(parts);
    // The bundle's folder (inside a zip of many) is kept; the note is named after the bundle.
    const folder = dirOf(bundle)
      .split("/")
      .filter(Boolean)
      .map((s) => safeName(s, "folder"))
      .join("/");
    const notePath = claimPath(taken, `${folder ? `${folder}/` : ""}${safeName(stemOf(bundle + ".x").replace(/\.textbundle$/i, ""))}.md`);
    const body = placeBundle(vault, taken, notePath, parts, transform(dec.decode(parts.get(textKey)!).replace(/\r\n/g, "\n"), notePath));
    const props: Props = { source: bundleCreator(info.json) };
    vault.warnings.push({ path: notePath, reason: "noDates" });
    vault.notes.set(notePath, withFrontmatter(props, body));
  }
  for (const [p, data] of loose) {
    if (/(^|\/)(\.DS_Store|__MACOSX)(\/|$)/.test(p)) vault.skipped.push({ path: p, reason: "appFolder" });
    else if (/\.(md|markdown|txt)$/i.test(p)) {
      const notePath = claimPath(taken, p.normalize("NFC").replace(/\.(markdown|txt)$/i, ".md"));
      vault.notes.set(notePath, transform(dec.decode(data), notePath));
    } else {
      vault.sourceAttachments++;
      vault.attachments.set(claimPath(taken, p.normalize("NFC")), data);
    }
  }
  return vault;
}
