/**
 * Writing suggestions in the WYSIWYG editor (ProseMirror / Milkdown), plan
 * W13.W1 — the same contract as the source editor (cmBridge.ts):
 *  - the agent reads the document's text (`pmTextIndex`: each text block's
 *    characters, blocks separated by a blank line, an inline node as one
 *    object character), and its offsets map back to document positions;
 *  - each suggestion is an inline decoration (`ws ws-<kind>`), mapped
 *    through every edit; one whose words were edited is dropped;
 *  - `acceptInPm` applies the accepted ones in ONE transaction (one undo
 *    step), tagged with `markAiInsert` when a model wrote any of them.
 * A suggestion that would cross a block boundary is never applied here.
 * The plugin is added with `state.reconfigure`, so the editor's plugin
 * list (WysiwygEditor.tsx) is untouched.
 */
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@milkdown/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/prose/view";
import type { Node as PmNode } from "@milkdown/prose/model";
import { markAiInsert } from "../../editor/wysiwygAiAuthorship";
import { planChanges, type AcceptChoice, type ChangePlan } from "./engine";
import type { WritingSuggestion } from "./suggestion";

export interface PmTextIndex {
  text: string;
  /** Document position of each character (-1 for a block separator). */
  pos: Int32Array;
  /** Which block each character is in (-1 for a separator). */
  block: Int32Array;
}

const OBJ = "￼";

/** The document as plain text, with a way back to positions. */
export function pmTextIndex(doc: PmNode): PmTextIndex {
  let text = "";
  const pos: number[] = [];
  const block: number[] = [];
  let b = -1;
  doc.descendants((node, at) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code) return false;
    if (b >= 0) {
      text += "\n\n";
      pos.push(-1, -1);
      block.push(-1, -1);
    }
    b++;
    node.forEach((child, offset) => {
      const start = at + 1 + offset;
      if (child.isText) {
        const s = child.text ?? "";
        text += s;
        for (let i = 0; i < s.length; i++) {
          pos.push(start + i);
          block.push(b);
        }
      } else {
        text += OBJ;
        pos.push(start);
        block.push(b);
      }
    });
    return false;
  });
  return { text, pos: Int32Array.from(pos), block: Int32Array.from(block) };
}

/** Document positions for a text range, or null when it crosses a block or a separator. */
export function pmRange(ix: PmTextIndex, from: number, to: number): { from: number; to: number } | null {
  if (from < 0 || to > ix.text.length || to < from) return null;
  if (from === to) {
    if (from < ix.text.length && ix.block[from] >= 0) return { from: ix.pos[from], to: ix.pos[from] };
    if (from > 0 && ix.block[from - 1] >= 0) return { from: ix.pos[from - 1] + 1, to: ix.pos[from - 1] + 1 };
    return null;
  }
  const bk = ix.block[from];
  if (bk < 0 || ix.block[to - 1] !== bk) return null;
  for (let i = from; i < to; i++) if (ix.block[i] !== bk || ix.text[i] === OBJ) return null;
  return { from: ix.pos[from], to: ix.pos[to - 1] + 1 };
}

interface PmWs {
  list: readonly WritingSuggestion[];
  /** Each suggestion's document range, by id. */
  at: ReadonlyMap<string, { from: number; to: number }>;
  deco: DecorationSet;
}

export const writingPmKey = new PluginKey<PmWs>("lumen-writing-suggestions");
const SET = "lumenWritingSet";

function build(doc: PmNode, list: readonly WritingSuggestion[]): PmWs {
  const ix = pmTextIndex(doc);
  const at = new Map<string, { from: number; to: number }>();
  const kept: WritingSuggestion[] = [];
  for (const s of list) {
    const r = pmRange(ix, s.range.from, s.range.to);
    if (!r || ix.text.slice(s.range.from, s.range.to) !== s.original) continue;
    at.set(s.id, r);
    kept.push(s);
  }
  return { list: kept, at, deco: decos(doc, kept, at) };
}

function decos(doc: PmNode, list: readonly WritingSuggestion[], at: ReadonlyMap<string, { from: number; to: number }>): DecorationSet {
  return DecorationSet.create(
    doc,
    list.flatMap((s) => {
      const r = at.get(s.id);
      return r && r.to > r.from ? [Decoration.inline(r.from, r.to, { class: `ws ws-${s.kind}${s.replacement === null ? " ws-advice" : ""}`, "data-ws-id": s.id, title: s.message })] : [];
    }),
  );
}

export function writingPmPlugin(): Plugin<PmWs> {
  return new Plugin<PmWs>({
    key: writingPmKey,
    state: {
      init: () => ({ list: [], at: new Map(), deco: DecorationSet.empty }),
      apply(tr: Transaction, v: PmWs, _old: EditorState, next: EditorState): PmWs {
        const set = tr.getMeta(SET) as readonly WritingSuggestion[] | undefined;
        if (set) return build(next.doc, set);
        if (!tr.docChanged || !v.list.length) return v;
        // Re-read the text: a suggestion survives only if its words are unchanged where they now are.
        const ix = pmTextIndex(next.doc);
        const kept: WritingSuggestion[] = [];
        const at = new Map<string, { from: number; to: number }>();
        for (const s of v.list) {
          const old = v.at.get(s.id)!;
          const a = tr.mapping.mapResult(old.from, 1);
          const b = tr.mapping.mapResult(old.to, -1);
          if (a.deleted || b.deleted || next.doc.textBetween(a.pos, Math.max(a.pos, b.pos), "\n", OBJ) !== s.original) continue;
          // Its new text offset: the index of the character at the mapped position.
          const from = ix.pos.indexOf(a.pos);
          if (from < 0 && s.original.length) continue;
          kept.push({ ...s, range: { from, to: from + s.original.length } });
          at.set(s.id, { from: a.pos, to: Math.max(a.pos, b.pos) });
        }
        return { list: kept, at, deco: decos(next.doc, kept, at) };
      },
    },
    props: { decorations: (st) => writingPmKey.getState(st)?.deco ?? DecorationSet.empty },
    view: () => ({
      update(view: EditorView, prev: EditorState) {
        const a = writingPmKey.getState(prev)?.list;
        const b = writingPmKey.getState(view.state)?.list;
        if (a !== b) for (const fn of pmListeners.get(view) ?? []) fn(b ?? []);
      },
    }),
  });
}

const pmListeners = new WeakMap<EditorView, Set<(list: readonly WritingSuggestion[]) => void>>();

/** Calls `fn` now and whenever the view's suggestions change; returns the unsubscribe. */
export function onPmSuggestionsChange(view: EditorView, fn: (list: readonly WritingSuggestion[]) => void): () => void {
  let set = pmListeners.get(view);
  if (!set) pmListeners.set(view, (set = new Set()));
  set.add(fn);
  fn(pmSuggestions(view.state));
  return () => set!.delete(fn);
}

export function ensurePmInstalled(view: EditorView): void {
  if (writingPmKey.getState(view.state)) return;
  view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, writingPmPlugin()] }));
}

export function pmSuggestions(state: EditorState): readonly WritingSuggestion[] {
  return writingPmKey.getState(state)?.list ?? [];
}

export function showPmSuggestions(view: EditorView, list: readonly WritingSuggestion[]): void {
  ensurePmInstalled(view);
  view.dispatch(view.state.tr.setMeta(SET, list).setMeta("addToHistory", false));
}

/** Optional: prosemirror-history's closeHistory, so the accept is its own undo step. */
let close: ((tr: Transaction) => Transaction) | null | undefined;
export async function loadPmHistoryClose(): Promise<void> {
  if (close !== undefined) return;
  try {
    close = ((await import("@milkdown/prose/history")) as unknown as { closeHistory: (tr: Transaction) => Transaction }).closeHistory;
  } catch {
    close = null;
  }
}

/** Applies the accepted suggestions in one transaction; the rest stay. */
export function acceptInPm(view: EditorView, choices: readonly AcceptChoice[]): ChangePlan {
  const st = writingPmKey.getState(view.state);
  if (!st) return { changes: [], skipped: choices.map((c) => ({ id: c.id, reason: "unknown" as const })) };
  const ix = pmTextIndex(view.state.doc);
  const plan = planChanges(ix.text, st.list, choices);
  if (!plan.changes.length) return plan;
  let tr = view.state.tr;
  if (close) tr = close(tr);
  // From the end, so earlier positions stay valid.
  for (const c of [...plan.changes].reverse()) {
    const r = st.at.get(c.id)!;
    if (c.insert) tr.insertText(c.insert, r.from, r.to);
    else tr.delete(r.from, r.to);
  }
  // The accepted ones drop out as their words change; the others are mapped (the plugin's apply).
  // A model's replacement goes through markAiInsert at the insertion (5.9).
  view.dispatch(plan.changes.some((c) => c.ai) ? markAiInsert(tr) : tr);
  return plan;
}

/** The panel's focus on a card: the editor selects its words. */
export function focusPm(view: EditorView, id: string | null): void {
  const r = id ? writingPmKey.getState(view.state)?.at.get(id) : undefined;
  if (!r) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, r.from, r.to)).scrollIntoView().setMeta("addToHistory", false));
}

export function rejectInPm(view: EditorView, ids: readonly string[]): void {
  const drop = new Set(ids);
  view.dispatch(view.state.tr.setMeta(SET, pmSuggestions(view.state).filter((s) => !drop.has(s.id))).setMeta("addToHistory", false));
}
