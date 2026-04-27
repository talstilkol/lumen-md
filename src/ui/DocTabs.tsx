import React from "react";
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
}

export const DocTabs = React.memo(function DocTabs({ tabs, activeId, onSelect, onClose }: Props) {
  if (tabs.length <= 1) return null;

  return (
    <div
      className="doc-tabs"
      role="tablist"
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
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 12px",
              fontSize: 11.5,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? "hsl(var(--fg))" : "hsl(var(--fg-muted))",
              background: isActive ? "hsl(var(--bg))" : "transparent",
              borderRight: "1px solid hsl(var(--border) / 0.5)",
              borderBottom: isActive ? "2px solid hsl(var(--accent))" : "2px solid transparent",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background 120ms, color 120ms",
              minWidth: 0,
              maxWidth: 180,
              userSelect: "none",
            }}
          >
            <FileText size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {tab.dirty ? "● " : ""}{tab.name}
            </span>
            <button
              title={t("docTabs.close")}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16,
                height: 16,
                borderRadius: 3,
                border: "none",
                background: "transparent",
                color: "hsl(var(--fg-muted))",
                cursor: "pointer",
                flexShrink: 0,
                opacity: isActive ? 0.6 : 0.3,
                transition: "opacity 120ms",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = isActive ? "0.6" : "0.3"; }}
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
});

/** Utility: generate a unique tab ID */
export function tabId(doc: DocFile): string {
  return doc.workspaceName ?? doc.name ?? "Untitled";
}
