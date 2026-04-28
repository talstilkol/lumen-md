/**
 * AppOverlays — All modal/overlay components extracted from App.tsx.
 *
 * Renders: Graph View, Canvas Whiteboard, Plugin Gallery, Version History,
 * Table Editor, Keyboard Shortcuts, Onboarding Tour, Focus Mode.
 */
import { lazy, Suspense, useDeferredValue } from "react";
import type { EditorHandle } from "../editor/Editor";
import type { CollabSession } from "../collab/yjs";
import { EditorLayout } from "../layouts/EditorLayout";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { useAppStore } from "../store/useStore";

const GraphView = lazy(() => import("../ui/GraphView").then(m => ({ default: m.GraphView })));
const CanvasWhiteboard = lazy(() => import("../ui/CanvasWhiteboard").then(m => ({ default: m.CanvasWhiteboard })));
const PluginGallery = lazy(() => import("../ui/PluginGallery").then(m => ({ default: m.PluginGallery })));
const VersionHistory = lazy(() => import("../ui/VersionHistory").then(m => ({ default: m.VersionHistory })));
const MarkdownTableEditor = lazy(() => import("../ui/MarkdownTableEditor").then(m => ({ default: m.MarkdownTableEditor })));

interface OverlayState {
  graphOpen: boolean;
  setGraphOpen: (v: boolean) => void;
  historyOpen: boolean;
  setHistoryOpen: (v: boolean) => void;
  tableEditorOpen: boolean;
  setTableEditorOpen: (v: boolean) => void;
  canvasOpen: boolean;
  setCanvasOpen: (v: boolean) => void;
  galleryOpen: boolean;
  setGalleryOpen: (v: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean) => void;
  tourOpen: boolean;
  setTourOpen: (v: boolean) => void;
  focusMode: boolean;
  setFocusMode: (v: boolean) => void;
}

interface Props extends OverlayState {
  editorRef: React.RefObject<EditorHandle | null>;
  collab: CollabSession | null;
  setContent: (s: string) => void;
  handleAddAsset: (file: File) => Promise<string | null>;
}

// Lazy sub-components
import { KeyboardShortcuts } from "../ui/KeyboardShortcuts";
import { FocusMode } from "../ui/FocusMode";
import { OnboardingTour } from "../ui/OnboardingTour";

export function AppOverlays({
  graphOpen, setGraphOpen,
  historyOpen, setHistoryOpen,
  tableEditorOpen, setTableEditorOpen,
  canvasOpen, setCanvasOpen,
  galleryOpen, setGalleryOpen,
  shortcutsOpen, setShortcutsOpen,
  tourOpen, setTourOpen,
  focusMode, setFocusMode,
  editorRef,
  collab,
  setContent,
  handleAddAsset,
}: Props) {
  const doc = useAppStore((s) => s.doc);
  const setDoc = useAppStore((s) => s.setDoc);
  const mode = useAppStore((s) => s.mode);
  const vimEnabled = useAppStore((s) => s.vimEnabled);
  const spellCheck = useAppStore((s) => s.spellCheck);
  const grammarCheck = useAppStore((s) => s.grammarCheck);
  const typewriterMode = useAppStore((s) => s.typewriterMode);
  const pageView = useAppStore((s) => s.pageView);
  const deferredContent = useDeferredValue(doc.content);
  const activeFile = doc.name;

  return (
    <>
      {/* Graph View overlay */}
      {graphOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "hsl(var(--bg))" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", borderBottom: "1px solid hsl(var(--border))" }}>
            <h3 style={{ margin: 0, fontSize: 14, color: "hsl(var(--fg))" }}>Knowledge Graph</h3>
            <button className="icon-btn" onClick={() => setGraphOpen(false)} style={{ width: "auto", padding: "4px 12px", fontSize: 12 }}>Close</button>
          </div>
          <div style={{ height: "calc(100vh - 42px)" }}>
            <Suspense fallback={<div style={{padding:'2rem',color:'hsl(var(--fg-muted))'}}>Loading graph…</div>}>
              <ErrorBoundary fallback={
                <div style={{ padding: "3rem", textAlign: "center", color: "hsl(0 80% 60%)" }}>
                  <strong>Graph Render Failed</strong>
                  <p>The workspace data resulted in an invalid node structure that crashed the renderer.</p>
                </div>
              }>
                <GraphView onOpenFile={(path: string, content: string) => {
                  setDoc({ name: path.split("/").pop() ?? path, content, handle: undefined, workspaceName: path, dirty: false });
                  setGraphOpen(false);
                }} />
              </ErrorBoundary>
            </Suspense>
          </div>
        </div>
      )}

      {/* Canvas Whiteboard + Plugin Gallery */}
      <Suspense fallback={null}>
        <ErrorBoundary fallback={<div style={{ padding: '2rem', color: 'hsl(0 80% 60%)' }}>Component failed to load.</div>}>
          <CanvasWhiteboard open={canvasOpen} onClose={() => setCanvasOpen(false)} />
          <PluginGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} />
        </ErrorBoundary>
      </Suspense>

      {/* Version History overlay */}
      {historyOpen && (
        <Suspense fallback={<div style={{padding:'2rem',color:'hsl(var(--fg-muted))'}}>Loading history…</div>}>
          <ErrorBoundary fallback={<div style={{ padding: '2rem', color: 'hsl(0 80% 60%)' }}>Version history failed to load.</div>}>
            <VersionHistory
              fileName={doc.name}
              currentContent={doc.content}
              onRestore={(content: string) => setContent(content)}
              onClose={() => setHistoryOpen(false)}
            />
          </ErrorBoundary>
        </Suspense>
      )}

      {/* Table Editor overlay */}
      {tableEditorOpen && (
        <Suspense fallback={null}>
          <ErrorBoundary fallback={<div style={{ padding: '2rem', color: 'hsl(0 80% 60%)' }}>Table editor failed to load.</div>}>
            <MarkdownTableEditor
              onUpdate={(md: string) => {
                const current = doc.content;
                setContent(current + "\n\n" + md + "\n");
              }}
              onClose={() => setTableEditorOpen(false)}
            />
          </ErrorBoundary>
        </Suspense>
      )}

      {/* Keyboard Shortcuts Overlay */}
      <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Onboarding Tour */}
      <OnboardingTour open={tourOpen} onClose={() => {
        setTourOpen(false);
        try { localStorage.setItem("lumen-tour-done", "1"); } catch {
          /* storage denied — tour will simply replay next session */
        }
      }} />

      {/* Focus Mode overlay */}
      {focusMode && (
        <FocusMode active={focusMode} onExit={() => setFocusMode(false)}>
          <EditorLayout
            mode={mode}
            docContent={doc.content}
            docName={doc.name}
            deferredContent={deferredContent}
            editorRef={editorRef}
            vimEnabled={vimEnabled}
            spellCheck={spellCheck}
            grammarCheck={grammarCheck}
            typewriterMode={typewriterMode}
            activeFile={activeFile}
            pageView={pageView}
            collab={collab}
            setContent={setContent}
            handleAddAsset={handleAddAsset}
          />
        </FocusMode>
      )}
    </>
  );
}
