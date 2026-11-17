/**
 * Writing suggestions in the source editor (CodeMirror), plan W13.W1:
 *  - an underline per suggestion, coloured and styled by kind
 *    (`cm-ws cm-ws-<kind>`; advice-only suggestions dotted), with the
 *    message as its title and `data-ws-id` for the panel;
 *  - every edit maps the ranges, and a suggestion whose words were edited
 *    is dropped (never applied to text it was not made on);
 *  - `acceptInView` applies the accepted suggestions as ONE transaction:
 *    one Ctrl+Z puts every one of them back. A model's replacement carries
 *    the AI tag (`aiAuthored`, plan 5.9).
 *
 * This bridge is the only code under src/agents/writing that changes a
 * document, and it only runs on the user's accept (the panel's buttons).
 * Installed on demand with StateEffect.appendConfig: the editor's own
 * extension list is untouched and the startup bundle does not grow.
 */
import { StateEffect, StateField, Transaction, type Extension, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { aiAuthored } from "../../editor/aiAuthorship";
import { mapSuggestions, planChanges, type AcceptChoice, type ChangePlan, type TouchedRange } from "./engine";
import type { WritingSuggestion } from "./suggestion";

export const setWritingSuggestions = StateEffect.define<readonly WritingSuggestion[]>();
/** The suggestion the panel has focused (drawn stronger). */
export const focusWritingSuggestion = StateEffect.define<string | null>();

interface WsState {
  list: readonly WritingSuggestion[];
  focused: string | null;
}

export const writingSuggestionsField = StateField.define<WsState>({
  create: () => ({ list: [], focused: null }),
  update(v, tr) {
    let { list, focused } = v;
    // Effects first: a list set by a transaction that also changes the text is in its start coordinates.
    for (const e of tr.effects) {
      if (e.is(setWritingSuggestions)) list = e.value;
      if (e.is(focusWritingSuggestion)) focused = e.value;
    }
    if (tr.docChanged && list.length) {
      const touched: TouchedRange[] = [];
      tr.changes.iterChangedRanges((fromA, toA) => touched.push({ fromA, toA }));
      const doc = tr.state.doc.toString();
      list = mapSuggestions(list, (p, assoc) => tr.changes.mapPos(p, assoc), touched, doc);
    }
    return list === v.list && focused === v.focused ? v : { list, focused };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => decorationsOf(v.list, v.focused)),
});

function decorationsOf(list: readonly WritingSuggestion[], focused: string | null): DecorationSet {
  const ranges = list
    .filter((s) => s.range.to > s.range.from)
    .map((s) =>
      Decoration.mark({
        class: `cm-ws cm-ws-${s.kind}${s.replacement === null ? " cm-ws-advice" : ""}${s.blocked ? " cm-ws-blocked" : ""}${s.id === focused ? " cm-ws-focused" : ""}`,
        attributes: { "data-ws-id": s.id, title: s.message },
      }).range(s.range.from, s.range.to),
    );
  return Decoration.set(ranges, true);
}

/** Underline styles: colour by family, thickness by confidence would be noise; style tells advice from fix. */
const theme = EditorView.baseTheme({
  ".cm-ws": { textDecorationLine: "underline", textDecorationThickness: "2px", textUnderlineOffset: "3px", textDecorationSkipInk: "none", textDecorationColor: "hsl(210 70% 55%)" },
  ".cm-ws-grammar, .cm-ws-spelling": { textDecorationColor: "hsl(0 72% 55%)", textDecorationStyle: "wavy" },
  ".cm-ws-clarity, .cm-ws-passive, .cm-ws-nominalization, .cm-ws-readability, .cm-ws-structure": { textDecorationColor: "hsl(210 70% 55%)" },
  ".cm-ws-concision, .cm-ws-wordiness, .cm-ws-redundancy, .cm-ws-hedge, .cm-ws-repetition": { textDecorationColor: "hsl(150 55% 40%)" },
  ".cm-ws-tone, .cm-ws-register, .cm-ws-wordChoice, .cm-ws-expansion": { textDecorationColor: "hsl(275 55% 58%)" },
  ".cm-ws-logic, .cm-ws-consistency": { textDecorationColor: "hsl(30 85% 50%)" },
  ".cm-ws-advice": { textDecorationStyle: "dotted" },
  ".cm-ws-blocked": { textDecorationStyle: "dashed" },
  ".cm-ws-focused": { backgroundColor: "hsl(210 70% 55% / 0.14)", borderRadius: "2px" },
});

/** The panels that follow a view's suggestions. */
const listeners = new WeakMap<EditorView, Set<(list: readonly WritingSuggestion[]) => void>>();

const notify = EditorView.updateListener.of((u) => {
  const a = u.startState.field(writingSuggestionsField, false)?.list;
  const b = u.state.field(writingSuggestionsField, false)?.list;
  if (a !== b) for (const fn of listeners.get(u.view) ?? []) fn(b ?? []);
});

/** Calls `fn` now and whenever the view's suggestions change; returns the unsubscribe. */
export function onSuggestionsChange(view: EditorView, fn: (list: readonly WritingSuggestion[]) => void): () => void {
  let set = listeners.get(view);
  if (!set) listeners.set(view, (set = new Set()));
  set.add(fn);
  fn(suggestionsIn(view.state));
  return () => set!.delete(fn);
}

export function writingSuggestionsExtension(): Extension {
  return [writingSuggestionsField, theme, notify];
}

/** Installs the field once per view (idempotent). */
export function ensureInstalled(view: EditorView): void {
  if (view.state.field(writingSuggestionsField, false) !== undefined) return;
  view.dispatch({ effects: StateEffect.appendConfig.of(writingSuggestionsExtension()) });
}

export function suggestionsIn(state: EditorState): readonly WritingSuggestion[] {
  return state.field(writingSuggestionsField, false)?.list ?? [];
}

export function showSuggestions(view: EditorView, list: readonly WritingSuggestion[]): void {
  ensureInstalled(view);
  view.dispatch({ effects: setWritingSuggestions.of(list) });
}

export function focusSuggestion(view: EditorView, id: string | null): void {
  ensureInstalled(view);
  const s = id ? suggestionsIn(view.state).find((x) => x.id === id) : undefined;
  view.dispatch({ effects: focusWritingSuggestion.of(id), ...(s ? { selection: { anchor: s.range.from, head: s.range.to }, scrollIntoView: true } : {}) });
}

/** Optional: @codemirror/commands' isolateHistory, so the accept never joins the typing before it. */
let isolate: { of(v: "full"): unknown } | null | undefined;
export async function loadHistoryIsolation(): Promise<void> {
  if (isolate !== undefined) return;
  try {
    isolate = (await import("@codemirror/commands")).isolateHistory as never;
  } catch {
    isolate = null;
  }
}

/**
 * Applies the accepted suggestions in one transaction (one undo step) and
 * removes them, with the ones it could not apply left in place. Returns
 * the plan, so the panel can say what was skipped and why.
 */
export function acceptInView(view: EditorView, choices: readonly AcceptChoice[]): ChangePlan {
  const list = suggestionsIn(view.state);
  const plan = planChanges(view.state.doc.toString(), list, choices);
  if (!plan.changes.length) return plan;
  const done = new Set(plan.changes.map((c) => c.id));
  const rest = list.filter((s) => !done.has(s.id));
  const changes = plan.changes.map(({ from, to, insert }) => ({ from, to, insert }));
  const annotations = [Transaction.userEvent.of("input.writing"), ...(isolate ? [isolate.of("full") as never] : [])];
  // A model's replacement carries aiAuthored at the insertion (5.9); a rule's fix or the user's own edit does not.
  if (plan.changes.some((c) => c.ai)) view.dispatch({ changes, effects: setWritingSuggestions.of(rest), annotations: [...annotations, aiAuthored.of(true)] });
  else view.dispatch({ changes, effects: setWritingSuggestions.of(rest), annotations });
  return plan;
}

export function rejectInView(view: EditorView, ids: readonly string[]): void {
  const drop = new Set(ids);
  view.dispatch({ effects: setWritingSuggestions.of(suggestionsIn(view.state).filter((s) => !drop.has(s.id))) });
}
