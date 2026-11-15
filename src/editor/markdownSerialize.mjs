/**
 * Saving through the AST without changing what the note means (#847
 * follow-up to W11.Q8). Two mdast-util-to-markdown 2.1.2 handlers that the
 * WYSIWYG editor's remark-stringify and scripts/md-conformance.mjs both use.
 * Plain .mjs (types in ./markdownSerialize.d.mts) so the conformance script
 * runs in plain Node.
 *
 * - **Nested emphasis** (CommonMark examples 461 and 463): `*_foo_*` is
 *   emphasis inside emphasis. The default handler writes both with the same
 *   marker, `**foo**`, which reads as strong. An emphasis that is the first
 *   or last child of an emphasis now takes the other marker, so the two
 *   delimiter runs never touch. Nested emphasis in the middle (`*a *b* c*`)
 *   keeps the marker; it is already separated.
 * - **An HTML block indented 1–3 spaces right after a list**: the html
 *   node's value keeps its source indentation, and after a list that
 *   indentation makes it a continuation of the last item (found by the
 *   seeded concatenation property). Right after a list, the first line's
 *   indentation is dropped. Leading spaces before an HTML block are not
 *   part of what the browser shows.
 */
import { defaultHandlers } from "mdast-util-to-markdown";

const other = (marker) => (marker === "_" ? "*" : "_");

/** The marker an emphasis node is written with. */
function markerFor(node, parent, state) {
  const current = state.options.emphasis || "*";
  if (!parent || parent.type !== "emphasis" || !parent.children) return current;
  const kids = parent.children;
  const atEdge = kids[0] === node || kids[kids.length - 1] === node;
  return atEdge ? other(current) : current;
}

/** Wrap an emphasis handler (the default, or one already configured) so nested emphasis keeps its meaning. */
export function nestedEmphasis(base = defaultHandlers.emphasis) {
  const handle = (node, parent, state, info) => {
    const saved = state.options.emphasis;
    state.options.emphasis = markerFor(node, parent, state);
    try {
      return base(node, parent, state, info);
    } finally {
      state.options.emphasis = saved;
    }
  };
  handle.peek = (node, parent, state) => markerFor(node, parent, state);
  return handle;
}

const LIST_THEN_INDENT = /^[ \t]+/;

/** Wrap an html handler so an indented HTML block right after a list does not join the list. */
export function htmlAfterList(base = defaultHandlers.html) {
  const handle = (node, parent, state, info) => {
    const out = base(node, parent, state, info);
    const kids = parent && parent.children;
    const i = kids ? kids.indexOf(node) : -1;
    if (i > 0 && kids[i - 1].type === "list") return out.replace(LIST_THEN_INDENT, "");
    return out;
  };
  if (base.peek) handle.peek = base.peek;
  return handle;
}

/** mdast-util-to-markdown / remark-stringify options with both fixes, on top of `options`. */
export function roundTripSafe(options = {}) {
  const handlers = options.handlers || {};
  return {
    ...options,
    handlers: {
      ...handlers,
      emphasis: nestedEmphasis(handlers.emphasis || defaultHandlers.emphasis),
      html: htmlAfterList(handlers.html || defaultHandlers.html),
    },
  };
}
