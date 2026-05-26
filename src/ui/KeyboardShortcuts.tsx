import { useEffect, useMemo, useRef } from "react";
import { t } from "../i18n";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Detect whether the user is on macOS. We previously used
 * `navigator.platform` which is deprecated and unreliable — in
 * Playwright's chromium on macOS, navigator.platform is "MacIntel"
 * but in some embedded contexts (Tauri webview, electron) it returns
 * "Linux x86_64". Round-12 screenshot revealed the dialog showed
 * `Ctrl+S` etc. on macOS because of this. Prefer userAgentData
 * (modern Chromium+) and fall back to userAgent substring match.
 */
export function detectIsMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // Modern API — Chromium 90+, Edge, Opera.
  const ua = (navigator as Navigator & {
    userAgentData?: { platform?: string };
  }).userAgentData;
  if (ua?.platform) return /mac/i.test(ua.platform);
  // Fallback: userAgent string ("Macintosh" is the canonical token).
  if (navigator.userAgent) {
    if (/Macintosh|Mac OS X|Mac_PowerPC/i.test(navigator.userAgent)) return true;
  }
  // Last resort: deprecated `platform`. Some build pipelines (sandboxed
  // iframes, headless without ua) still expose it.
  if (navigator.platform && /mac/i.test(navigator.platform)) return true;
  return false;
}

function buildSections(mod: string) {
  return [
    {
      title: () => t("group.file"),
      items: [
        { keys: `${mod}+S`, label: () => t("cmd.save") },
        { keys: `${mod}+Shift+S`, label: () => t("cmd.saveAs") },
        { keys: `${mod}+O`, label: () => t("cmd.open") },
        { keys: `${mod}+N`, label: () => t("cmd.new") },
      ],
    },
    {
      title: () => t("group.edit"),
      items: [
        { keys: `${mod}+Z`, label: () => "Undo" },
        { keys: `${mod}+Shift+Z`, label: () => "Redo" },
        { keys: `${mod}+X`, label: () => "Cut" },
        { keys: `${mod}+C`, label: () => "Copy" },
        { keys: `${mod}+V`, label: () => "Paste" },
        { keys: `${mod}+A`, label: () => "Select All" },
        { keys: `${mod}+F`, label: () => t("cmd.search") },
      ],
    },
    {
      title: () => t("group.view"),
      items: [
        { keys: `${mod}+1`, label: () => t("cmd.source") },
        { keys: `${mod}+2`, label: () => t("cmd.split") },
        { keys: `${mod}+3`, label: () => t("cmd.preview") },
        { keys: `${mod}+4`, label: () => "WYSIWYG" },
        { keys: `${mod}+Shift+F`, label: () => t("cmd.focusMode") ?? "Focus Mode" },
      ],
    },
    {
      title: () => "Navigation",
      items: [
        { keys: `${mod}+K`, label: () => t("cmd.cmdPalette") },
        { keys: `${mod}+/`, label: () => t("cmd.shortcuts") ?? "Keyboard Shortcuts" },
        { keys: "Esc", label: () => t("palette.close") },
      ],
    },
  ];
}

export function KeyboardShortcuts({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Compute platform-aware sections at render time, not module load —
  // some webview contexts (tests, sandboxed iframes) don't have
  // navigator.platform populated until after the bundle parses.
  const SECTIONS = useMemo(
    () => buildSections(detectIsMac() ? "⌘" : "Ctrl"),
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="cmd-palette-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard Shortcuts"
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 92vw)",
          maxHeight: "70vh",
          overflow: "auto",
          background: "hsl(var(--bg-muted))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 16,
          padding: "24px 28px",
          boxShadow: "0 20px 60px hsl(0 0% 0% / 0.4)",
        }}
      >
        <h2
          style={{
            fontSize: 16,
            fontWeight: 700,
            marginBottom: 20,
            color: "hsl(var(--fg))",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          ⌨️ {t("cmd.shortcuts") ?? "Keyboard Shortcuts"}
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "hsl(var(--fg-muted))",
              cursor: "pointer",
              fontSize: 18,
              padding: "4px 8px",
              borderRadius: 6,
            }}
          >
            ✕
          </button>
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 20,
          }}
        >
          {SECTIONS.map((section, si) => (
            <div key={si}>
              <h3
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "hsl(var(--accent))",
                  marginBottom: 8,
                }}
              >
                {section.title()}
              </h3>
              {section.items.map((item, ii) => (
                <div
                  key={ii}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "5px 0",
                    fontSize: 12,
                    color: "hsl(var(--fg-subtle))",
                    borderBottom: "1px solid hsl(var(--border) / 0.3)",
                  }}
                >
                  <span>{item.label()}</span>
                  <kbd
                    style={{
                      fontSize: 10,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "hsl(var(--bg-inset))",
                      border: "1px solid hsl(var(--border))",
                      fontFamily: "inherit",
                      color: "hsl(var(--fg-muted))",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.keys}
                  </kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
