/**
 * Focus mode's display layer in the source editor (plan W13.R2):
 *  - dim everything but the line, sentence or paragraph at the cursor
 *    (iA Writer's focus), and
 *  - readability highlights (Hemingway): long and very long sentences,
 *    passive voice, adverbs and complex words, each with its own colour AND
 *    its own underline style (solid, double, dashed, dotted, wavy), so the
 *    kind never rests on colour alone (WCAG 1.4.1).
 *
 * Only decorations: the layer never dispatches a change, so the note is
 * byte-for-byte what it was (src/__tests__/hemingwayOverlay.test.ts).
 * It lives in its own compartment, added to a running editor with
 * `StateEffect.appendConfig` — Editor.tsx does not know about it.
 */
import { Compartment, RangeSet, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { focusSpan, type FocusUnit } from "../reading/focusUnits";
import { analyzeReadability, HW_STYLES, type HemingwayFinding, type HemingwayKind } from "../reading/hemingway";

export interface FocusLayerConfig {
  /** null = no dimming. */
  unit: FocusUnit | null;
  hemingway: boolean;
  /** Findings from the style coach (W13.W3) instead of the local rules. */
  findings?: (text: string) => HemingwayFinding[];
}

export const OFF: FocusLayerConfig = { unit: null, hemingway: false };

const setConfig = StateEffect.define<FocusLayerConfig>();
const configField = StateField.define<FocusLayerConfig>({
  create: () => OFF,
  update: (v, tr) => tr.effects.reduce((cur, e) => (e.is(setConfig) ? e.value : cur), v),
});

const dim = Decoration.mark({ class: "cm-focus-dim" });
const marks: Record<HemingwayKind, Decoration> = {
  veryLong: Decoration.mark({ class: "cm-hw cm-hw-veryLong", attributes: { "data-hw": "veryLong" } }),
  long: Decoration.mark({ class: "cm-hw cm-hw-long", attributes: { "data-hw": "long" } }),
  passive: Decoration.mark({ class: "cm-hw cm-hw-passive", attributes: { "data-hw": "passive" } }),
  adverb: Decoration.mark({ class: "cm-hw cm-hw-adverb", attributes: { "data-hw": "adverb" } }),
  complex: Decoration.mark({ class: "cm-hw cm-hw-complex", attributes: { "data-hw": "complex" } }),
};

/** How far around the cursor the focus span is looked for: a paragraph longer than this is cut there. */
export const FOCUS_WINDOW = 20_000;

/**
 * The focus span read from a window of the document around `pos`, never the whole text (review 13 M4:
 * every keystroke and caret move turned a 960k-character note into one string).
 */
export function focusSpanIn(doc: { length: number; sliceString(from: number, to?: number): string }, pos: number, unit: FocusUnit): { from: number; to: number } {
  const from = Math.max(0, pos - FOCUS_WINDOW);
  const to = Math.min(doc.length, pos + FOCUS_WINDOW);
  const s = focusSpan(doc.sliceString(from, to), pos - from, unit);
  return { from: s.from + from, to: s.to + from };
}

/** The dimmed ranges: everything outside the focus span (pure; tests). */
export function dimRanges(text: string, pos: number, unit: FocusUnit): Array<{ from: number; to: number }> {
  const s = focusSpan(text, pos, unit);
  const out: Array<{ from: number; to: number }> = [];
  if (s.from > 0) out.push({ from: 0, to: s.from });
  if (s.to < text.length) out.push({ from: s.to, to: text.length });
  return out;
}

/** The findings the layer would draw for `state` (tests and the legend). */
export function layerFindings(state: EditorState): HemingwayFinding[] {
  const cfg = state.field(configField, false) ?? OFF;
  if (!cfg.hemingway) return [];
  const text = state.doc.toString();
  return cfg.findings ? cfg.findings(text) : analyzeReadability(text);
}

/** The dimmed text around the focus span (read from a window: focusSpanIn). */
function dims(view: EditorView): DecorationSet {
  const cfg = view.state.field(configField, false) ?? OFF;
  if (!cfg.unit) return Decoration.none;
  const len = view.state.doc.length;
  const s = focusSpanIn(view.state.doc, view.state.selection.main.head, cfg.unit);
  const ranges: Range<Decoration>[] = [];
  if (s.from > 0) ranges.push(dim.range(0, s.from));
  if (s.to < len) ranges.push(dim.range(s.to, len));
  return Decoration.set(ranges, true);
}

/** The findings' marks: rebuilt only when the findings change, not on every caret move (review 13 M4). */
function markSet(view: EditorView, findings: HemingwayFinding[]): DecorationSet {
  const len = view.state.doc.length;
  const ranges: Range<Decoration>[] = [];
  for (const f of findings) if (f.to > f.from && f.to <= len) ranges.push(marks[f.kind].range(f.from, f.to));
  return Decoration.set(ranges, true);
}

function build(view: EditorView, findings: HemingwayFinding[], hw?: DecorationSet): { all: DecorationSet; hw: DecorationSet } {
  const h = hw ?? markSet(view, findings);
  return { all: RangeSet.join([dims(view), h]), hw: h };
}

/** Listeners for the legend's counters. */
type Listener = (findings: HemingwayFinding[]) => void;
const listeners = new WeakMap<EditorView, Set<Listener>>();

export function onFindings(view: EditorView, fn: Listener): () => void {
  const set = listeners.get(view) ?? new Set();
  listeners.set(view, set);
  set.add(fn);
  return () => set.delete(fn);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    hw: DecorationSet;
    findings: HemingwayFinding[] = [];
    timer: ReturnType<typeof setTimeout> | null = null;
    constructor(readonly view: EditorView) {
      this.findings = layerFindings(view.state);
      ({ all: this.decorations, hw: this.hw } = build(view, this.findings));
      queueMicrotask(() => this.emit());
    }
    emit() {
      for (const fn of listeners.get(this.view) ?? []) fn(this.findings);
    }
    update(u: ViewUpdate) {
      const cfgChanged = u.startState.field(configField, false) !== u.state.field(configField, false);
      if (cfgChanged) {
        this.findings = layerFindings(u.state);
        this.emit();
      } else if (u.docChanged) {
        // Typing: keep the old findings mapped, re-analyse when the typing pauses.
        this.findings = this.findings.map((f) => ({ ...f, from: u.changes.mapPos(f.from, 1), to: u.changes.mapPos(f.to, -1) })).filter((f) => f.to > f.from);
        this.hw = this.hw.map(u.changes);
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          this.findings = layerFindings(this.view.state);
          ({ all: this.decorations, hw: this.hw } = build(this.view, this.findings));
          this.view.dispatch({ effects: [] });
          this.emit();
        }, 250);
      }
      // A caret move redraws the dimming only; the marks are rebuilt when the findings change.
      if (cfgChanged) ({ all: this.decorations, hw: this.hw } = build(u.view, this.findings));
      else if (u.docChanged || u.selectionSet) this.decorations = build(u.view, this.findings, this.hw).all;
    }
    destroy() {
      if (this.timer) clearTimeout(this.timer);
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Colours (../reading/hemingway.ts HW_STYLES): each tint keeps body text
 * ≥ 4.5:1 (AA) in the light and dark themes; the underline style tells the
 * kinds apart without colour.
 */
const theme = EditorView.baseTheme({
  ".cm-focus-dim": { opacity: "0.32", transition: "opacity 120ms" },
  ".cm-hw": { textDecorationLine: "underline", textDecorationThickness: "2px", textUnderlineOffset: "3px", borderRadius: "2px" },
  ...Object.fromEntries(
    Object.entries(HW_STYLES).flatMap(([k, v]) => [
      [`&light .cm-hw-${k}`, { backgroundColor: v.light, textDecorationColor: v.line, textDecorationStyle: v.style }],
      [`&dark .cm-hw-${k}`, { backgroundColor: v.dark, textDecorationColor: v.lineDark, textDecorationStyle: v.style }],
    ]),
  ),
});

const compartment = new Compartment();
const installed = new WeakSet<EditorView>();

export function focusLayerExtension(cfg: FocusLayerConfig = OFF): Extension {
  return [configField.init(() => cfg), plugin, theme];
}

/** Turn the layer on, change it, or (OFF) turn it off — on a running editor. */
export function setFocusLayer(view: EditorView, cfg: FocusLayerConfig): void {
  if (!installed.has(view)) {
    installed.add(view);
    view.dispatch({ effects: StateEffect.appendConfig.of(compartment.of(focusLayerExtension(cfg))) });
    return;
  }
  view.dispatch({ effects: setConfig.of(cfg) });
}
