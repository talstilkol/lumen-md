import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  FileText,
  FolderOpen,
  Save,
  Sun,
  Moon,
  Eye,
  Pencil,
  Columns2,
  Sparkles,
  BarChart3,
  Map,
  Network,
  Table,
  Calculator,
  Quote,
  Download,
  PanelRightOpen,
  Printer,
  Music2,
  Box,
  Workflow,
  Link,
  Youtube,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { t } from "../i18n";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon?: LucideIcon;
  group?: string;
  action: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

export function CommandPalette({ open, onClose, commands }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState<"main" | "advanced" | "all">("main");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // Groups that belong to the "Main" tab
  const MAIN_GROUPS = new Set([
    t("group.file"), "File", "file",
    t("group.view"), "View", "view",
    t("group.edit"), "Edit", "edit",
    undefined, // commands with no group
  ]);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement;
      setQuery("");
      setActive(0);
      setTab("main");
      // focus next tick so React renders the input first
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      // Restore focus to whatever opened the palette.
      const prev = previousFocusRef.current as HTMLElement | null;
      prev?.focus?.();
    }
  }, [open]);

  // Focus trap while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const filtered = useMemo(() => {
    let list = commands;
    const q = query.trim().toLowerCase();

    // If searching, search across ALL commands
    if (q) {
      return list.filter((c) => {
        const haystack = `${c.label} ${c.hint ?? ""} ${c.group ?? ""}`.toLowerCase();
        return haystack.includes(q);
      });
    }

    // Otherwise filter by tab
    if (tab === "main") {
      list = list.filter((c) => MAIN_GROUPS.has(c.group));
    } else if (tab === "advanced") {
      list = list.filter((c) => !MAIN_GROUPS.has(c.group));
    }
    // "all" shows everything

    return list;
  }, [query, commands, tab]);

  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered, active]);

  // Auto-scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-cmd-index="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[active];
      if (cmd) {
        onClose();
        // Defer slightly so the palette unmounts before the action (e.g. file dialog) runs.
        setTimeout(() => cmd.action(), 0);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  if (!open) return null;

  const TABS: { key: "main" | "advanced" | "all"; label: string; emoji: string }[] = [
    { key: "main", label: "Main", emoji: "📁" },
    { key: "advanced", label: "Advanced", emoji: "⚡" },
    { key: "all", label: "All", emoji: "🔍" },
  ];

  return (
    <div
      className="cmd-palette-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={dialogRef}
        className="cmd-palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmd-palette-search">
          <Search size={16} style={{ opacity: 0.6, flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            aria-autocomplete="list"
            aria-controls="cmd-listbox"
            aria-activedescendant={filtered.length > 0 ? `cmd-item-${active}` : undefined}
            spellCheck={false}
          />
        </div>

        {/* ─── Category Tabs ─── */}
        {!query.trim() && (
          <div style={{
            display: "flex",
            gap: 2,
            padding: "4px 8px",
            borderBottom: "1px solid hsl(var(--border))",
          }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setActive(0); }}
                style={{
                  flex: 1,
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: tab === t.key ? 600 : 400,
                  background: tab === t.key ? "hsl(var(--accent) / 0.15)" : "transparent",
                  color: tab === t.key ? "hsl(var(--accent))" : "hsl(var(--fg-muted))",
                  transition: "all 150ms ease",
                }}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="cmd-palette-list" ref={listRef} id="cmd-listbox" role="listbox">
          {filtered.length === 0 && (
            <div className="cmd-palette-empty">{t("palette.noMatch")}</div>
          )}
          {(() => {
            let lastGroup = "";
            return filtered.map((cmd, i) => {
              const Icon = cmd.icon ?? Sparkles;
              const showHeader = cmd.group && cmd.group !== lastGroup;
              if (cmd.group) lastGroup = cmd.group;
              return (
                <React.Fragment key={cmd.id}>
                  {showHeader && (
                    <div
                      style={{
                        padding: "8px 14px 4px",
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "hsl(var(--accent) / 0.7)",
                        borderTop: i > 0 ? "1px solid hsl(var(--border) / 0.4)" : "none",
                        marginTop: i > 0 ? 4 : 0,
                        userSelect: "none",
                      }}
                    >
                      {cmd.group}
                    </div>
                  )}
                  <div
                    id={`cmd-item-${i}`}
                    data-cmd-index={i}
                    className={`cmd-palette-item ${i === active ? "active" : ""}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => {
                      onClose();
                      setTimeout(() => cmd.action(), 0);
                    }}
                  >
                    <Icon size={15} style={{ opacity: 0.75, flexShrink: 0 }} />
                    <span className="cmd-palette-label">{cmd.label}</span>
                    {cmd.hint && (
                      <span className="cmd-palette-hint">{cmd.hint}</span>
                    )}
                    {cmd.shortcut && (
                      <span className="cmd-palette-shortcut">{cmd.shortcut}</span>
                    )}
                  </div>
                </React.Fragment>
              );
            });
          })()}
        </div>
        <div className="cmd-palette-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> {t("palette.navigate")}
          </span>
          <span>
            <kbd>↵</kbd> {t("palette.select")}
          </span>
          <span>
            <kbd>Esc</kbd> {t("palette.close")}
          </span>
        </div>
      </div>
    </div>
  );
}

// Icons re-exported so App.tsx can build a command list without re-importing
export const cmdIcons = {
  FileText,
  FolderOpen,
  Save,
  Sun,
  Moon,
  Eye,
  Pencil,
  Columns2,
  Sparkles,
  BarChart3,
  Map,
  Network,
  Table,
  Calculator,
  Quote,
  Download,
  PanelRightOpen,
  Printer,
  Music2,
  Box,
  Workflow,
  Link,
  Youtube,
};
