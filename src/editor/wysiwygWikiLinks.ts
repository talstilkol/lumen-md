/**
 * Wiki links survive the WYSIWYG editor.
 *
 * Milkdown has no wiki-link node: `[[Note]]` is text, and its serializer
 * escapes every `[` in text — a note edited in WYSIWYG came back as
 * `\[\[Note]]`, which the workspace index, backlinks, link rewriting and
 * Obsidian don't read as a link. (The preview still did: it looks at the
 * unescaped text.) A link inserted by `[[` completion (4.5) had the same
 * fate. This keeps `[[…]]` as written.
 *
 * Only a complete `[[…]]` on one line is kept, and not when `(` or `[`
 * follows it — `[[x]](y)` unescaped would turn into a Markdown link.
 *
 * Milkdown passes its own `text` handler in the stringify options, which
 * win over remark extensions — so this wraps that handler in the options.
 */

import type { Handle, Options } from "mdast-util-to-markdown";
import { defaultHandlers } from "mdast-util-to-markdown";

const ESCAPED_WIKI = /\\\[\\?\[(?=[^[\]\n]*\]\](?![([]))/g;

/** `\[\[Note]]` → `[[Note]]` in serialized text. */
export function unescapeWikiLinks(md: string): string {
  return md.replace(ESCAPED_WIKI, "[[");
}

/** For `ctx.update(remarkStringifyOptionsCtx, keepWikiLinks)`: the text handler, minus the wiki-link escapes. */
export function keepWikiLinks<T extends { handlers?: Options["handlers"] }>(options: T): T {
  const text = options.handlers?.text ?? (defaultHandlers.text as Handle);
  const wrapped: Handle = (node, parent, state, info) => unescapeWikiLinks(text(node, parent, state, info));
  return { ...options, handlers: { ...options.handlers, text: wrapped } };
}
