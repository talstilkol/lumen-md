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
 *    `criticDelete` mdast nodes, which the mark schemas turn into marks.
 *    Comments and highlights stay literal text.
 *  - serialize: the marks become those mdast nodes again, and the
 *    remark-stringify handlers write CriticMarkup — an adjacent
 *    deletion + insertion is written as one substitution.
 *  - track: while suggesting is on, `suggestTrackingPlugin` rewrites each
 *    user edit: typed / pasted text gets `critic_insert`; deleted text is
 *    put back with `critic_delete` (deleting one's own insertion really
 *    deletes it); structural deletions (joining blocks) are undone.
 */
import { $markSchema, $prose, $remark } from "@milkdown/utils";
import type { Mark, Schema, Slice } from "@milkdown/prose/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@milkdown/prose/state";
import { ReplaceStep, type Mapping } from "@milkdown/prose/transform";
import type { Parents, PhrasingContent, Root } from "mdast";
import { defaultHandlers } from "mdast-util-to-markdown";
import { CRITIC_LITERAL, CRITIC_SENTINELS as S, prepareCriticMarkup, unescapeUserSentinels } from "../renderer/criticMarkup";
import { sanitizeAuthor } from "./suggesting";
import { setWysiwygSuggestActions } from "./wysiwygSuggestBridge";

/* ─── Configuration (set by the editor host) ────────────────────────── */

export interface WysiwygSuggestConfig {
  enabled: () => boolean;
  author: () => string | null;
}
let config: WysiwygSuggestConfig = { enabled: () => false, author: () => null };
export function configureWysiwygSuggest(next: WysiwygSuggestConfig): void {
  config = next;
}

/** The mounted WYSIWYG view, for the palette's cursor commands. */
let activeView: import("@milkdown/prose/view").EditorView | null = null;
export function setActiveWysiwygView(view: typeof activeView): void {
  activeView = view;
  setWysiwygSuggestActions(
    view
      ? {
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
            const tr = resolveRange(v.state, 0, v.state.doc.content.size, mode);
            if (!tr) return false;
            v.dispatch(tr);
            v.focus();
            return true;
          },
        }
      : null,
  );
}
export function getActiveWysiwygView(): typeof activeView {
  return activeView && activeView.dom.isConnected ? activeView : null;
}

/* ─── Parse: markdown → sentinels → mdast nodes ─────────────────────── */

/** Prepare markdown for Milkdown: CriticMarkup delimiters → sentinels. */
export function encodeCriticForWysiwyg(markdown: string): string {
  return prepareCriticMarkup(markdown);
}

interface CriticNode {
  type: "criticInsert" | "criticDelete";
  author?: string;
  /** Spaces Milkdown's serializer moved out of the mark (restored on stringify). */
  spaceBefore?: string;
  spaceAfter?: string;
  children: PhrasingContent[];
}

const SENTINEL_SPLIT = /([-])/;
const isSentinelChar = (v: string) => v.length === 1 && v >= "" && v <= "";
const sentinelAt = (nodes: PhrasingContent[], i: number): string | null => {
  const n = nodes[i];
  return n?.type === "text" && isSentinelChar(n.value) ? n.value : null;
};

function splitSentinels(children: PhrasingContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const c of children) {
    if (c.type === "text" && /[-]/.test(c.value)) {
      for (const part of c.value.split(SENTINEL_SPLIT)) if (part) out.push({ type: "text", value: part });
    } else out.push(c);
  }
  return out;
}

function indexOf(nodes: PhrasingContent[], ch: string, from: number): number {
  for (let i = from; i < nodes.length; i++) if (sentinelAt(nodes, i) === ch) return i;
  return -1;
}

/** `{>>@name<<}` right after a change: its author tag. */
function authorTagAt(nodes: PhrasingContent[], i: number): { author: string; end: number } | null {
  if (sentinelAt(nodes, i) !== S.comOpen) return null;
  const body = nodes[i + 1];
  if (body?.type !== "text" || !body.value.startsWith("@") || sentinelAt(nodes, i + 2) !== S.comClose) return null;
  const author = sanitizeAuthor(body.value.slice(1));
  return author ? { author, end: i + 3 } : null;
}

function mergeText(nodes: PhrasingContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === "text" && last?.type === "text") last.value += n.value;
    else out.push(n);
  }
  return out;
}

/** Pair the sentinels of one phrasing parent into critic nodes. */
function wrapChildren(children: PhrasingContent[]): PhrasingContent[] {
  const nodes = splitSentinels(children);
  const out: PhrasingContent[] = [];
  const pushChange = (node: CriticNode) => out.push(node as unknown as PhrasingContent);
  let i = 0;
  while (i < nodes.length) {
    const s = sentinelAt(nodes, i);
    if (s === S.insOpen || s === S.delOpen) {
      const close = indexOf(nodes, s === S.insOpen ? S.insClose : S.delClose, i + 1);
      if (close !== -1) {
        const tag = authorTagAt(nodes, close + 1);
        pushChange({
          type: s === S.insOpen ? "criticInsert" : "criticDelete",
          ...(tag ? { author: tag.author } : {}),
          children: wrapChildren(nodes.slice(i + 1, close)),
        });
        i = tag ? tag.end : close + 1;
        continue;
      }
    } else if (s === S.subOpen) {
      const mid = indexOf(nodes, S.subMid, i + 1);
      const close = mid === -1 ? -1 : indexOf(nodes, S.subClose, mid + 1);
      if (close !== -1) {
        const tag = authorTagAt(nodes, close + 1);
        const author = tag ? { author: tag.author } : {};
        pushChange({ type: "criticDelete", ...author, children: wrapChildren(nodes.slice(i + 1, mid)) });
        pushChange({ type: "criticInsert", ...author, children: wrapChildren(nodes.slice(mid + 1, close)) });
        i = tag ? tag.end : close + 1;
        continue;
      }
    }
    // Comments, highlights and unpaired sentinels: their literal text.
    const n = nodes[i];
    out.push(s ? { type: "text", value: CRITIC_LITERAL[s] ?? s } : n);
    i++;
  }
  return mergeText(out);
}

function unescapeTree(node: { type: string; value?: string; children?: unknown[] }): void {
  if (node.type === "text" && typeof node.value === "string") node.value = unescapeUserSentinels(node.value);
  if (node.type === "inlineCode" || node.type === "code") {
    if (typeof node.value === "string") node.value = unescapeUserSentinels(node.value);
  }
  for (const c of (node.children ?? []) as Array<{ type: string; value?: string; children?: unknown[] }>) unescapeTree(c);
}

const PHRASING_PARENTS = new Set(["paragraph", "heading", "tableCell", "emphasis", "strong", "delete", "link", "linkReference"]);

function transformTree(node: Parents | Root): void {
  const kids = (node as { children?: unknown[] }).children as Array<Parents> | undefined;
  if (!kids) return;
  if (PHRASING_PARENTS.has(node.type)) {
    (node as { children: PhrasingContent[] }).children = wrapChildren(node.children as PhrasingContent[]);
  }
  for (const c of (node as { children: Array<Parents> }).children) {
    if ((c as { children?: unknown }).children) transformTree(c);
  }
}

/* ─── Serialize: critic nodes → CriticMarkup ────────────────────────── */

interface StringifyState {
  containerPhrasing(node: unknown, info: unknown): string;
}
type Handler = (node: CriticNode, parent: { children: unknown[] } | undefined, state: StringifyState, info: unknown) => string;

const tag = (author?: string | null) => {
  const a = sanitizeAuthor(author);
  return a ? `{>>@${a}<<}` : "";
};
const siblings = (node: unknown, parent?: { children: unknown[] }) => {
  const i = parent ? parent.children.indexOf(node) : -1;
  return {
    prev: i > 0 ? (parent!.children[i - 1] as CriticNode) : undefined,
    next: i >= 0 ? (parent!.children[i + 1] as CriticNode) : undefined,
  };
};

const sameAuthor = (a?: { author?: string | null }, b?: { author?: string | null }) => (a?.author ?? null) === (b?.author ?? null);
const isCritic = (n: unknown): n is CriticNode => {
  const t = (n as { type?: string } | undefined)?.type;
  return t === "criticInsert" || t === "criticDelete";
};

/**
 * Milkdown's serializer moves spaces at a mark's edges out of the mark
 * (`{++big ++}` → `{++big++} `), which would leave an inserted / deleted
 * space unmarked and split `{++new **bold**++}` around its space. The mark
 * runner records what moves (spaceBefore / spaceAfter); here those spaces
 * go back inside, and directly adjacent runs of the same kind and author
 * are joined. Plain whitespace BETWEEN two suggestions stays outside, so
 * `{++one++} {++two++}` stays two suggestions.
 */
function restoreCriticSpaces(node: { children?: unknown[] }): void {
  const kids = node.children as Array<{ type: string; value?: string; children?: unknown[] }> | undefined;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (!isCritic(c)) continue;
    const prev = kids[i - 1];
    if (c.spaceBefore && prev?.type === "text" && prev.value?.endsWith(c.spaceBefore)) {
      prev.value = prev.value.slice(0, -c.spaceBefore.length);
      c.children.unshift({ type: "text", value: c.spaceBefore });
      if (!prev.value) {
        kids.splice(i - 1, 1);
        i--;
      }
    }
    const next = kids[i + 1];
    if (c.spaceAfter && next?.type === "text" && next.value?.startsWith(c.spaceAfter)) {
      next.value = next.value.slice(c.spaceAfter.length);
      c.children.push({ type: "text", value: c.spaceAfter });
      if (!next.value) kids.splice(i + 1, 1);
    }
    delete c.spaceBefore;
    delete c.spaceAfter;
  }
  // Join runs the serializer split (now directly adjacent).
  for (let i = kids.length - 1; i > 0; i--) {
    const a = kids[i - 1];
    const b = kids[i];
    if (isCritic(a) && isCritic(b) && a.type === b.type && sameAuthor(a, b)) {
      a.children.push(...b.children);
      kids.splice(i, 1);
    }
  }
  for (const c of kids) restoreCriticSpaces(c);
}

const criticDeleteHandler: Handler = (node, parent, state, info) => {
  const inner = state.containerPhrasing(node, info);
  const { next } = siblings(node, parent);
  // A deletion followed directly by an insertion BY THE SAME AUTHOR is one
  // substitution; different authors stay two independent changes.
  if (next?.type === "criticInsert" && sameAuthor(node, next)) return `{~~${inner}~>`;
  return `{--${inner}--}${tag(node.author)}`;
};
const criticInsertHandler: Handler = (node, parent, state, info) => {
  const inner = state.containerPhrasing(node, info);
  const { prev } = siblings(node, parent);
  if (prev?.type === "criticDelete" && sameAuthor(node, prev)) return `${inner}~~}${tag(node.author)}`;
  return `{++${inner}++}${tag(node.author)}`;
};

type RootHandler = (node: unknown, parent: unknown, state: unknown, info: unknown) => string;

/** The remark plugin: parse sentinels on the way in, write CriticMarkup out. */
export function remarkCriticMarkup(this: { data: (key?: string) => Record<string, unknown> }) {
  const data = this.data() as { toMarkdownExtensions?: unknown[] };
  (data.toMarkdownExtensions ??= []).push({
    handlers: {
      criticInsert: criticInsertHandler,
      criticDelete: criticDeleteHandler,
      root: ((node, parent, state, info) => {
        restoreCriticSpaces(node as { children?: unknown[] });
        return (defaultHandlers.root as unknown as RootHandler)(node, parent, state, info);
      }) as RootHandler,
    },
  });
  return (tree: Root) => {
    transformTree(tree);
    unescapeTree(tree as unknown as { type: string; children?: unknown[] });
  };
}

/* ─── Milkdown plugins: remark, marks, tracking ─────────────────────── */

export const criticRemark = $remark("criticMarkup", () => remarkCriticMarkup as never);

const markSchema = (name: "critic_insert" | "critic_delete", mdType: CriticNode["type"], tagName: "ins" | "del") =>
  $markSchema(name, () => ({
    attrs: { author: { default: null } },
    inclusive: false,
    parseDOM: [
      {
        tag: `${tagName}[data-critic]`,
        getAttrs: (dom: HTMLElement) => ({ author: dom.getAttribute("data-author") }),
      },
    ],
    toDOM: (mark: Mark) => [
      tagName,
      {
        "data-critic": "",
        class: tagName === "ins" ? "critic-ins" : "critic-del",
        ...(mark.attrs.author ? { "data-author": mark.attrs.author, title: `@${mark.attrs.author}` } : {}),
      },
    ],
    parseMarkdown: {
      match: (node: { type: string }) => node.type === mdType,
      runner: (state, node, markType) => {
        state.openMark(markType, { author: (node as { author?: string }).author ?? null });
        state.next(node.children ?? []);
        state.closeMark(markType);
      },
    },
    toMarkdown: {
      match: (mark: Mark) => mark.type.name === name,
      runner: (state, mark, node) => {
        const props: Record<string, string> = mark.attrs.author ? { author: mark.attrs.author } : {};
        // Record the edge spaces the serializer will move out of the mark
        // (it does so when the mark closes after this text, which is only
        // reliable when no other mark wraps the text).
        const text = node.isText ? (node.text ?? "") : "";
        if (text && node.marks.every((m) => m.type.name === "critic_insert" || m.type.name === "critic_delete")) {
          if (text.startsWith(" ")) props.spaceBefore = text.slice(0, text.length - text.trimStart().length);
          if (text.endsWith(" ")) props.spaceAfter = text.slice(text.trimEnd().length);
          if (!text.trim()) delete props.spaceBefore; // all-space text: moved once, after
        }
        state.withMark(mark, mdType, undefined, props);
      },
    },
  }));

export const criticInsertSchema = markSchema("critic_insert", "criticInsert", "ins");
export const criticDeleteSchema = markSchema("critic_delete", "criticDelete", "del");

/** Transactions this module makes itself (never re-tracked). */
export const SUGGEST_META = "lumenSuggest";
const trackingKey = new PluginKey("lumenSuggestTracking");

interface Change {
  from: number;
  insertedSize: number;
  deleted: Slice;
  /** The insertion adds block structure (Enter, multi-paragraph paste). */
  structural: boolean;
}

/** A slice that adds or splits blocks rather than only inline content. */
/** CriticMarkup delimiters: typed inside a suggestion they'd end or nest it. */
const CRITIC_DELIM = /\{(?:\+\+|--|~~|==|>>)|(?:\+\+|--|~~|==|<<)\}|~>/g;

/**
 * True when text inserted at [from, to) would form a CriticMarkup
 * delimiter with itself or its neighbours: serialized as `{++…++}`, such
 * an insertion couldn't be read back as one suggestion (source mode
 * refuses the same edits).
 */
function formsDelimiter(doc: EditorState["doc"], from: number, to: number): boolean {
  const $from = doc.resolve(from);
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
  const start = Math.max($from.start(), from - 2);
  const end = Math.min($from.end(), to + 2);
  if (to > end) return false;
  const text = doc.textBetween(start, end, "\n", "\ufffc");
  for (const m of text.matchAll(CRITIC_DELIM)) {
    const a = start + m.index!;
    if (a < to && a + m[0].length > from) return true;
  }
  return false;
}

function isStructural(slice: Slice): boolean {
  if (slice.openStart > 0 || slice.openEnd > 0) return true;
  let block = false;
  slice.content.forEach((n) => {
    if (n.isBlock) block = true;
  });
  return block;
}

/**
 * A user transaction suggesting mode can't track:
 *  - any step other than a plain replace: formatting (mark steps), block
 *    type and list structure (replace-around), node attributes;
 *  - a replace that inserts structure (a paragraph split, a multi-block
 *    paste, a dragged block);
 *  - a deletion whose text contains a CriticMarkup delimiter, which
 *    couldn't be read back as one suggestion.
 * Edits wholly inside a code block are exempt (they pass untracked).
 */
function untrackable(tr: Transaction): boolean {
  return tr.steps.some((st, i) => {
    if (!(st instanceof ReplaceStep)) return true;
    const { from, to, slice } = st as unknown as { from: number; to: number; slice: Slice };
    const before = tr.docs[i];
    const $from = before.resolve(from);
    if ($from.parent.type.spec.code && $from.sameParent(before.resolve(to))) return false;
    if (slice.size > 0 && isStructural(slice) && !$from.parent.type.spec.code) return true;
    if (to > from) {
      // `match` (not `test`) leaves the shared global regex's lastIndex alone.
      if (before.textBetween(from, to, "\n", "\ufffc").match(CRITIC_DELIM)) return true;
    }
    return false;
  });
}

/** True when a slice holds an inline node other than text (an image, a hard break). */
function hasAtom(slice: Slice): boolean {
  let atom = false;
  slice.content.descendants((n) => {
    if (n.isInline && !n.isText) atom = true;
  });
  return atom;
}

/** Text content of a slice, ignoring structure. */
const sliceText = (slice: Slice) => slice.content.textBetween(0, slice.content.size, "", "");

/**
 * Rewrite the user's transactions (already applied in `newState`) into
 * tracked changes. Returns the follow-up transaction, or null.
 */
export function trackChanges(
  trs: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
  author: string | null,
): Transaction | null {
  const schema: Schema = newState.schema;
  const ins = schema.marks.critic_insert;
  const del = schema.marks.critic_delete;
  if (!ins || !del) return null;
  const user = trs.filter(
    (tr) => tr.docChanged && !tr.getMeta(SUGGEST_META) && !tr.getMeta("history$") && tr.getMeta("addToHistory") !== false,
  );
  if (user.length !== trs.filter((t) => t.docChanged).length || user.length === 0) return null;

  // Collect replace steps across the transactions, with the mapping that
  // carries a position from just after each step to `newState.doc`.
  const changes: Array<Change & { toEnd: Mapping; deletesStructure: boolean; inCode: boolean }> = [];
  user.forEach((tr, ti) => {
    tr.steps.forEach((step, i) => {
      if (!(step instanceof ReplaceStep)) return;
      const before = tr.docs[i];
      const s = step as unknown as { from: number; to: number; slice: Slice };
      const toEnd = tr.mapping.slice(i + 1);
      for (const later of user.slice(ti + 1)) toEnd.appendMapping(later.mapping);
      changes.push({
        from: s.from,
        insertedSize: s.slice.size,
        deleted: before.slice(s.from, s.to),
        structural: s.slice.size > 0 && isStructural(s.slice),
        inCode: (() => {
          const $from = before.resolve(s.from);
          return !!$from.parent.type.spec.code && $from.sameParent(before.resolve(s.to));
        })(),
        deletesStructure: s.to > s.from && (!before.resolve(s.from).sameParent(before.resolve(s.to)) || hasAtom(before.slice(s.from, s.to))),
        toEnd,
      });
    });
  });
  if (changes.length === 0) return null;

  const tr = newState.tr;
  tr.setMeta(SUGGEST_META, true);
  const attrs = { author: sanitizeAuthor(author) };
  let selection: number | null = null;
  const oldHead = oldState.selection.head;
  for (const c of changes) {
    const at = tr.mapping.map(c.toEnd.map(c.from, -1), -1);
    const insertedEnd = tr.mapping.map(c.toEnd.map(c.from + c.insertedSize, 1), 1);
    // Code blocks can't carry marks: edits there pass untracked, as in
    // source mode (CriticMarkup inside code is literal text).
    // Only edits wholly inside one code block (judged before the edit).
    if (c.inCode) continue;
    // 1. Insertions are suggested. Structural ones (a new paragraph, a
    //    multi-block paste) can't be expressed as CriticMarkup or undone
    //    by Reject, so they are blocked, like structural deletions — and
    //    so is text that would form a CriticMarkup delimiter (`a++}b`).
    // Inline atoms (an image, a hard break) can't carry the insertion mark
    // either, so Reject couldn't remove them: blocked too.
    let atom = false;
    if (insertedEnd > at) tr.doc.nodesBetween(at, insertedEnd, (n) => void (n.isInline && !n.isText && (atom = true)));
    // A replacement that removes structure (a paragraph boundary, an image)
    // can't be tracked as one suggestion either: the old text comes back
    // as a suggested deletion, the typed text is dropped.
    if (insertedEnd > at && (c.structural || atom || c.deletesStructure || formsDelimiter(tr.doc, at, insertedEnd))) {
      tr.delete(at, insertedEnd);
    } else if (insertedEnd > at) {
      tr.removeMark(at, insertedEnd, del);
      // Typing inside someone's suggested insertion extends it (their
      // mark is inherited): keep that author, as source mode does.
      let inherited = true;
      tr.doc.nodesBetween(at, insertedEnd, (n) => {
        if (n.isText && !ins.isInSet(n.marks)) inherited = false;
      });
      if (!inherited) tr.addMark(at, insertedEnd, ins.create(attrs));
    }
    // 2. Deletions are kept, marked — unless they only removed one's own
    //    suggested insertion, which really goes away.
    if (c.deleted.size === 0) continue;
    const text = sliceText(c.deleted);
    const onlyOwnInsert = (() => {
      let own = !!text;
      c.deleted.content.descendants((n) => {
        if (n.isText && !ins.isInSet(n.marks)) own = false;
      });
      return own;
    })();
    if (onlyOwnInsert) continue;
    // Re-insert the deleted slice with its openness, so a removed block
    // boundary (Backspace at a paragraph start) is restored, not inlined:
    // structural joins are blocked while the text is suggested deleted.
    const mapsBefore = tr.mapping.maps.length;
    tr.replace(at, at, c.deleted);
    const end = tr.mapping.slice(mapsBefore).map(at, 1);
    const mapsRestored = tr.mapping.maps.length;
    // Drop the parts that were suggested insertions; mark the rest deleted.
    const ownRanges: Array<[number, number]> = [];
    tr.doc.nodesBetween(at, end, (n, pos) => {
      if (n.isText) {
        if (ins.isInSet(n.marks)) ownRanges.push([pos, pos + n.nodeSize]);
        // Text that was already a suggested deletion keeps its author.
        else if (!del.isInSet(n.marks)) tr.addMark(Math.max(pos, at), Math.min(pos + n.nodeSize, end), del.create(attrs));
      }
    });
    for (const [f, t] of ownRanges.reverse()) tr.delete(f, t);
    // `end` is already past the restored slice: map it through the removals only.
    const keptEnd = tr.mapping.slice(mapsRestored).map(end, -1);
    // Backspace leaves the caret before the kept text; Delete after it.
    if (c.insertedSize === 0) {
      const backward = oldHead > c.from;
      selection = backward ? at : keptEnd;
    }
  }
  if (selection !== null && tr.docChanged) {
    const pos = Math.max(0, Math.min(selection, tr.doc.content.size));
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos), -1));
  }
  return tr.docChanged || tr.storedMarksSet ? tr : null;
}

export const suggestTracking = $prose(
  () =>
    new Plugin({
      key: trackingKey,
      appendTransaction: (trs, oldState, newState) =>
        config.enabled() ? trackChanges(trs, oldState, newState, config.author()) : null,
      // Edits CriticMarkup can't express are refused while suggesting, so
      // nothing changes that Reject couldn't undo (see untrackable).
      filterTransaction: (tr) =>
        !config.enabled() ||
        !!tr.getMeta(SUGGEST_META) ||
        !!tr.getMeta("history$") ||
        tr.getMeta("addToHistory") === false ||
        !untrackable(tr),
      props: {
        // Typing over a selection: some browsers (Firefox) report it as the
        // minimal DOM diff ("Hello" → "H" deletes only "ello"), which would
        // track the wrong range. Replace the whole selection instead.
        // Typing over a selection is taken before the browser edits the DOM:
        // Firefox otherwise turns "H" over "Hello" into a deletion of "ello"
        // (a DOM diff), which can't be told apart from a real deletion.
        handleDOMEvents: {
          beforeinput: (view, event) => {
            const e = event as InputEvent;
            if (!config.enabled() || e.inputType !== "insertText" || !e.data || view.composing) return false;
            const sel = view.state.selection;
            if (sel.empty) return false;
            e.preventDefault();
            view.dispatch(view.state.tr.insertText(e.data, sel.from, sel.to).scrollIntoView());
            return true;
          },
        },
        handleTextInput: (view, from, to, text) => {
          if (!config.enabled()) return false;
          const sel = view.state.selection;
          if (sel.empty || from < sel.from || to > sel.to) return false;
          // The reported range is a diff: the selected text outside it was
          // kept in the DOM (typing "H" over "Hello" arrives as "ello" → "").
          const doc = view.state.doc;
          const typed = doc.textBetween(sel.from, from, "", "") + text + doc.textBetween(to, sel.to, "", "");
          const tr = view.state.tr.insertText(typed, sel.from, sel.to);
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      },
    }),
);

/* ─── Accept / reject at the cursor ─────────────────────────────────── */

/** The run of `critic_*` marked text around `pos` (one change). */
export function changeAt(state: EditorState, pos: number): { from: number; to: number; type: "insert" | "delete" } | null {
  const ins = state.schema.marks.critic_insert;
  const del = state.schema.marks.critic_delete;
  if (!ins || !del) return null;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const base = $pos.start();
  const ranges: Array<{ from: number; to: number; type: "insert" | "delete"; author: string | null }> = [];
  parent.forEach((child, offset) => {
    if (!child.isText) return;
    const mark = ins.isInSet(child.marks) ?? del.isInSet(child.marks);
    if (!mark) return;
    const type = mark.type === ins ? "insert" : "delete";
    const author = (mark.attrs.author as string | null) ?? null;
    const from = base + offset;
    const to = from + child.nodeSize;
    const last = ranges[ranges.length - 1];
    // One change = adjacent text of the same kind AND author.
    if (last && last.type === type && last.author === author && last.to === from) last.to = to;
    else ranges.push({ from, to, type, author });
  });
  // A substitution (deletion + insertion by the same author) resolves as one.
  const inR = (x: { from: number; to: number }) => pos >= x.from && pos <= x.to;
  const pick = (r: (typeof ranges)[number]) => ({ from: r.from, to: r.to, type: r.type });
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const n = ranges[i + 1];
    if (r.type === "delete" && n?.type === "insert" && n.from === r.to && n.author === r.author && (inR(r) || inR(n))) {
      return { from: r.from, to: n.to, type: "delete" };
    }
  }
  // Otherwise the change under the cursor; at a boundary between two, the
  // one the cursor is inside of (or ends) first.
  const hit = ranges.find((r) => pos > r.from && pos < r.to) ?? ranges.find(inR);
  return hit ? pick(hit) : null;
}

/** Accept or reject every change in [from, to). */
export function resolveRange(state: EditorState, from: number, to: number, mode: "accept" | "reject"): Transaction | null {
  const ins = state.schema.marks.critic_insert;
  const del = state.schema.marks.critic_delete;
  if (!ins || !del) return null;
  const tr = state.tr.setMeta(SUGGEST_META, true);
  const drop: Array<[number, number]> = [];
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isText) return;
    const a = Math.max(pos, from);
    const b = Math.min(pos + n.nodeSize, to);
    const isIns = !!ins.isInSet(n.marks);
    const isDel = !!del.isInSet(n.marks);
    if (!isIns && !isDel) return;
    // accept: insert stays (unmarked), delete goes. reject: the opposite.
    if ((mode === "accept" && isDel) || (mode === "reject" && isIns)) drop.push([a, b]);
    else tr.removeMark(a, b, isIns ? ins : del);
  });
  for (const [a, b] of drop.reverse()) tr.delete(a, b);
  return tr.docChanged ? tr : null;
}

/** Resolve the change at the cursor; false when there is none. */
export function resolveAtCursor(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  mode: "accept" | "reject",
): boolean {
  const c = changeAt(view.state, view.state.selection.head);
  if (!c) return false;
  const tr = resolveRange(view.state, c.from, c.to, mode);
  if (!tr) return false;
  view.dispatch(tr);
  return true;
}

/** Move the cursor to the next (dir 1) / previous (-1) change. */
export function jumpToChange(view: { state: EditorState; dispatch: (tr: Transaction) => void }, dir: 1 | -1): boolean {
  const { state } = view;
  const ins = state.schema.marks.critic_insert;
  const del = state.schema.marks.critic_delete;
  if (!ins || !del) return false;
  const head = state.selection.head;
  // A change starts where marked text begins, or where the kind or author
  // changes — except a same-author deletion followed by an insertion,
  // which is one substitution (as changeAt resolves it).
  const starts: number[] = [];
  let prev: { kind: "insert" | "delete"; author: string | null; end: number } | null = null;
  state.doc.descendants((n, pos) => {
    if (!n.isText) {
      prev = null;
      return;
    }
    const mark = ins.isInSet(n.marks) ?? del.isInSet(n.marks);
    if (!mark) {
      prev = null;
      return;
    }
    const kind = mark.type === ins ? "insert" : "delete";
    const author = (mark.attrs.author as string | null) ?? null;
    const p = prev as { kind: "insert" | "delete"; author: string | null; end: number } | null;
    const continues =
      !!p && p.end === pos && p.author === author && (p.kind === kind || (p.kind === "delete" && kind === "insert"));
    if (!continues) starts.push(pos);
    prev = { kind, author, end: pos + n.nodeSize };
  });
  const target = dir === 1 ? starts.find((p) => p > head) : [...starts].reverse().find((p) => p < head);
  if (target === undefined) return false;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)).scrollIntoView());
  return true;
}

/** All Milkdown plugins of the feature, in `.use()` order. */
export const wysiwygSuggestPlugins = [criticRemark, criticInsertSchema, criticDeleteSchema, suggestTracking].flat();

