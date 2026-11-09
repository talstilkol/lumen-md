/**
 * App's full-screen and modal overlays: graph view, canvas, the settings
 * and gallery dialogs, version history, the table editor, the AI button,
 * keyboard shortcuts, the onboarding tour and runtime metrics. The heavy
 * ones load lazily. Moved out of App.tsx unchanged (plan 12.1); App owns
 * the open/closed state and passes it in.
 */
import { lazy, Suspense } from "react";
import type { Command } from "./CommandPalette";
import { AiFab } from "./AiFab";
import { RuntimeMetricsPanel } from "./RuntimeMetricsPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { OnboardingTour } from "./OnboardingTour";
import { auditScope } from "./auditScope";
import { historyKey } from "../storage/history";
import type { DocFile } from "../store/useStore";
import { t } from "../i18n";
const GraphView = lazy(() => import("./GraphView").then(m => ({ default: m.GraphView })));
// γ.2 — Canvas now backed by tldraw. The legacy custom-canvas component
// `CanvasWhiteboard.tsx` remains in tree as a fallback in case we ever
// need to surface old `.canvas.json` files; it's intentionally unused.
const CanvasWhiteboard = lazy(() => import("./CanvasTldraw").then(m => ({ default: m.CanvasTldraw })));
const PluginGallery = lazy(() => import("./PluginGallery").then(m => ({ default: m.PluginGallery })));
const TemplateGallery = lazy(() => import("./TemplateGallery").then(m => ({ default: m.TemplateGallery })));
const AuditLog = lazy(() => import("./AuditLog").then(m => ({ default: m.AuditLog })));
const OrgSettings = lazy(() => import("./OrgSettings").then(m => ({ default: m.OrgSettings })));
const TrustedKeysSettings = lazy(() => import("./TrustedKeysSettings").then(m => ({ default: m.TrustedKeysSettings })));
const ThemeSettings = lazy(() => import("./ThemeSettings").then(m => ({ default: m.ThemeSettings })));
const AiSettingsPanel = lazy(() => import("./AiSettingsPanel").then(m => ({ default: m.AiSettingsPanel })));
const PrivacyLedgerPanel = lazy(() => import("./PrivacyLedgerPanel").then(m => ({ default: m.PrivacyLedgerPanel })));
const TrashPanel = lazy(() => import("./TrashPanel").then(m => ({ default: m.TrashPanel })));
const AiDoctorPanel = lazy(() => import("./AiDoctorPanel").then(m => ({ default: m.AiDoctorPanel })));
const FineTuneSettings = lazy(() => import("./FineTuneSettings").then(m => ({ default: m.FineTuneSettings })));
const VersionHistory = lazy(() => import("./VersionHistory").then(m => ({ default: m.VersionHistory })));
const MarkdownTableEditor = lazy(() => import("./MarkdownTableEditor").then(m => ({ default: m.MarkdownTableEditor })));

export interface AppOverlaysProps {
  graphOpen: boolean;
  canvasOpen: boolean;
  galleryOpen: boolean;
  templateGalleryOpen: boolean;
  auditLogOpen: boolean;
  fineTuneOpen: boolean;
  orgSettingsOpen: boolean;
  trustedKeysOpen: boolean;
  aiSettingsOpen: boolean;
  aiDoctorOpen: boolean;
  privacyOpen: boolean;
  trashOpen: boolean;
  themeSettingsOpen: boolean;
  historyOpen: boolean;
  tableEditorOpen: boolean;
  shortcutsOpen: boolean;
  tourOpen: boolean;
  runtimeMetricsOpen: boolean;
  setGraphOpen: (open: boolean) => void;
  setCanvasOpen: (open: boolean) => void;
  setGalleryOpen: (open: boolean) => void;
  setTemplateGalleryOpen: (open: boolean) => void;
  setAuditLogOpen: (open: boolean) => void;
  setFineTuneOpen: (open: boolean) => void;
  setOrgSettingsOpen: (open: boolean) => void;
  setTrustedKeysOpen: (open: boolean) => void;
  setAiSettingsOpen: (open: boolean) => void;
  setAiDoctorOpen: (open: boolean) => void;
  setPrivacyOpen: (open: boolean) => void;
  setTrashOpen: (open: boolean) => void;
  setThemeSettingsOpen: (open: boolean) => void;
  setHistoryOpen: (open: boolean) => void;
  setTableEditorOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setTourOpen: (open: boolean) => void;
  setRuntimeMetricsOpen: (open: boolean) => void;
  doc: DocFile;
  setDoc: (d: Partial<DocFile>) => void;
  setContent: (s: string) => void;
  authUserId: string | undefined;
  authOrgId: string | undefined;
  commands: Command[];
}

export function AppOverlays({
  graphOpen,
  canvasOpen,
  galleryOpen,
  templateGalleryOpen,
  auditLogOpen,
  fineTuneOpen,
  orgSettingsOpen,
  trustedKeysOpen,
  aiSettingsOpen,
  aiDoctorOpen,
  privacyOpen,
  trashOpen,
  themeSettingsOpen,
  historyOpen,
  tableEditorOpen,
  shortcutsOpen,
  tourOpen,
  runtimeMetricsOpen,
  setGraphOpen,
  setCanvasOpen,
  setGalleryOpen,
  setTemplateGalleryOpen,
  setAuditLogOpen,
  setFineTuneOpen,
  setOrgSettingsOpen,
  setTrustedKeysOpen,
  setAiSettingsOpen,
  setAiDoctorOpen,
  setPrivacyOpen,
  setTrashOpen,
  setThemeSettingsOpen,
  setHistoryOpen,
  setTableEditorOpen,
  setShortcutsOpen,
  setTourOpen,
  setRuntimeMetricsOpen,
  setDoc,
  doc,
  setContent,
  authUserId,
  authOrgId,
  commands,
}: AppOverlaysProps) {
  return (
    <>
      {/* Graph View overlay */}
      {graphOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "hsl(var(--bg))" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", borderBottom: "1px solid hsl(var(--border))" }}>
            <h3 style={{ margin: 0, fontSize: 14, color: "hsl(var(--fg))" }}>{t("graphView.title")}</h3>
            <button className="icon-btn" onClick={() => setGraphOpen(false)} style={{ width: "auto", padding: "4px 12px", fontSize: 12 }}>{t("dialog.cancel")}</button>
          </div>
          <div style={{ height: "calc(100vh - 42px)" }}>
            <Suspense fallback={<div style={{padding:'2rem',color:'hsl(var(--fg-muted))'}}>{t("loading.generic")}</div>}>
              <ErrorBoundary fallback={
                <div style={{ padding: "3rem", textAlign: "center", color: "hsl(0 80% 60%)" }}>
                  <strong>{t("graphView.renderFailed")}</strong>
                  <p>{t("graphView.renderFailedDetail")}</p>
                </div>
              }>
                <GraphView onOpenFile={(path, content) => {
                  setDoc({ name: path.split("/").pop() ?? path, content, handle: undefined, workspaceName: path, dirty: false });
                  setGraphOpen(false);
                }} />
              </ErrorBoundary>
            </Suspense>
          </div>
        </div>
      )}

      {/* Canvas Whiteboard overlay */}
      <Suspense fallback={null}>
        <ErrorBoundary fallback={<div style={{ padding: '2rem', color: 'hsl(0 80% 60%)' }}>{t("errorBoundary.heading")}</div>}>
          {canvasOpen && <CanvasWhiteboard open={canvasOpen} onClose={() => setCanvasOpen(false)} />}
          {galleryOpen && <PluginGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} />}
          {templateGalleryOpen && <TemplateGallery open={templateGalleryOpen} onClose={() => setTemplateGalleryOpen(false)} />}
          {auditLogOpen && <AuditLog
            open={auditLogOpen}
            onClose={() => setAuditLogOpen(false)}
            // Scope = the signed-in user's organization (WorkOS SSO); free /
            // pro users have no org, so their own id is the scope.
            orgId={auditScope({ id: authUserId ?? "", orgId: authOrgId }) || "personal"}
          />}
          {fineTuneOpen && <FineTuneSettings open={fineTuneOpen} onClose={() => setFineTuneOpen(false)} />}
          {orgSettingsOpen && <OrgSettings open={orgSettingsOpen} onClose={() => setOrgSettingsOpen(false)} onOpenAuditLog={() => setAuditLogOpen(true)} />}
          {trustedKeysOpen && <TrustedKeysSettings open={trustedKeysOpen} onClose={() => setTrustedKeysOpen(false)} />}
          {aiSettingsOpen && <AiSettingsPanel open={aiSettingsOpen} onClose={() => setAiSettingsOpen(false)} />}
          {aiDoctorOpen && <AiDoctorPanel open={aiDoctorOpen} onClose={() => setAiDoctorOpen(false)} />}
          {privacyOpen && <PrivacyLedgerPanel open={privacyOpen} onClose={() => setPrivacyOpen(false)} />}
          {trashOpen && <TrashPanel open={trashOpen} onClose={() => setTrashOpen(false)} />}
          {themeSettingsOpen && <ThemeSettings open={themeSettingsOpen} onClose={() => setThemeSettingsOpen(false)} />}
        </ErrorBoundary>
      </Suspense>

      {/* Version History overlay */}
      {historyOpen && (
        <Suspense fallback={<div style={{padding:'2rem',color:'hsl(var(--fg-muted))'}}>{t("loading.generic")}</div>}>
          <ErrorBoundary fallback={<div style={{ padding: '2rem', color: 'hsl(0 80% 60%)' }}>{t("errorBoundary.heading")}</div>}>
            <VersionHistory
              fileName={historyKey(doc)}
              currentContent={doc.content}
              onRestore={(content) => setContent(content)}
              onClose={() => setHistoryOpen(false)}
            />
          </ErrorBoundary>
        </Suspense>
      )}

      {/* Table Editor overlay */}
      {tableEditorOpen && (
        <Suspense fallback={null}>
          <ErrorBoundary fallback={<div style={{ padding: '2rem', color: 'hsl(0 80% 60%)' }}>{t("errorBoundary.heading")}</div>}>
            <MarkdownTableEditor
              onUpdate={(md) => {
                const current = doc.content;
                setContent(current + "\n\n" + md + "\n");
              }}
              onClose={() => setTableEditorOpen(false)}
            />
          </ErrorBoundary>
        </Suspense>
      )}

      {/* Floating AI Prompts button — anchored next to the document body. */}
      <AiFab commands={commands} />

      {/* Keyboard Shortcuts Overlay */}
      <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Onboarding Tour */}
      <OnboardingTour
        open={tourOpen}
        onClose={() => {
          setTourOpen(false);
          try { localStorage.setItem("lumen-tour-done", "1"); } catch {
            /* why: storage denied — tour will simply replay next session */
          }
        }}
        actions={[
          {
            id: "runtimeMetrics.open",
            label: t("tour.action.openRuntimeMetrics"),
            onRun: () => {
              setRuntimeMetricsOpen(true);
              setTourOpen(false);
            },
          },
        ]}
      />
      {runtimeMetricsOpen && (
        <RuntimeMetricsPanel onClose={() => setRuntimeMetricsOpen(false)} />
      )}
    </>
  );
}
