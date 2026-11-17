/**
 * Tomboy and Gnote (plan W13.F2): one `<guid>.note` XML file per note
 * (~/.local/share/tomboy or ~/.local/share/gnote). The first line of the
 * content is the title; the rest becomes Markdown:
 *
 *  - bold, italic, strikethrough, highlight, monospace → `**`, `*`, `~~`,
 *    `==`, `` ` ``; `<link:internal>` → `[[Title]]`; `<link:url>` → a link;
 *  - `<list>` / `<list-item>` → nested `- ` items; in a note (or under a
 *    heading) whose title says TODO, the items are tasks and a struck-out
 *    one is done;
 *  - a line all in huge / large / bold → a heading (huge → #, large → ###,
 *    bold alone → #####; bold on top of a size is one level up);
 *  - `system:notebook:<name>` → the note's folder; other tags → `tags`;
 *    a notebook template (`system:template`) → `Templates/`, tagged `template`;
 *  - create-date / last-change-date → `created` / `updated`.
 *
 * The XML is read with DOMParser (the browser's own), never as HTML.
 */
import { claimPath, safeName } from "./names";
import { isoDate, withFrontmatter } from "./frontmatter";
import { emptyVault, type ConvertedVault } from "./types";

interface Run {
  text: string;
  /** Formatting tags around the run, outermost first (`bold`, `size:huge`, `link:internal`, `list-item`…). */
  path: string[];
  /** List depth (1 = top-level item) when inside a list item. */
  depth: number;
}

const MARK: Record<string, string> = { bold: "**", italic: "*", strikethrough: "~~", highlight: "==", monospace: "`" };
const ORDER = ["strikethrough", "highlight", "bold", "italic", "monospace"];

/** The runs of `<note-content>`, split into lines (a line is the runs between two newlines). */
function lines(content: Element): Run[][] {
  const out: Run[][] = [[]];
  const walk = (node: Node, path: string[], depth: number) => {
    if (node.nodeType === 3) {
      const parts = (node.nodeValue ?? "").split("\n");
      parts.forEach((t, i) => {
        if (i > 0) out.push([]);
        if (t) out[out.length - 1].push({ text: t, path, depth });
      });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const name = el.tagName.replace(/^.*?:(?=link:|size:)/, "");
    const inner = name === "list" ? depth + 1 : depth;
    for (const c of Array.from(el.childNodes)) walk(c, name === "list" ? path : [...path, name], inner);
  };
  for (const c of Array.from(content.childNodes)) walk(c, [], 0);
  return out;
}

const has = (r: Run, tag: string) => r.path.some((p) => p === tag || p.endsWith(`:${tag}`) || p === tag.replace(/^.*:/, ""));

/** One line's runs → Markdown, the marks opened and closed around each run (spaces kept outside them). */
function inline(runs: Run[], skip: Set<string>): string {
  let out = "";
  for (const r of runs) {
    const marks = ORDER.filter((m) => !skip.has(m) && r.path.includes(m));
    let t = r.text;
    if (r.path.some((p) => /link:internal|link:broken/.test(p))) t = `[[${safeName(t.replace(/[[\]#|^]/g, ""))}]]`;
    else if (r.path.some((p) => p.includes("link:url"))) t = /^[a-z][a-z0-9+.-]*:/i.test(t.trim()) ? `<${t.trim()}>` : t;
    if (!t.trim() || !marks.length) {
      out += t;
      continue;
    }
    const lead = /^\s*/.exec(t)![0];
    const trail = /\s*$/.exec(t)![0];
    const core = t.slice(lead.length, t.length - trail.length);
    const open = marks.map((m) => MARK[m]).join("");
    const close = [...marks].reverse().map((m) => MARK[m]).join("");
    out += `${lead}${open}${core}${close}${trail}`;
  }
  // `**a****b**` from two runs with the same marks: one span.
  return out.replace(/(\*\*|~~|==|`)\1(?=\S)/g, "");
}

/** A TODO note or heading (English as Tomboy users write it, and Hebrew: משימות / לעשות). */
const todoTitle = (s: string) => /\bto ?do\b/i.test(s) || /(^|\s)(משימות|לעשות)(\s|$)/.test(s);

export function tomboyToMarkdown(content: Element, title: string): string {
  const all = lines(content);
  // The first line is the title (Tomboy repeats it in the content).
  const body = all.slice(all[0]?.map((r) => r.text).join("").trim() === title.trim() ? 1 : 0);
  const out: string[] = [];
  let todo: { level: number } | null = todoTitle(title) ? { level: 0 } : null;
  for (const runs of body) {
    const text = runs.map((r) => r.text).join("");
    const item = runs.find((r) => r.path.includes("list-item"));
    if (item && text.trim()) {
      const indent = "    ".repeat(Math.max(0, item.depth - 1));
      const done = runs.filter((r) => r.text.trim()).every((r) => has(r, "strikethrough"));
      const box = todo ? (done ? "[x] " : "[ ] ") : "";
      out.push(`${indent}- ${box}${inline(runs, todo && done ? new Set(["strikethrough"]) : new Set()).trim()}`);
      continue;
    }
    const visible = runs.filter((r) => r.text.trim());
    if (visible.length) {
      const all = (pred: (r: Run) => boolean) => visible.every(pred);
      const huge = all((r) => r.path.includes("size:huge"));
      const large = all((r) => r.path.includes("size:large"));
      const bold = all((r) => r.path.includes("bold"));
      if (huge || large || bold) {
        const level = Math.max(1, (huge ? 2 : large ? 4 : 6) - (bold ? 1 : 0));
        const heading = inline(runs, new Set(bold ? ["bold"] : [])).trim();
        if (out.length && out[out.length - 1] !== "") out.push("");
        out.push(`${"#".repeat(level)} ${heading}`, "");
        if (!todo || level <= todo.level) todo = todoTitle(heading) ? { level } : todo && level < todo.level ? null : todo;
        continue;
      }
    }
    out.push(inline(runs, new Set()).replace(/\s+$/, ""));
  }
  // Blank lines around headings and lists, at most one in a row.
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

function child(root: Element, name: string): Element | null {
  return Array.from(root.getElementsByTagName("*")).find((e) => e.localName === name) ?? null;
}

export function convertTomboy(files: Map<string, Uint8Array>): ConvertedVault {
  const vault = emptyVault();
  const taken = new Set<string>();
  const dec = new TextDecoder();
  for (const [p, data] of files) {
    if (!/\.note$/i.test(p)) {
      if (/(^|\/)(manifest\.xml|Backup\/)/i.test(p) || /\.(xml|bak)$/i.test(p)) vault.skipped.push({ path: p, reason: "appFolder" });
      else if (/\.(md|markdown|txt)$/i.test(p)) vault.notes.set(claimPath(taken, p.replace(/\.(markdown|txt)$/i, ".md")), dec.decode(data));
      else vault.skipped.push({ path: p, reason: "unsupported", detail: ".note" });
      continue;
    }
    const doc = new DOMParser().parseFromString(dec.decode(data).replace(/^\uFEFF/, ""), "application/xml");
    const root = doc.documentElement;
    const content = root && root.localName === "note" && !doc.getElementsByTagName("parsererror").length ? child(root, "note-content") : null;
    if (!root || !content) {
      vault.skipped.push({ path: p, reason: "unreadable" });
      continue;
    }
    const title = (child(root, "title")?.textContent ?? "").trim() || "Untitled";
    const tags = Array.from(root.getElementsByTagName("*"))
      .filter((e) => e.localName === "tag")
      .map((e) => (e.textContent ?? "").trim());
    // A notebook's template note comes along as a template (in Templates/, tagged), not as a note of the notebook.
    const template = tags.includes("system:template");
    const notebook = template ? "Templates" : tags.find((t) => t.startsWith("system:notebook:"))?.slice("system:notebook:".length);
    const userTags = [...tags.filter((t) => t && !t.startsWith("system:")), ...(template ? ["template"] : [])];
    // A title the file name could not keep whole (`#1`, `a/b`) stays on top as a heading.
    const fileName = safeName(title.replace(/[[\]#|^]/g, ""));
    const converted = tomboyToMarkdown(content, title);
    const body = fileName !== title.normalize("NFC") ? `# ${title}\n\n${converted}`.trimEnd() : converted;
    if (!body.trim() && !userTags.length) {
      vault.skipped.push({ path: p, reason: "empty" });
      continue;
    }
    const path = claimPath(taken, `${notebook ? `${safeName(notebook, "Notebook")}/` : ""}${fileName}.md`);
    const date = (name: string) => {
      const s = child(root, name)?.textContent?.trim();
      return s ? isoDate(new Date(s)) : undefined;
    };
    const created = date("create-date");
    const updated = date("last-change-date");
    if (!created && !updated) vault.warnings.push({ path, reason: "noDates" });
    vault.notes.set(path, withFrontmatter({ created, updated, tags: userTags }, `${body}\n`));
  }
  return vault;
}
