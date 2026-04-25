import { useState, useRef, useEffect } from "react";
import {
  FileText,
  FolderOpen,
  Save,
  Sun,
  Moon,
  PanelRightOpen,
  PanelRightClose,
  Columns2,
  Eye,
  Pencil,
  Sparkles,
  Command as CommandIcon,
  Menu,
  ChevronDown,
  Type,
} from "lucide-react";
import { useAppStore } from "../store/useStore";
import type { ViewMode, Theme } from "../store/useStore";
import { cn } from "../lib/utils";
import { t } from "../i18n";

interface Props {
  onOpen: () => void;
  onSave: (saveAs?: boolean) => void;
  onNew: () => void;
  onCommandPalette: () => void;
}

const MODES: { value: ViewMode; icon: typeof Pencil; labelKey: string; shortcut: string }[] = [
  { value: "source", icon: Pencil, labelKey: "mode.source", shortcut: "⌘1" },
  { value: "split", icon: Columns2, labelKey: "mode.split", shortcut: "⌘2" },
  { value: "preview", icon: Eye, labelKey: "mode.preview", shortcut: "⌘3" },
  { value: "wysiwyg", icon: Sparkles, labelKey: "mode.wysiwyg", shortcut: "⌘4" },
];

/* Labeled icon button for the toolbar */
function LabeledBtn({
  icon: Icon,
  label,
  title,
  onClick,
  active,
}: {
  icon: typeof Pencil;
  label: string;
  title?: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      className={cn("icon-btn", active && "active")}
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      style={{
        flexDirection: "column",
        gap: 1,
        padding: "4px 8px",
        minWidth: 44,
        height: "auto",
      }}
    >
      <Icon size={14} />
      <span style={{ fontSize: 9, opacity: 0.7, lineHeight: 1 }}>{label}</span>
    </button>
  );
}

export function Toolbar({ onOpen, onSave, onNew, onCommandPalette }: Props) {
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const setTheme = useAppStore((s) => s.setTheme);
  const showOutline = useAppStore((s) => s.showOutline);
  const toggleOutline = useAppStore((s) => s.toggleOutline);
  const showWorkspace = useAppStore((s) => s.showWorkspace);
  const toggleWorkspace = useAppStore((s) => s.toggleWorkspace);
  const doc = useAppStore((s) => s.doc);
  const rtl = useAppStore((s) => s.rtl);
  const toggleRtl = useAppStore((s) => s.toggleRtl);

  const isDark = document.documentElement.classList.contains("dark");

  // View dropdown
  const [viewOpen, setViewOpen] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!viewOpen) return;
    function close(e: MouseEvent) {
      if (viewRef.current && !viewRef.current.contains(e.target as Node)) {
        setViewOpen(false);
      }
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [viewOpen]);

  const currentMode = MODES.find((m) => m.value === mode) ?? MODES[0];

  return (
    <header className="titlebar">
      {/* ─── Left: Logo + Settings ─── */}
      <button
        className="icon-btn"
        onClick={onCommandPalette}
        title={`${t("toolbar.settings")} (⌘K)`}
        aria-label={t("toolbar.settings")}
        style={{ gap: 6, padding: "0 10px", width: "auto" }}
      >
        <div
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: "linear-gradient(135deg,#7c5cff 0%,#22d3ee 100%)",
            color: "white",
            fontWeight: 700,
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 6px hsl(252 92% 50% / 0.3)",
            flexShrink: 0,
          }}
        >
          L
        </div>
        <span style={{ fontSize: 11, color: "hsl(var(--fg-muted))", whiteSpace: "nowrap" }}>
          {t("toolbar.settings")}
        </span>
      </button>

      <div className="w-px h-5 bg-[hsl(var(--border))] mx-1" />

      {/* ─── File actions with labels ─── */}
      <LabeledBtn
        icon={Menu}
        label={t("toolbar.files")}
        title={t("toolbar.workspace")}
        onClick={toggleWorkspace}
        active={showWorkspace}
      />
      <LabeledBtn
        icon={FileText}
        label={t("toolbar.new")}
        title={`${t("toolbar.new")} (⌘N)`}
        onClick={onNew}
      />
      <LabeledBtn
        icon={FolderOpen}
        label={t("toolbar.open")}
        title={`${t("toolbar.open")} (⌘O)`}
        onClick={onOpen}
      />
      <LabeledBtn
        icon={Save}
        label={t("toolbar.save")}
        title={`${t("toolbar.save")} (⌘S)`}
        onClick={() => onSave(false)}
      />

      {/* ─── Center: View Menu + file name ─── */}
      <div className="flex-1 flex items-center justify-center gap-3 min-w-0">
        <div ref={viewRef} style={{ position: "relative" }}>
          <button
            className="seg-btn active"
            onClick={() => setViewOpen((v) => !v)}
            title={t("toolbar.viewMode")}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px" }}
          >
            <currentMode.icon size={13} />
            <span>{t(currentMode.labelKey)}</span>
            <ChevronDown size={11} style={{ opacity: 0.5 }} />
          </button>

          {viewOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: "50%",
                transform: "translateX(-50%)",
                minWidth: 220,
                background: "hsl(var(--bg))",
                border: "1px solid hsl(var(--border-strong))",
                borderRadius: 10,
                boxShadow: "0 12px 40px -8px hsl(0 0% 0% / 0.4)",
                zIndex: 9999,
                padding: "6px 0",
                animation: "cmdSlideIn 120ms ease",
              }}
            >
              {/* View modes */}
              <MenuSection label={t("toolbar.viewMode")} />
              {MODES.map((m) => (
                <MenuItem
                  key={m.value}
                  icon={<m.icon size={13} />}
                  label={t(m.labelKey)}
                  hint={m.shortcut}
                  active={mode === m.value}
                  onClick={() => { setMode(m.value); setViewOpen(false); }}
                />
              ))}

              <MenuDivider />
              <MenuSection label={t("toolbar.appearance")} />
              <MenuItem
                icon={isDark ? <Sun size={13} /> : <Moon size={13} />}
                label={isDark ? t("toolbar.lightMode") : t("toolbar.darkMode")}
                onClick={() => { setTheme(isDark ? "light" : "dark"); setViewOpen(false); }}
              />
              <MenuItem
                icon={<Type size={13} />}
                label={rtl ? "LTR ←" : "RTL →"}
                onClick={() => { toggleRtl(); setViewOpen(false); }}
              />

              <MenuDivider />
              <MenuSection label={t("toolbar.panels")} />
              <MenuItem
                icon={showOutline ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
                label={showOutline ? t("toolbar.outline.hide") : t("toolbar.outline.show")}
                onClick={() => { toggleOutline(); setViewOpen(false); }}
              />
            </div>
          )}
        </div>

        {/* File name */}
        <div className="text-[12px] text-fg-muted truncate" style={{ maxWidth: 360 }} title={doc.name}>
          {doc.name}
          {doc.dirty && <span style={{ color: "hsl(var(--accent))", marginLeft: 4 }}>•</span>}
        </div>
      </div>

      {/* ─── Right: ⌘K ─── */}
      <button
        className="icon-btn"
        title={`${t("toolbar.commandPalette")} (⌘K)`}
        aria-label={t("toolbar.commandPalette")}
        onClick={onCommandPalette}
        style={{ width: "auto", padding: "0 10px", gap: 6 }}
      >
        <CommandIcon size={13} />
        <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, ui-monospace, monospace", color: "hsl(var(--fg-muted))" }}>
          ⌘K
        </span>
      </button>
    </header>
  );
}

/* ─── Menu Helpers ─── */

function MenuSection({ label }: { label: string }) {
  return (
    <div style={{
      padding: "4px 12px 2px",
      fontSize: 10,
      color: "hsl(var(--fg-muted))",
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
    }}>
      {label}
    </div>
  );
}

function MenuDivider() {
  return <div style={{ height: 1, background: "hsl(var(--border))", margin: "4px 0" }} />;
}

function MenuItem({
  icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 12px",
        border: "none",
        background: active ? "hsl(var(--accent) / 0.12)" : "transparent",
        color: active ? "hsl(var(--accent))" : "hsl(var(--fg))",
        fontSize: 13,
        cursor: "pointer",
        textAlign: "start",
      }}
    >
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
      {hint && <span style={{ fontSize: 11, color: "hsl(var(--fg-muted))" }}>{hint}</span>}
    </button>
  );
}
