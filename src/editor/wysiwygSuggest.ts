/**
 * Suggesting mode (track changes) in the WYSIWYG editor.
 *
 * The document stays plain markdown with CriticMarkup, exactly as in the
 * source editor (see ./suggesting.ts):
 *
 *   {++inserted++}   {--deleted--}   {~~old~>new~~}   + optional {>>@author<<}
 *
 * In Milkdown, insertions and deletions are two ProseMirror marks,
 * `critic_insert` and `critic_delete` (attr `author`):
 *
 *  - parse: before Milkdown sees the markdown, `encodeCriticForWysiwyg`
 *    swaps every delimiter (outside code) for a private-use sentinel
 *    (the renderer's own `prepareCriticMarkup`); `remarkCriticMarkup`
 *    pairs the sentinels inside each phrasing parent into `criticInsert` /
 *    `criticDelete` mdast nodes, which the mark schemas turn into marks
 *    (a suggestion spanning paragraphs is first split per block, where
 *    that is lossless — see pairAcrossBlocks).
 *    Comments and highlights stay literal text.
 *  - serialize: the marks become those mdast nodes again, and the
 *    remark-stringify handlers write CriticMarkup — an adjacent
 *    deletion + insertion is written as one substitution.
 *  - track: while suggesting is on, `suggestTrackingPlugin` rewrites each
 *    user edit: typed / pasted text gets `critic_insert`; deleted text is
 *    put back with `critic_delete` (deleting one's own insertion really
 *    deletes it); structural deletions (joining blocks) are undone.
 *
 * Files (split in plan 12.1): parse + serialize in ./wysiwygCriticMarkup,
 * tracking + resolving in ./wysiwygSuggestTracking; this module keeps the
 * mounted views and the palette's actions, and re-exports both.
 */
import { setWysiwygSuggestActions, type WysiwygSuggestActions } from "./wysiwygSuggestBridge";
import { resolveAtCursor, jumpToChange, resolveAllChanges, suggestTracking } from "./wysiwygSuggestTracking";
import { criticRemark, criticInsertSchema, criticDeleteSchema } from "./wysiwygCriticMarkup";

export { encodeCriticForWysiwyg, remarkCriticMarkup, criticRemark, criticInsertSchema, criticDeleteSchema } from "./wysiwygCriticMarkup";
export { configureWysiwygSuggest, SUGGEST_META, isStructural, trackChanges, suggestTracking, changeAt, resolveRange, resolveAllChanges, resolveAtCursor, jumpToChange } from "./wysiwygSuggestTracking";
export type { WysiwygSuggestConfig } from "./wysiwygSuggestTracking";

type View = import("@milkdown/prose/view").EditorView;

/**
 * The mounted WYSIWYG views, for the palette's commands. More than one can
 * be mounted at once (the main editor under the Focus Mode overlay), so
 * each registers and unregisters itself by identity — one unmounting
 * leaves the other in charge. The most recently focused one is last.
 */
const views: View[] = [];

const toFront = (e: Event) => {
  const i = views.findIndex((v) => v.dom === e.currentTarget);
  if (i !== -1) views.push(...views.splice(i, 1));
};

const actions: WysiwygSuggestActions = {
  resolve: (mode) => {
    const v = getActiveWysiwygView();
    const ok = !!v && resolveAtCursor(v, mode);
    if (ok) v!.focus();
    return ok;
  },
  jump: (dir) => {
    const v = getActiveWysiwygView();
    const ok = !!v && jumpToChange(v, dir);
    if (ok) v!.focus();
    return ok;
  },
  // Against the live editor state, so edits the debounced listener
  // hasn't emitted yet are neither lost nor missed.
  resolveAll: (mode) => {
    const v = getActiveWysiwygView();
    if (!v) return false;
    const tr = resolveAllChanges(v.state, mode);
    if (!tr) return false;
    v.dispatch(tr);
    v.focus();
    return true;
  },
};

export function registerWysiwygView(view: View): void {
  if (!views.includes(view)) {
    views.push(view);
    view.dom.addEventListener("focusin", toFront);
  }
  setWysiwygSuggestActions(actions);
}

export function unregisterWysiwygView(view: View): void {
  const i = views.indexOf(view);
  if (i !== -1) {
    views.splice(i, 1);
    view.dom.removeEventListener("focusin", toFront);
  }
  if (views.length === 0) setWysiwygSuggestActions(null);
}

export function getActiveWysiwygView(): View | null {
  for (let i = views.length - 1; i >= 0; i--) if (views[i].dom.isConnected) return views[i];
  return null;
}

/** All Milkdown plugins of the feature, in `.use()` order. */
export const wysiwygSuggestPlugins = [criticRemark, criticInsertSchema, criticDeleteSchema, suggestTracking].flat();
