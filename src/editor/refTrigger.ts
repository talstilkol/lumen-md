/**
 * Typing a Jewish-source reference offers its text (plan W5.1 step 1, W10.C24).
 *
 * When the words just before the cursor are a full reference — "בראשית א ג",
 * "שמות כ׳:ב׳", "Gen. 1:3", "ברכות ב." — a small suggestion opens under it:
 * "Quote this from Sefaria? Only the reference is sent." Nothing is sent
 * while the user types: the request goes out only on Insert (a click, or
 * Alt+Enter), through the sources app (`lookup`: a saved offline copy first,
 * then the privacy ledger's consented fetch). Escape dismisses it for that
 * reference.
 *
 * The verse under the cursor (typed, or a [[reference]] link) is also
 * published to `onCursorVerse` listeners: the "My notes on this verse" side
 * panel follows it.
 *
 * Startup cost: this file and the CodeMirror pieces only. The reference
 * parser (books and aliases) loads on the first line that looks like a
 * reference, and the Sefaria client only on Insert.
 */
import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap, showTooltip, type Tooltip, type ViewUpdate } from "@codemirror/view";
import { t } from "../i18n";
import type { SourceRef } from "../sources/sefaria/refs";

export interface RefSuggestion {
  from: number;
  to: number;
  text: string;
  ref: SourceRef;
}

type Parse = (s: string) => SourceRef | null;

/** A run of words that could end in a reference: a name, then one or two numbers (Hebrew numerals or digits). */
const MAYBE_REF = /[\p{L}"'״׳.]{2,}\s*[\s:,.]\s*[\dא-ת"'״׳]{1,6}(?:\s*[\s:,.-]\s*[\dא-ת"'״׳]{1,6}){0,2}[.:]?$/u;

/**
 * The longest reference that ends exactly at the end of `before` (the line
 * up to the cursor), with a verse, a mishnah or a folio side: a bare
 * "בראשית א" is a chapter heading as often as a citation, so it is not offered.
 */
export function findTypedRef(before: string, parse: Parse): { start: number; text: string; ref: SourceRef } | null {
  if (!MAYBE_REF.test(before)) return null;
  // Not inside a link, an inline code span or a quote of the source already inserted.
  const open = before.lastIndexOf("[[");
  if (open >= 0 && before.indexOf("]]", open) < 0) return null;
  if ((before.match(/`/g) ?? []).length % 2 === 1) return null;
  const starts: number[] = [];
  for (const m of before.matchAll(/(^|\s|[(\[«"״—–-])(?=\S)/gu)) starts.push(m.index! + m[1]!.length);
  for (const start of starts.slice(-8)) {
    const text = before.slice(start).trim();
    if (text.length < 4 || text.length > 60) continue;
    const ref = parse(text);
    if (ref && (ref.verse !== undefined || ref.side !== undefined)) return { start, text, ref };
  }
  return null;
}

/** A [[reference]] link that holds `pos`, on its line. */
function linkRefAt(line: string, offset: number, parse: Parse): SourceRef | null {
  for (const m of line.matchAll(/!?\[\[[^\]\n]+\]\]/g)) {
    if (offset >= m.index! && offset <= m.index! + m[0].length) return parse(m[0]);
  }
  return null;
}

// ── The verse under the cursor, for the side panel ──────────────────────

type VerseListener = (ref: SourceRef | null) => void;
const verseListeners = new Set<VerseListener>();
let lastVerse: SourceRef | null = null;

/** Follow the verse under the cursor of the source editor. Calls back at once with the current one. */
export function onCursorVerse(fn: VerseListener): () => void {
  verseListeners.add(fn);
  fn(lastVerse);
  return () => verseListeners.delete(fn);
}

function publishVerse(ref: SourceRef | null): void {
  if ((ref?.key ?? null) === (lastVerse?.key ?? null)) return;
  lastVerse = ref;
  for (const fn of [...verseListeners]) fn(ref);
}

// ── The editor extension ────────────────────────────────────────────────

const setSuggestion = StateEffect.define<RefSuggestion | null>();

export interface RefTriggerOptions {
  /** The reference parser (default: sources/sefaria/refs.ts, loaded on first need). */
  parse?: Parse;
  /** Insert was chosen: fetch the text, with consent given by the click, and replace the typed reference. */
  insert?: (view: EditorView, s: RefSuggestion) => Promise<void>;
}

/** The default Insert: the sources app's lookup (saved copy first), then the quote replaces the typed text. */
async function defaultInsert(view: EditorView, s: RefSuggestion): Promise<void> {
  const [app, { useToastStore }, { explainError }] = await Promise.all([import("../sources/sefaria/app"), import("../store/useToastStore"), import("../lib/userError")]);
  try {
    // The click on Insert is the consent: the reference, and only it, goes to sefaria.org (privacy ledger).
    const r = await app.lookup(s.ref, async () => true);
    if (!r) return;
    if (view.state.sliceDoc(s.from, s.to) !== s.text) {
      useToastStore.getState().push({ kind: "info", title: t("sources.trigger.changed", { ref: s.ref.he }) });
      return;
    }
    view.dispatch({ changes: { from: s.from, to: s.to, insert: app.quoteBlock(r.passage) }, userEvent: "input" });
    view.focus();
  } catch (e) {
    useToastStore.getState().push({ kind: "error", title: t("sources.failed", { error: explainError(e) }) });
  }
}

export function sefariaRefTrigger(o: RefTriggerOptions = {}): Extension {
  let parse: Parse | null = o.parse ?? null;
  let loading: Promise<void> | null = null;
  const insert = o.insert ?? defaultInsert;
  /** "key@from" of suggestions the user dismissed. */
  const dismissed = new Set<string>();

  const field = StateField.define<RefSuggestion | null>({
    create: () => null,
    update(v, tr) {
      for (const e of tr.effects) if (e.is(setSuggestion)) return e.value;
      if (!v) return v;
      if (tr.docChanged) return null; // recomputed by the plugin
      const head = tr.state.selection.main.head;
      return head === v.to ? v : null;
    },
    provide: (f) => showTooltip.from(f, (s) => (s ? tooltip(s) : null)),
  });

  const accept = (view: EditorView): boolean => {
    const s = view.state.field(field, false);
    if (!s) return false;
    view.dispatch({ effects: setSuggestion.of(null) });
    void insert(view, s);
    return true;
  };
  const dismiss = (view: EditorView): boolean => {
    const s = view.state.field(field, false);
    if (!s) return false;
    dismissed.add(`${s.ref.key}@${s.from}`);
    view.dispatch({ effects: setSuggestion.of(null) });
    return true;
  };

  function tooltip(s: RefSuggestion): Tooltip {
    return {
      pos: s.to,
      above: false,
      create(view) {
        const dom = document.createElement("div");
        dom.className = "cm-sefaria-suggest";
        dom.setAttribute("role", "dialog");
        dom.setAttribute("aria-label", t("sources.trigger.label"));
        dom.dataset.testid = "sefaria-suggest";
        const msg = document.createElement("span");
        msg.textContent = t("sources.trigger.suggest", { ref: s.ref.he });
        const ok = document.createElement("button");
        ok.type = "button";
        ok.textContent = t("sources.trigger.insert");
        ok.setAttribute("aria-keyshortcuts", "Alt+Enter");
        ok.dataset.testid = "sefaria-suggest-insert";
        ok.addEventListener("mousedown", (e) => e.preventDefault());
        ok.addEventListener("click", () => accept(view));
        const no = document.createElement("button");
        no.type = "button";
        no.textContent = "×";
        no.setAttribute("aria-label", t("sources.trigger.dismiss"));
        no.dataset.testid = "sefaria-suggest-dismiss";
        no.addEventListener("mousedown", (e) => e.preventDefault());
        no.addEventListener("click", () => dismiss(view));
        dom.append(msg, ok, no);
        return { dom };
      },
    };
  }

  const plugin = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        this.compute();
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet) this.compute();
      }
      compute() {
        const { state } = this.view;
        const sel = state.selection.main;
        if (!sel.empty) return this.set(null, null);
        const line = state.doc.lineAt(sel.head);
        const before = line.text.slice(0, sel.head - line.from);
        const looks = MAYBE_REF.test(before) || line.text.includes("[[");
        if (!looks) return this.set(null, null);
        if (!parse) {
          loading ??= import("../sources/sefaria/refs").then((m) => {
            parse = m.parseSourceRef;
          });
          void loading.then(() => this.compute());
          return;
        }
        const after = line.text.slice(sel.head - line.from, sel.head - line.from + 1);
        const typed = /^[\p{L}\p{N}]$/u.test(after) ? null : findTypedRef(before, parse);
        const s = typed ? { from: line.from + typed.start, to: sel.head, text: typed.text, ref: typed.ref } : null;
        const verse = s?.ref ?? linkRefAt(line.text, sel.head - line.from, parse);
        this.set(s && !dismissed.has(`${s.ref.key}@${s.from}`) ? s : null, verse);
      }
      set(s: RefSuggestion | null, verse: SourceRef | null) {
        publishVerse(verse);
        const cur = this.view.state.field(field, false) ?? null;
        if ((cur?.ref.key ?? null) === (s?.ref.key ?? null) && cur?.from === s?.from && cur?.to === s?.to) return;
        // A plugin may not dispatch during an update: next microtask.
        queueMicrotask(() => {
          if (this.view.state.field(field, false) !== undefined) this.view.dispatch({ effects: setSuggestion.of(s) });
        });
      }
    },
  );

  return [
    field,
    plugin,
    Prec.high(
      keymap.of([
        { key: "Alt-Enter", run: accept },
        { key: "Escape", run: dismiss },
      ]),
    ),
    EditorView.baseTheme({
      ".cm-sefaria-suggest": { display: "flex", gap: "6px", alignItems: "center", padding: "4px 8px", fontSize: "0.9em" },
      ".cm-sefaria-suggest button": { cursor: "pointer" },
    }),
  ];
}
