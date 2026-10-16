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

/**
 * The serializer keeps whitespace at a mark's edge outside the mark, which
 * splits `{++new **bold**++}` into two runs around the space. Fold such a
 * following run (same kind and author, separated only by whitespace) back
 * into this one before printing.
 */
function absorbFollowing(node: CriticNode, parent?: { children: unknown[] }): void {
  if (!parent) return;
  const i = parent.children.indexOf(node);
  for (;;) {
    const a = parent.children[i + 1] as { type: string; value?: string; author?: string; children?: PhrasingContent[] } | undefined;
    const b = parent.children[i + 2] as typeof a;
    if (a && a.type === node.type && (a.author ?? null) === (node.author ?? null)) {
      node.children.push(...(a.children ?? []));
      parent.children.splice(i + 1, 1);
      continue;
    }
    if (a?.type === "text" && /^\s+$/.test(a.value ?? "") && b && b.type === node.type && (b.author ?? null) === (node.author ?? null)) {
      node.children.push({ type: "text", value: a.value! }, ...(b.children ?? []));
      parent.children.splice(i + 1, 2);
      continue;
    }
    return;
  }
}

const criticDeleteHandler: Handler = (node, parent, state, info) => {
  absorbFollowing(node, parent);
  const inner = state.containerPhrasing(node, info);
  const { next } = siblings(node, parent);
  // A deletion followed directly by an insertion is one substitution.
  if (next?.type === "criticInsert") return `{~~${inner}~>`;
  return `{--${inner}--}${tag(node.author)}`;
};
const criticInsertHandler: Handler = (node, parent, state, info) => {
  absorbFollowing(node, parent);
  const inner = state.containerPhrasing(node, info);
  const { prev } = siblings(node, parent);
  if (prev?.type === "criticDelete") return `${inner}~~}${tag(node.author ?? prev.author)}`;
  return `{++${inner}++}${tag(node.author)}`;
};

/** The remark plugin: parse sentinels on the way in, write CriticMarkup out. */
export function remarkCriticMarkup(this: { data: (key?: string) => Record<string, unknown> }) {
  const data = this.data() as { toMarkdownExtensions?: unknown[] };
  (data.toMarkdownExtensions ??= []).push({
    handlers: { criticInsert: criticInsertHandler, criticDelete: criticDeleteHandler },
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
      runner: (state, mark) => {
        state.withMark(mark, mdType, undefined, mark.attrs.author ? { author: mark.attrs.author } : {});
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
  const changes: Array<Change & { toEnd: Mapping }> = [];
  user.forEach((tr, ti) => {
    tr.steps.forEach((step, i) => {
      if (!(step instanceof ReplaceStep)) return;
      const before = tr.docs[i];
      const s = step as unknown as { from: number; to: number; slice: Slice };
      const toEnd = tr.mapping.slice(i + 1);
      for (const later of user.slice(ti + 1)) toEnd.appendMapping(later.mapping);
      changes.push({ from: s.from, insertedSize: s.slice.size, deleted: before.slice(s.from, s.to), toEnd });
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
    // 1. Insertions are suggested.
    if (insertedEnd > at) {
      tr.removeMark(at, insertedEnd, del);
      tr.addMark(at, insertedEnd, ins.create(attrs));
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
    tr.insert(at, c.deleted.content);
    const end = at + c.deleted.content.size;
    // Drop the parts that were suggested insertions; mark the rest deleted.
    const ownRanges: Array<[number, number]> = [];
    tr.doc.nodesBetween(at, end, (n, pos) => {
      if (n.isText) {
        if (ins.isInSet(n.marks)) ownRanges.push([pos, pos + n.nodeSize]);
        else tr.addMark(Math.max(pos, at), Math.min(pos + n.nodeSize, end), del.create(attrs));
      }
    });
    for (const [f, t] of ownRanges.reverse()) tr.delete(f, t);
    const keptEnd = tr.mapping.map(end, -1);
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
  const ranges: Array<{ from: number; to: number; type: "insert" | "delete" }> = [];
  parent.forEach((child, offset) => {
    if (!child.isText) return;
    const type = ins.isInSet(child.marks) ? "insert" : del.isInSet(child.marks) ? "delete" : null;
    if (!type) return;
    const from = base + offset;
    const to = from + child.nodeSize;
    const last = ranges[ranges.length - 1];
    if (last && last.type === type && last.to === from) last.to = to;
    else ranges.push({ from, to, type });
  });
  // A substitution (deletion + insertion) resolves as one.
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const n = ranges[i + 1];
    const inR = (x: { from: number; to: number }) => pos >= x.from && pos <= x.to;
    if (r.type === "delete" && n?.type === "insert" && n.from === r.to && (inR(r) || inR(n))) {
      return { from: r.from, to: n.to, type: "delete" };
    }
    if (inR(r)) return r;
  }
  return null;
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
  const starts: number[] = [];
  let prevMarked = false;
  state.doc.descendants((n, pos) => {
    if (!n.isText) {
      prevMarked = false;
      return;
    }
    const marked = !!(ins.isInSet(n.marks) || del.isInSet(n.marks));
    if (marked && !prevMarked) starts.push(pos);
    prevMarked = marked;
  });
  const target = dir === 1 ? starts.find((p) => p > head) : [...starts].reverse().find((p) => p < head);
  if (target === undefined) return false;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)).scrollIntoView());
  return true;
}

/** All Milkdown plugins of the feature, in `.use()` order. */
export const wysiwygSuggestPlugins = [criticRemark, criticInsertSchema, criticDeleteSchema, suggestTracking].flat();

