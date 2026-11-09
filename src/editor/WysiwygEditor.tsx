
import { useEffect, useRef } from "react";
import {
  Editor as MilkdownEditor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  prosePluginsCtx,
} from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { history } from "@milkdown/plugin-history";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { clipboard } from "@milkdown/plugin-clipboard";
import { math } from "@milkdown/plugin-math";
import { slashFactory, SlashProvider } from "@milkdown/plugin-slash";
import { tooltipFactory, TooltipProvider } from "@milkdown/plugin-tooltip";
import type { EditorView } from "@milkdown/prose/view";
import { Plugin } from "@milkdown/prose/state";
import { wysiwygBidiPlugin } from "./wysiwygBidi";
import { dragHandlePlugin } from "./dragHandles";
import { buildIndentKeymap } from "./keymapExtra";
import "katex/dist/katex.css";
import { log } from "../lib/logger";
import { getMarkdown } from "@milkdown/utils";
import {
  configureWysiwygSuggest,
  encodeCriticForWysiwyg,
  registerWysiwygView,
  unregisterWysiwygView,
  wysiwygSuggestPlugins,
} from "./wysiwygSuggest";
import { registerPendingEdits, useAppStore } from "../store/useStore";
import { useAuth } from "../auth/useAuth";
import { buildSlashMenu, buildTooltip } from "./wysiwygMenus";
import type { SlashMenuRoot } from "./wysiwygMenus";

// Suggesting mode (track changes) works in WYSIWYG too: CriticMarkup ↔
// marks, edits tracked while the store's suggestingMode is on.
configureWysiwygSuggest({
  enabled: () => useAppStore.getState().suggestingMode,
  author: () => {
    const user = useAuth.getState().user;
    return user?.name?.trim() || user?.email?.split("@")[0] || null;
  },
});

interface Props {
  value: string;
  onChange: (next: string) => void;
}

const slash = slashFactory("wysiwyg-slash");
const tooltip = tooltipFactory("wysiwyg-tooltip");

/**
 * WYSIWYG editor powered by Milkdown (ProseMirror under the hood).
 * Recreates on external `value` changes (file open). Internal edits stream out
 * via the listener plugin.
 *
 * Includes math (KaTeX), a `/` slash command menu, and a selection tooltip
 * for inline formatting.
 */
/**
 * Split a leading YAML frontmatter block off a markdown document. Milkdown
 * has no frontmatter concept — fed raw, `---\ntitle: …\n---` renders as a
 * thematic break + loose text (ugly, and editing it corrupts the metadata).
 * We keep the block verbatim and re-prepend it on every emission, so the
 * metadata survives WYSIWYG editing invisibly.
 */
export function splitFrontmatter(md: string): { fm: string; body: string } {
  const m = md.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: "", body: md };
  return { fm: m[0], body: md.slice(m[0].length) };
}

export default function WysiwygEditor({ value, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MilkdownEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEmittedRef = useRef<string>(value);
  // Leading YAML frontmatter of the current document — hidden from Milkdown,
  // re-attached to every onChange so it is preserved, not destroyed.
  const frontmatterRef = useRef<string>("");

  // DOM elements + view ref reused across editor recreations.
  const slashElRef = useRef<HTMLDivElement | null>(null);
  const tooltipElRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const getView = () => viewRef.current;

  // ── Lifecycle sequencing ─────────────────────────────────────────
  // Milkdown's `create()` and `destroy()` are both async, and
  // `destroy()` called while another `destroy()` is in flight resolves
  // immediately (status OnDestroy) — so naive "destroy then create"
  // effects let two editors mount into the same host at once (rapid
  // mode switches, StrictMode's mount→unmount→remount, or a value
  // change landing while the previous rebuild is still awaiting).
  //
  // Every lifecycle operation is therefore appended to ONE promise
  // chain per component instance, and each build carries a generation
  // number. A build whose generation has been superseded by the time it
  // runs (or by the time its `create()` resolves) is skipped / torn down,
  // and unmount bumps the generation and queues the final teardown
  // behind any in-flight build. Net effect: at most one editor is ever
  // alive, and destroy never overlaps create.
  const lifecycleRef = useRef<Promise<void>>(Promise.resolve());
  const genRef = useRef(0);
  const enqueue = (op: () => Promise<void>) => {
    lifecycleRef.current = lifecycleRef.current
      .then(op)
      .catch((e) => log.warn("[wysiwyg] lifecycle op threw", e));
  };
  // The editor's markdown as of its creation / last emission: on unmount,
  // anything else is an edit the debounced listener hasn't emitted yet.
  const serializedRef = useRef<string | null>(null);
  // This instance's view as registered for the palette's commands; another
  // instance (Focus Mode over the main editor) may be registered too, so
  // only this one is unregistered.
  const registeredViewRef = useRef<EditorView | null>(null);
  // Emit, synchronously, an edit the debounced listener hasn't emitted yet.
  const flushPending = () => {
    const ed = editorRef.current;
    if (!ed || serializedRef.current === null) return;
    let md: string;
    try {
      md = ed.action(getMarkdown());
    } catch {
      return; // editor already torn down
    }
    if (md === serializedRef.current) return;
    serializedRef.current = md;
    const full = frontmatterRef.current + md;
    if (full !== lastEmittedRef.current) {
      lastEmittedRef.current = full;
      onChangeRef.current(full);
    }
  };
  // Switching or closing the active tab inside the debounce window: the
  // `[value]` rebuild below would drop the edit (its generation guard), and
  // by then `onChange` already writes the NEW active document. The store
  // calls this before it switches, while the edit's own document is active.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => registerPendingEdits(flushPending), []);
  // Milkdown's listener debounces by 200 ms and can't be cancelled; its
  // timer serializes the document, which throws once the editor is gone.
  // When an emission is still pending, destroy only after it has run (its
  // output is ignored by the generation guard).
  const pendingSinceRef = useRef(0);
  const destroyCurrent = async () => {
    const ed = editorRef.current;
    editorRef.current = null;
    serializedRef.current = null;
    if (registeredViewRef.current) unregisterWysiwygView(registeredViewRef.current);
    registeredViewRef.current = null;
    if (!ed) return;
    const pending = Date.now() - pendingSinceRef.current;
    if (pending < 260) await new Promise((r) => setTimeout(r, 260 - pending));
    try {
      await ed.destroy(true);
    } catch {
      /* why: the editor may already be torn down by an earlier unmount */
    }
  };

  useEffect(() => {
    if (!hostRef.current) return;
    // Skip rebuild when the editor already exists and content matches —
    // this short-circuits the typical "user typed, parent re-rendered"
    // round-trip.
    if (editorRef.current && lastEmittedRef.current === value) return;
    const gen = ++genRef.current;
    const host = hostRef.current;

    enqueue(async () => {
      if (gen !== genRef.current) return; // superseded before it started
      await destroyCurrent();
      if (gen !== genRef.current) return;
      host.replaceChildren();

      // Create floating menu DOMs lazily and reuse them.
      if (!slashElRef.current) slashElRef.current = buildSlashMenu(getView);
      if (!tooltipElRef.current) tooltipElRef.current = buildTooltip(getView);

      // Hide YAML frontmatter from the WYSIWYG surface; it is re-attached on
      // every emission below so external value/lastEmitted comparisons keep
      // operating on the full document.
      const { fm, body } = splitFrontmatter(value);
      frontmatterRef.current = fm;

      const editor = await MilkdownEditor.make()
        .config((ctx) => {
          ctx.set(rootCtx, host);
          ctx.set(defaultValueCtx, encodeCriticForWysiwyg(body));
          ctx.get(listenerCtx).markdownUpdated((_, md) => {
            // The listener plugin debounces emissions by 200ms and
            // nothing cancels that timer on destroy, so a torn-down (or
            // superseded) editor can still fire here. Forwarding it would
            // overwrite the store with stale content after a mode switch.
            if (gen !== genRef.current) return;
            if (md === serializedRef.current) return; // already flushed
            serializedRef.current = md;
            const full = frontmatterRef.current + md;
            lastEmittedRef.current = full;
            onChangeRef.current(full);
          });
          // γ.1 — drag-handles per top-level block. The plugin reads /
          // writes its own meta key and registers `Decoration.widget`s
          // on every block; the host's mousemove listener toggles
          // visibility of the handle for the hovered row.
          ctx.update(prosePluginsCtx, (plugins) => [
            ...plugins,
            dragHandlePlugin,
            // T25 — every block reads in the direction of its own text.
            wysiwygBidiPlugin(),
            new Plugin({
              appendTransaction: (trs) => {
                if (trs.some((t) => t.docChanged || t.storedMarksSet)) pendingSinceRef.current = Date.now();
                return null;
              },
            }),
            // γ.1.b — Tab / Shift-Tab indent / outdent inside lists.
            buildIndentKeymap(),
          ]);

          ctx.set(slash.key, {
            view: (view: EditorView) => {
              try {
                return buildSlashView(view);
              } catch (err) {
                // Last-resort guard: if Milkdown's SlashProvider
                // constructor throws (e.g. because the menu element was
                // detached during a re-mount before this callback fired),
                // contain the throw here. Returning a no-op view keeps
                // the plugin slot occupied so the editor finishes
                // setup; the cleanup pass will tear it down normally.
                log.warn("[wysiwyg] slash view threw, using no-op", err);
                return { update: () => {}, destroy: () => {} };
              }
            },
          });

          // Helper extracted for the try/catch above.
          function buildSlashView(view: EditorView) {
              const maybeMenu = slashElRef.current as SlashMenuRoot | null;
              // RACE GUARD — `MilkdownEditor.create()` is async, and this
              // view callback fires inside the ProseView constructor that
              // runs during that promise's resolution. If the value
              // effect's cleanup ran first (component unmount or value
              // change) and useEffect2's cleanupDom already nulled the
              // ref, `maybeMenu` is null here. Constructing
              // `new SlashProvider({ content: null })` would later throw
              // on its first debounced update (`appendChild` on null,
              // then `this.element.dataset` on null). A no-op view is
              // safe because the surrounding async block tears the
              // editor down right after via the `if (cancelled)` branch.
              if (!maybeMenu) {
                return { update: () => {}, destroy: () => {} };
              }
              // Reassign so inner function declarations capture the
              // narrowed (non-null) type.
              const menuEl: SlashMenuRoot = maybeMenu;
              viewRef.current = view;
              const provider = new SlashProvider({
                content: menuEl,
                debounce: 50,
                trigger: "/",
              });
              provider.update(view);

              // Live filter — read the text typed after the most recent
              // `/` and forward it into the menu so it shows only matching
              // items. Runs on every editor update.
              function syncQuery(v: EditorView) {
                const { $from } = v.state.selection;
                const text = $from.parent.textBetween(
                  0,
                  $from.parentOffset,
                  undefined,
                  "\u00A0",
                );
                const slashIdx = text.lastIndexOf("/");
                const q = slashIdx >= 0 ? text.slice(slashIdx + 1) : "";
                menuEl.setQuery(q);
              }
              syncQuery(view);

              // Keyboard navigation — only intercept while the menu is
              // visible (data-show="true"). Avoids stealing keys from the
              // editor when the slash menu is closed.
              const onKeyDown = (e: KeyboardEvent) => {
                if (menuEl.dataset.show !== "true") return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  menuEl.moveSelection(1);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  menuEl.moveSelection(-1);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  menuEl.runSelected();
                }
              };
              window.addEventListener("keydown", onKeyDown, { capture: true });

              return {
                update: (v: EditorView, prev: EditorView["state"]) => {
                  viewRef.current = v;
                  provider.update(v, prev);
                  syncQuery(v);
                },
                destroy: () => {
                  window.removeEventListener("keydown", onKeyDown, {
                    capture: true,
                  });
                  provider.destroy();
                  if (viewRef.current === view) viewRef.current = null;
                },
              };
          }

          ctx.set(tooltip.key, {
            view: (view: EditorView) => {
              try {
                return buildTooltipView(view);
              } catch (err) {
                // Same containment as slash view above.
                log.warn("[wysiwyg] tooltip view threw, using no-op", err);
                return { update: () => {}, destroy: () => {} };
              }
            },
          });

          function buildTooltipView(view: EditorView) {
              const tooltipEl = tooltipElRef.current;
              // Same race guard as the slash plugin above.
              if (!tooltipEl) {
                return { update: () => {}, destroy: () => {} };
              }
              viewRef.current = view;
              const provider = new TooltipProvider({
                content: tooltipEl,
                debounce: 50,
              });
              provider.update(view);
              return {
                update: (v: EditorView, prev: EditorView["state"]) => {
                  viewRef.current = v;
                  provider.update(v, prev);
                },
                destroy: () => {
                  provider.destroy();
                  if (viewRef.current === view) viewRef.current = null;
                },
              };
          }
        })
        // First, so suggestion marks wrap other marks (`{++**b**++}`).
        .use(wysiwygSuggestPlugins)
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(listener)
        .use(clipboard)
        .use(math)
        .use(slash)
        .use(tooltip)
        .create();

      if (gen !== genRef.current) {
        // Superseded (unmount or newer value) while create() was pending.
        // The queue guarantees nothing else touched the host meanwhile.
        try {
          await editor.destroy(true);
        } catch {
          /* why: the editor may already be torn down by an earlier unmount */
        }
        return;
      }
      editorRef.current = editor;
      lastEmittedRef.current = value;
      registeredViewRef.current = editor.action((ctx) => ctx.get(editorViewCtx));
      registerWysiwygView(registeredViewRef.current);
      serializedRef.current = editor.action(getMarkdown());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Final teardown — queued behind any in-flight build so the floating
  // menu DOM is only removed once no plugin view can still reference it.
  useEffect(() => {
    return () => {
      // Leaving WYSIWYG (mode switch): the listener debounces emissions
      // by 200 ms, so the last edits would be dropped by the generation
      // guard below. Flush them now, synchronously.
      flushPending();
      genRef.current++;
      enqueue(async () => {
        await destroyCurrent();
        slashElRef.current?.remove();
        slashElRef.current = null;
        tooltipElRef.current?.remove();
        tooltipElRef.current = null;
        viewRef.current = null;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="wysiwyg-host h-full overflow-y-auto">
      <div ref={hostRef} className="prose-lumen wysiwyg-root" />
    </div>
  );
}
