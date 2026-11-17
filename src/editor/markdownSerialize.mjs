/**
 * Saving through the AST without changing what the note means (#847
 * follow-up to W11.Q8). Two mdast-util-to-markdown 2.1.2 handlers that the
 * WYSIWYG editor's remark-stringify and scripts/md-conformance.mjs both use.
 * Plain .mjs (types in ./markdownSerialize.d.mts) so the conformance script
 * runs in plain Node.
 *
 * - **Delimiter runs that touch** (CommonMark examples 461 and 463, and
 *   the seeded property in mdSpecProperties.test.ts): `*_foo_*` is emphasis
 *   inside emphasis, and `*a*_b_` two emphases side by side. The default
 *   handler writes both with the same marker, `**foo**` / `*a**b*`, which
 *   reads as something else. An emphasis or strong whose run would touch
 *   its parent's or its left neighbour's now takes the other marker.
 *   Nested emphasis between spaces or letters (`*a *b* c*`) keeps the
 *   marker; it is already separated.
 * - **An HTML block indented 1–3 spaces right after a list**: the html
 *   node's value keeps its source indentation, and after a list that
 *   indentation makes it a continuation of the last item (found by the
 *   seeded concatenation property). Right after a list, the first line's
 *   indentation is dropped. Leading spaces before an HTML block are not
 *   part of what the browser shows.
 */
import { defaultHandlers } from "mdast-util-to-markdown";

const other = (marker) => (marker === "_" ? "*" : "_");

/** The marker each emphasis/strong node was written with, while one document is serialized. */
const chosen = new WeakMap();
const ATTN = new Set(["emphasis", "strong"]);
const PUNCT = /[\p{P}\p{S}]/u;
const ALNUM = /[\p{L}\p{N}]/u;
/** The character next to `node` on one side: the text of the sibling there, or "" at the edge of the parent. */
function neighbourChar(kids, i, dir) {
  const sib = kids[i + dir];
  if (!sib) return "";
  if (sib.type === "text" && sib.value) return dir < 0 ? sib.value[sib.value.length - 1] : sib.value[0];
  return sib.type === "inlineCode" ? "`" : "";
}
/** The first (dir 1) or last (dir -1) character inside `node`, or "" when it starts/ends with something else. */
function innerChar(node, dir) {
  const kids = node.children || [];
  const k = dir > 0 ? kids[0] : kids[kids.length - 1];
  if (!k) return "";
  if (k.type === "text" && k.value) return dir > 0 ? k.value[0] : k.value[k.value.length - 1];
  return ATTN.has(k.type) ? "*" : "";
}
const defaultMarker = (node, state) => (node.type === "strong" ? state.options.strong : state.options.emphasis) || "*";

/**
 * The marker an emphasis or strong node is written with. The default one,
 * unless its delimiter run would touch another run of the same character
 * and merge with it (the meaning changes):
 * - the first or last child of an emphasis/strong (CommonMark 461, 463:
 *   `*_foo_*`, and `**__x__**`);
 * - right after a sibling emphasis/strong (`*a*_b_`, seeded property);
 * - a nested one in the middle whose neighbour is punctuation, where the
 *   flanking rules can pair the inner and outer markers (`_[*\\*|_`).
 * `_` cannot open or close next to a letter or digit, so it is never
 * chosen there; the default stays.
 */
function markerFor(node, parent, state) {
  const current = defaultMarker(node, state);
  const kids = parent && parent.children;
  if (!kids) return current;
  const i = kids.indexOf(node);
  const avoid = new Set();
  if (ATTN.has(parent.type) && chosen.has(parent)) {
    const atEdge = i === 0 || i === kids.length - 1;
    const punctNext = PUNCT.test(neighbourChar(kids, i, -1)) || PUNCT.test(neighbourChar(kids, i, 1));
    // Strong in strong at the edge with letters inside (`******foo******`) reads right with one marker (the rule of 3);
    // only punctuation just inside it lets the runs pair the wrong way (`**__)__>**`).
    const edgeMatters = node.type === "emphasis" || PUNCT.test(innerChar(node, i === 0 ? 1 : -1));
    if ((atEdge && edgeMatters) || punctNext) avoid.add(chosen.get(parent));
  }
  const prev = kids[i - 1];
  if (prev && ATTN.has(prev.type) && chosen.has(prev)) avoid.add(chosen.get(prev));
  if (!avoid.has(current)) return current;
  const alt = other(current);
  if (avoid.has(alt)) return current;
  if (alt === "_" && (ALNUM.test(neighbourChar(kids, i, -1)) || ALNUM.test(neighbourChar(kids, i, 1)))) return current;
  return alt;
}

/** Wrap an emphasis or strong handler so its delimiter run never merges with a neighbouring one. */
function keepRunsApart(base, option) {
  const handle = (node, parent, state, info) => {
    const saved = state.options[option];
    const marker = markerFor(node, parent, state);
    chosen.set(node, marker);
    state.options[option] = marker;
    try {
      return base(node, parent, state, info);
    } finally {
      state.options[option] = saved;
    }
  };
  handle.peek = (node, parent, state) => markerFor(node, parent, state);
  return handle;
}

/** Wrap an emphasis handler (the default, or one already configured) so nested and adjacent emphasis keep their meaning. */
export function nestedEmphasis(base = defaultHandlers.emphasis) {
  return keepRunsApart(base, "emphasis");
}

/** The same for strong: `**__x__**` and `**a**__b__` stay two strong runs. */
export function nestedStrong(base = defaultHandlers.strong) {
  return keepRunsApart(base, "strong");
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

/** mdast-util-to-markdown / remark-stringify options with these fixes, on top of `options`. */
export function roundTripSafe(options = {}) {
  const handlers = options.handlers || {};
  return {
    ...options,
    handlers: {
      ...handlers,
      emphasis: nestedEmphasis(handlers.emphasis || defaultHandlers.emphasis),
      strong: nestedStrong(handlers.strong || defaultHandlers.strong),
      html: htmlAfterList(handlers.html || defaultHandlers.html),
    },
  };
}
