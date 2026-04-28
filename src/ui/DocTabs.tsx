import React, { useState } from "react";
import { X, FileText } from "lucide-react";
import type { DocFile } from "../store/useStore";
import { t } from "../i18n";

export interface TabItem {
  id: string;
  name: string;
  dirty: boolean;
}

interface Props {
  tabs: TabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** Reorder a tab by drag-and-drop. Indexes are relative to the `tabs` prop. */
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

/**
 * Document-tab strip. The X-button is always visible (50% opacity until
 * hover) so users on touch devices can close a tab without first hovering.
 *
 * Drag-and-drop reorder uses HTML5 drag events: dragstart sets the source
 * index, dragover prevents default + flags the hover index for the drop
 * indicator, drop calls `onReorder`. Pointer-only — keyboard reorder is
 * surfaced via `Cmd/Ctrl+Shift+Pageup/Pagedown` keymaps elsewhere.
 */
export const DocTabs = React.memo(function DocTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onReorder,
}: Props) {
  const [dragSrc, setDragSrc] = useState<number | null>(null);
  const [dragHover, setDragHover] = useState<number | null>(null);

  if (tabs.length <= 1) return null;

  return (
    <div
      className="doc-tabs"
      // Using `role="group"` rather than `tablist` — tablist mandates that
      // every direct child be a `role="tab"` (axe `aria-required-children`).
      // Each tab includes a sibling close button that ARIA spec doesn't
      // count as a tab; `group` keeps the semantic without that constraint.
      role="group"
      aria-label={t("docTabs.label") ?? "Open documents"}
      style={{
        display: "flex",
        alignItems: "stretch",
        height: 32,
        background: "hsl(var(--bg-subtle))",
        borderBottom: "1px solid hsl(var(--border))",
        overflowX: "auto",
        scrollbarWidth: "none",
        flexShrink: 0,
      }}
    >
      {tabs.map((tab, idx) => {
        const isActive = tab.id === activeId;
        const isDragSource = dragSrc === idx;
        const isDropTarget = dragHover === idx && dragSrc !== null && dragSrc !== idx;
        // We render the tab as TWO sibling buttons (body + close) inside a
        // non-interactive wrapper. axe rejects nested interactives — putting
        // a focusable close button inside a focusable role="tab" element is
        // a "nested-interactive" WCAG violation. Splitting them keeps the
        // visual layout while making each control independently reachable
        // for screen-readers + keyboard.
        return (
          <div
            key={tab.id}
            data-tab-index={idx}
            draggable={!!onReorder}
            onMouseDown={(e) => {
              // Middle-click anywhere in the tab row = close (browser convention).
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab.id);
              }
            }}
            onDragStart={(e) => {
              if (!onReorder) return;
              setDragSrc(idx);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(idx));
            }}
            onDragOver={(e) => {
              if (!onReorder || dragSrc === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragHover !== idx) setDragHover(idx);
            }}
            onDragLeave={() => {
              if (dragHover === idx) setDragHover(null);
            }}
            onDrop={(e) => {
              if (!onReorder || dragSrc === null) return;
              e.preventDefault();
              if (dragSrc !== idx) onReorder(dragSrc, idx);
              setDragSrc(null);
              setDragHover(null);
            }}
            onDragEnd={() => {
              setDragSrc(null);
              setDragHover(null);
            }}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "stretch",
              borderRight: "1px solid hsl(var(--border) / 0.5)",
              borderBottom: isActive
                ? "2px solid hsl(var(--accent))"
                : "2px solid transparent",
              borderInlineStart: isDropTarget
                ? "2px solid hsl(var(--accent))"
                : "2px solid transparent",
              background: isActive ? "hsl(var(--bg))" : "transparent",
              transition: "background 120ms, border-color 80ms",
              opacity: isDragSource ? 0.45 : 1,
            }}
          >
            <button
              type="button"
              // `aria-current="page"` is the recommended way to mark the
              // active tab when not using the strict tab/tablist pattern.
              aria-current={isActive ? "page" : undefined}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(e) => {
                // Cmd/Ctrl+W → close from the keyboard while focused on the tab.
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
                  e.preventDefault();
                  onClose(tab.id);
                }
              }}
              title={tab.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 6px 0 12px",
                fontSize: 11.5,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? "hsl(var(--fg))" : "hsl(var(--fg-muted))",
                background: "transparent",
                border: "none",
                cursor: onReorder ? "grab" : "pointer",
                whiteSpace: "nowrap",
                transition: "color 120ms",
                minWidth: 0,
                maxWidth: 162,
                userSelect: "none",
                fontFamily: "inherit",
              }}
            >
              <FileText size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {tab.dirty ? "● " : ""}
                {tab.name}
              </span>
            </button>
            <button
              type="button"
              title={t("docTabs.close") ?? "Close"}
              aria-label={t("docTabs.close") ?? "Close tab"}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                margin: "auto 6px auto 0",
                borderRadius: 4,
                border: "none",
                background: "transparent",
                color: "hsl(var(--fg-muted))",
                cursor: "pointer",
                flexShrink: 0,
                opacity: isActive ? 0.7 : 0.5,
                transition: "opacity 120ms, background 120ms",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.opacity = "1";
                el.style.background = "hsl(var(--fg) / 0.08)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.opacity = isActive ? "0.7" : "0.5";
                el.style.background = "transparent";
              }}
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
});

/** Utility: generate a unique tab ID. Mirrored in `useStore.tabIdOf`. */
export function tabId(doc: DocFile): string {
  return doc.workspaceName ?? doc.name ?? t("doc.untitled");
}
