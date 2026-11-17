/**
 * EditorLayout – split-pane editor/preview layout with sync scrolling.
 *
 * Extracted from App.tsx to isolate:
 *  - split-pane resize feel (50/50 by default)
 *  - deterministic ratio-based sync-scroll
 *  - editor and preview section refs
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { EditorHandle } from "../editor/Editor";

// The source editor drags the whole CodeMirror stack (~530KB gz). The page's
// LCP element is the PREVIEW text, which doesn't need it — so the editor
// hydrates lazily behind a layout-preserving skeleton and first paint stops
// paying for CodeMirror's execute.
const Editor = lazy(() =>
  import("../editor/Editor").then((m) => ({ default: m.Editor })),
);
import { Preview } from "../renderer/Preview";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { WritingGoalBanner } from "../ui/WritingGoalBanner";
import { useAppStore } from "../store/useStore";
import type { ViewMode, SplitAxis } from "../store/useStore";
import type { CollabSession } from "../collab/yjs";
import { t } from "../i18n";
import { tapToEditHandlers } from "../mobile/useMobileGestures";
import { forceWysiwyg, isWysiwygForced } from "../editor/wysiwygCeiling";
import { useWysiwygCeiling, WysiwygCeilingNotice, WysiwygCeilingWarning } from "../ui/WysiwygCeilingBanner";

const WysiwygEditor = lazy(() => import("../editor/WysiwygEditor"));
const PageView = lazy(() => import("../ui/PageView").then(m => ({ default: m.PageView })));

/**
 * Resolves the user's split-axis preference into a concrete orientation.
 *
 * - "auto": follow the viewport — vertical split on phones (≤640px), horizontal
 *   otherwise. The default; tracks resize events.
 * - "vertical": user's explicit choice, returned verbatim.
 * - "horizontal": honoured on wide viewports, but a ≤640px viewport still
 *   stacks — two side-by-side panes at phone width are unusable, and users
 *   expect narrowing the window to flow into the stacked layout.
 */
function useResolvedAxis(pref: SplitAxis): SplitAxis {
  const [narrow, setNarrow] = useState<boolean>(
    () => typeof window !== "undefined" && window.innerWidth <= 640,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setNarrow(window.innerWidth <= 640);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);
  if (pref === "vertical") return "vertical";
  return narrow ? "vertical" : pref === "auto" ? "horizontal" : pref;
}

interface Props {
  mode: ViewMode;
  docContent: string;
  deferredContent: string;
  /** Document identity matching `deferredContent` (they lag together). */
  deferredDocKey?: string | null;
  editorRef: React.RefObject<EditorHandle | null>;
  vimEnabled: boolean;
  spellCheck: boolean;
  grammarCheck: boolean;
  typewriterMode: boolean;
  /** Suggesting mode (track changes) in the source editor. */
  suggestingMode?: boolean;
  activeFile: string | null;
  pageView: boolean;
  collab: CollabSession | null;
  setContent: (s: string) => void;
  handleAddAsset: (file: File) => Promise<string | null>;
}

export function EditorLayout({
  mode,
  docContent,
  deferredContent,
  deferredDocKey = null,
  editorRef,
  vimEnabled,
  spellCheck,
  grammarCheck,
  typewriterMode,
  suggestingMode = false,
  activeFile,
  pageView,
  collab,
  setContent,
  handleAddAsset,
}: Props) {
  // W11.Q4: a note over the WYSIWYG ceiling opens in the source editor with
  // a notice; "Open in WYSIWYG anyway" is remembered for that note this session.
  const ceiling = useWysiwygCeiling(mode, activeFile, docContent);
  const [, setForcedTick] = useState(0);
  const sourceInstead = mode === "wysiwyg" && ceiling.tooLarge && !isWysiwygForced(activeFile);
  const setForced = (on: boolean) => {
    forceWysiwyg(activeFile, on);
    setForcedTick((n) => n + 1);
  };
  const showEditor = mode === "source" || mode === "split" || sourceInstead;
  const showPreview = mode === "preview" || mode === "split";
  const showWysiwyg = mode === "wysiwyg" && !sourceInstead;

  // Resolve the split axis. "auto" picks horizontal on wide viewports and
  // vertical on phones; explicit "horizontal"/"vertical" lock the layout.
  const splitAxisPref = useAppStore((s) => s.splitAxis);
  const resolvedAxis: SplitAxis = useResolvedAxis(splitAxisPref);
  const isVerticalSplit = mode === "split" && resolvedAxis === "vertical";

  // Forward the latest doc content to CM6. The Editor's internal sync
  // effect bails when the incoming value already equals the editor's
  // current state, so passing this on every keystroke is a no-op for the
  // textarea itself.
  //
  // ADR-001 — DO NOT memoize live store values without including them
  // in the dependency array. The previous `useMemo(() => docContent,
  // [docName, mode])` was a real P0 bug: when the welcome doc was seeded
  // asynchronously after first mount (docName/mode unchanged), the memo
  // stayed pinned to the empty initial value and the editor rendered
  // blank forever. If you ever feel tempted to memoize this kind of
  // hand-off prop "for performance", trust the child's equality check
  // instead.
  const editorInitial = docContent;
  // Phones (W1.25): a tap on reading view edits at that line.
  const docContentRef = useRef(docContent);
  docContentRef.current = docContent;
  const [tapToEdit] = useState(() => tapToEditHandlers(() => docContentRef.current));

  // ── Scroll sync in line space (plan W13.R7) ───────────────────
  // The editor's top line and the preview's blocks (their `data-sl` source
  // lines from the render worker) meet in one line space, so the same
  // text is at the top of both panes to within a line, however differently
  // each renders it (src/reading/scrollSync.ts, scrollLink.ts). The preview
  // also marks the block that holds the caret.
  const editorSectionRef = useRef<HTMLElement | null>(null);
  const previewSectionRef = useRef<HTMLElement | null>(null);

  // Subscribed (not getState()-once) so flipping "Scroll: Linked" applies
  // immediately, and the axis flip (side-by-side ⇄ stacked on narrow
  // viewports) re-binds the listeners against the new pane geometry.
  const syncScroll = useAppStore((s) => s.syncScroll);

  useEffect(() => {
    if (mode !== "split") return;
    if (syncScroll === "single") return;
    let unlink: (() => void) | null = null;
    let disposed = false;
    // Wait for BOTH panes to mount (the editor and the preview are lazy);
    // bounded, gives up after ~8s.
    let pollTries = 0;
    const timer = setInterval(() => {
      const editorEl = editorSectionRef.current?.querySelector(".cm-scroller") as HTMLElement | null;
      const previewEl = previewSectionRef.current?.querySelector("[data-preview-root]") as HTMLElement | null;
      if (!editorEl || !previewEl) {
        if (++pollTries > 80) clearInterval(timer);
        return;
      }
      clearInterval(timer);
      void import("../reading/scrollLink").then(({ editorPane, previewPane, linkPanes }) => {
        if (disposed) return;
        const getView = () => editorRef.current?.getView() as unknown as import("../reading/scrollLink").EditorLike | null;
        const ed = editorPane(editorEl, getView);
        const pv = previewPane(previewEl, () => {
          const v = editorRef.current?.getView();
          return v ? v.state.doc.toString() : docContentRef.current;
        });
        const off = linkPanes(ed, pv, { followCaret: true });
        unlink = () => {
          off();
          pv.dispose?.();
        };
      });
    }, 100);
    return () => {
      disposed = true;
      clearInterval(timer);
      unlink?.();
    };
  }, [mode, syncScroll, isVerticalSplit]);

  // Ctrl+Alt+Shift+← / → : the focus to the column on that side (plan W13.R7; what is on
  // screen, so mirrored in RTL). Ctrl+Alt+← / → without Shift stay outline indent (W2.13).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.altKey || !e.shiftKey || e.metaKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      e.stopPropagation();
      const key = e.key;
      void import("../reading/readingColumns").then((m) => m.moveColumn(key));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div
      className={`flex-1 min-w-0 min-h-0 flex ${isVerticalSplit ? "flex-col" : "flex-row"}`}
      data-split-axis={isVerticalSplit ? "vertical" : "horizontal"}
    >
      {showEditor && (
        <section
          ref={editorSectionRef}
          className={
            mode === "split"
              ? isVerticalSplit
                ? "w-full h-1/2 min-h-0 border-b border-border bg-bg flex flex-col"
                : "w-1/2 min-w-0 h-full min-h-0 border-e border-border bg-bg flex flex-col"
              : "w-full min-w-0 h-full min-h-0 bg-bg flex flex-col"
          }
        >
          {sourceInstead && <WysiwygCeilingNotice verdict={ceiling} onOpenAnyway={() => setForced(true)} />}
          <WritingGoalBanner />
          {/* Layout-preserving fallback: the pane keeps its flex size while
              CodeMirror hydrates, so the lazy mount causes no CLS. */}
          <Suspense fallback={<div className="flex-1 min-h-0" aria-hidden />}>
            <Editor
              key={collab ? `collab:${collab.roomName}` : "local"}
              ref={editorRef as React.Ref<EditorHandle>}
              value={editorInitial}
              onChange={setContent}
              onAddAsset={handleAddAsset}
              vimEnabled={vimEnabled}
              spellCheck={spellCheck}
              grammarCheck={grammarCheck}
              typewriterMode={typewriterMode}
              suggesting={suggestingMode}
              collab={collab}
            />
          </Suspense>
        </section>
      )}
      {showPreview && (
        <section
          ref={previewSectionRef}
          onPointerDown={mode === "preview" ? tapToEdit.onPointerDown : undefined}
          onPointerUp={mode === "preview" ? tapToEdit.onPointerUp : undefined}
          className={
            mode === "split"
              ? isVerticalSplit
                ? "w-full h-1/2 min-h-0 bg-bg-subtle flex flex-col"
                : "w-1/2 min-w-0 h-full min-h-0 bg-bg-subtle flex flex-col"
              : "w-full min-w-0 h-full min-h-0 bg-bg-subtle flex flex-col"
          }
        >
          {pageView ? (
            <Suspense fallback={<div style={{padding:'2rem',color:'hsl(var(--fg-muted))'}}>{t("editor.loadingPageView")}</div>}>
              <PageView markdownText={deferredContent} docKey={deferredDocKey} />
            </Suspense>
          ) : (
            <Preview markdownText={deferredContent} docKey={deferredDocKey} onSourceEdit={setContent} />
          )}
        </section>
      )}
      {showWysiwyg && (
        <section className="w-full min-w-0 bg-bg">
          {ceiling.tooLarge && <WysiwygCeilingWarning onBack={() => setForced(false)} />}
          <Suspense
            fallback={
              <div
                style={{
                  padding: "2rem",
                  color: "hsl(var(--fg-muted))",
                  fontSize: 13,
                }}
              >
                {t("editor.loadingWysiwyg")}
              </div>
            }
          >
            <ErrorBoundary fallback={
              <div style={{ padding: "2rem", color: "hsl(var(--danger))" }}>
                <strong>{t("editor.wysiwygFailed")}</strong>
                <p style={{ fontSize: 12, opacity: 0.8 }}>{t("editor.wysiwygFailedHint")}</p>
              </div>
            }>
              <WysiwygEditor value={docContent} onChange={setContent} spellCheck={spellCheck} />
            </ErrorBoundary>
          </Suspense>
        </section>
      )}
    </div>
  );
}
