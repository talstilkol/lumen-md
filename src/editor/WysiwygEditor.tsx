import { useEffect, useRef } from "react";
import { Editor as MilkdownEditor, rootCtx, defaultValueCtx, editorViewCtx, prosePluginsCtx, remarkStringifyOptionsCtx } from "@milkdown/core";
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
import { frontmatterDir } from "../lib/paragraphDirection";
import { wysiwygAiAuthorshipPlugin } from "./wysiwygAiAuthorship";
import { saveWysiwygAiSpans } from "./wysiwygAiSave";
import { restoreWysiwygAiSpans } from "./wysiwygAiRestore";
import { remoteImagePlugin } from "./remoteImageView";
import { wysiwygBidiMarksPlugin } from "./wysiwygBidiMarks";
import { listSpreadFix } from "./milkdownListSpread";
import { dragHandlePlugin } from "./dragHandles";
import { buildIndentKeymap } from "./keymapExtra";
import { wysiwygOutlineKeymap, wysiwygOutlinePlugin } from "./wysiwygOutline";
import { buildTooltip } from "./wysiwygTooltip";
import "katex/dist/katex.css";
import { log } from "../lib/logger";
import { getMarkdown, insert as insertMarkdown, $prose } from "@milkdown/utils";
import { cleanPastedHtml, cleanPastedText, shouldConvertPaste } from "../paste/htmlPaste";
import { setWysiwygPasteTarget, type PasteDetail } from "../paste/pasteCommands";
import { wysiwygPdfPastePlugin } from "../paste/wysiwygPdfPaste";
import { wysiwygSourcePreserver } from "./wysiwygSource";
import { wysiwygObsidianPlugins } from "./wysiwygObsidian";
import { configureWysiwygSuggest, encodeCriticForWysiwyg, registerWysiwygView, unregisterWysiwygView, wysiwygSuggestPlugins } from "./wysiwygSuggest";
import { keepWikiLinks, protectEscapedWikiLinks } from "./wysiwygWikiLinks";
import { roundTripSafe } from "./markdownSerialize.mjs";
import type { Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import { wysiwygWikiComplete } from "./wysiwygWikiComplete";
import { registerPendingEdits, useAppStore } from "../store/useStore";
import { useAuth } from "../auth/useAuth";
import { type SlashMenuRoot, buildSlashMenu } from "./wysiwygSlashMenu";
import { splitFrontmatter } from "./wysiwygFrontmatter";
import { t } from "../i18n";
export { splitFrontmatter };

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
  /** The browser / OS spellchecker (plan 9.2 layer 1), as in the source editor. */
  spellCheck?: boolean;
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

export default function WysiwygEditor({ value, onChange, spellCheck = true }: Props) {
/** Word lists, Google Docs spans, inline styles and needless direction marks, cleaned on paste. */
const pasteCleanPlugin = $prose(
  () =>
    new Plugin({
      props: {
        transformPastedHTML: (html: string) => (shouldConvertPaste(html, "") ? cleanPastedHtml(html) : html),
        transformPastedText: (text: string) => cleanPastedText(text),
      },
    }),
);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const spellCheckRef = useRef(spellCheck);
  spellCheckRef.current = spellCheck;
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
  // Re-read the spellcheck attribute when the setting changes (attributes are evaluated on each view update).
  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(view.state.tr.setMeta("addToHistory", false));
  }, [spellCheck]);

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
  // W1.2 — maps each emission back onto the file as written, so unedited
  // blocks keep their exact source (see sourcePreserve.ts).
  const preserveRef = useRef<((md: string) => string) | null>(null);
  const restoreSource = (md: string) => {
    const p = preserveRef.current;
    if (!p) return md;
    try {
      return p(md);
    } catch (e) {
      log.warn("[wysiwyg] source-preserving save failed; writing the serialization", e);
      return md;
    }
  };
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
    const full = frontmatterRef.current + restoreSource(md);
    if (full !== lastEmittedRef.current) {
      saveWysiwygAiSpans(ed, lastEmittedRef.current, full, frontmatterRef.current, md);
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
    preserveRef.current = null;
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
          // An escaped `\[\[x]]` stays escaped (not a wiki link) on the way out.
          ctx.set(defaultValueCtx, encodeCriticForWysiwyg(protectEscapedWikiLinks(body)));
          // `[[Note]]` is written back as is, not as `\[\[Note]]`. And an
          // edited block keeps its meaning when it is saved through the AST:
          // nested emphasis stays emphasis (CommonMark 461/463), and an
          // indented HTML block after a list stays out of the list (#847).
          ctx.update(remarkStringifyOptionsCtx, (o: ToMarkdownOptions) => roundTripSafe(keepWikiLinks(o)));
          ctx.get(listenerCtx).markdownUpdated((_, md) => {
            // The listener plugin debounces emissions by 200ms and
            // nothing cancels that timer on destroy, so a torn-down (or
            // superseded) editor can still fire here. Forwarding it would
            // overwrite the store with stale content after a mode switch.
            if (gen !== genRef.current) return;
            if (md === serializedRef.current) return; // already flushed
            serializedRef.current = md;
            const full = frontmatterRef.current + restoreSource(md);
            // W10.E37: the AI ranges go into the note's saved spans, for the source view and the export.
            if (editorRef.current) saveWysiwygAiSpans(editorRef.current, lastEmittedRef.current, full, frontmatterRef.current, md);
            lastEmittedRef.current = full;
            onChangeRef.current(full);
          });
          // γ.1 — drag-handles per top-level block. The plugin reads /
          // writes its own meta key and registers `Decoration.widget`s
          // on every block; the host's mousemove listener toggles
          // visibility of the handle for the hovered row.
          ctx.update(prosePluginsCtx, (plugins) => [
            ...plugins,
            // 4.5 — `[[` completes notes, `#` headings, `^` blocks. First, so
            // Enter / Tab in its menu pick a link (not split or indent).
            wysiwygWikiComplete(),
            dragHandlePlugin,
            // T25 — every block reads in the direction of its own text.
            wysiwygBidiPlugin({ pinned: () => frontmatterDir(frontmatterRef.current) }),
            // 5.9 / W10.E37 — what an agent inserted is marked when it is inserted.
            wysiwygAiAuthorshipPlugin(),
            // Plan 2.2 — images from other sites wait for the user.
            remoteImagePlugin(),
            // 9.2 layer 1 — the browser / OS spellchecker, Hebrew included, no dictionary in the bundle.
            // W11.Q6 — the editable area has a name and a role for screen readers, like the source editor's (editor.ariaLabel).
            new Plugin({ props: { attributes: () => ({ spellcheck: spellCheckRef.current ? "true" : "false", role: "textbox", "aria-multiline": "true", "aria-label": t("editor.wysiwygAriaLabel") }) } }),
            // W5.4 — direction-control tags, the Trojan Source paste warning.
            wysiwygBidiMarksPlugin(),
            // W5.5 — "Looks reversed — fix?" after pasting Hebrew from a PDF.
            wysiwygPdfPastePlugin(),
            new Plugin({
              appendTransaction: (trs) => {
                if (trs.some((t) => t.docChanged || t.storedMarksSet)) pendingSinceRef.current = Date.now();
                return null;
              },
            }),
            // γ.1.b — Tab / Shift-Tab indent / outdent inside lists.
            buildIndentKeymap(),
            // W2.13 — outline mode: fold, zoom and block operations.
            wysiwygOutlineKeymap(),
            wysiwygOutlinePlugin(),
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
        // After both presets: their list schemas, without the spread check that broke every list.
        .use(listSpreadFix)
        // W1.3 — ==highlights==, callouts and %%comments%%.
        .use(wysiwygObsidianPlugins)
        // W1.4 — clipboard HTML cleaned before ProseMirror parses it.
        .use(pasteCleanPlugin)
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
      // W10.E37: the note's saved AI spans (source view, AI commands, the last emission) drawn here too.
      restoreWysiwygAiSpans(editor, value, fm, (md) => encodeCriticForWysiwyg(protectEscapedWikiLinks(md)));
      serializedRef.current = editor.action(getMarkdown());
      try {
        preserveRef.current = wysiwygSourcePreserver(body, serializedRef.current).restore;
      } catch (e) {
        log.warn("[wysiwyg] could not map the source; saves will use the serialization", e);
        preserveRef.current = null;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // W1.4 — "Paste as plain text" / "Paste with formatting" from the palette.
  useEffect(() => {
    setWysiwygPasteTarget(true);
    const onPaste = (e: Event) => {
      const ed = editorRef.current;
      const detail = (e as CustomEvent<PasteDetail>).detail;
      if (!ed || !detail) return;
      try {
        if (detail.mode === "plain") {
          ed.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            view.dispatch(view.state.tr.insertText(detail.text));
            view.focus();
          });
        } else ed.action(insertMarkdown(detail.markdown));
      } catch (err) {
        log.warn("[wysiwyg] paste command failed", err);
      }
    };
    window.addEventListener("lumen-paste", onPaste);
    return () => {
      setWysiwygPasteTarget(false);
      window.removeEventListener("lumen-paste", onPaste);
    };
  }, []);

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
