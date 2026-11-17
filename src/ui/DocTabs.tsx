import React, { useRef, useState } from "react";
import { X, FileText } from "lucide-react";
import type { DocFile } from "../store/useStore";
import { t } from "../i18n";
import { inlineDirectionOf, rovingIndex } from "../lib/logicalKeys";
import { matchShortcut } from "../lib/keyboardLayout";
import { droppedOutside } from "../desktop/window";

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
  /** Desktop (plan W3.9): a tab dropped outside the window moves to the window under the pointer, or a new one. */
  onDragOut?: (id: string) => void;
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
  onDragOut,
}: Props) {
  const [dragSrc, setDragSrc] = useState<number | null>(null);
  /** WCAG 2.5.7: the tab's menu (right-click, or the Menu key) — moving a tab without dragging it. */
  const [menu, setMenu] = useState<{ idx: number; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const focusTab = (i: number) => requestAnimationFrame(() => stripRef.current?.querySelectorAll<HTMLButtonElement>("button[data-doc-tab]")[i]?.focus());
  const move = (from: number, to: number) => {
    if (!onReorder || to < 0 || to >= tabs.length || to === from) return;
    onReorder(from, to);
    focusTab(to);
  };
  const [dragHover, setDragHover] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null);

  /**
   * Touch reorder (plan 10.2.1): HTML5 drag doesn't start from a finger on
   * most mobile browsers. A long press (400 ms) picks the tab up, sliding
   * moves the drop marker, lifting drops it. Moving before the press ends is
   * a scroll of the tab strip, not a drag.
   */
  const startTouchDrag = (e: React.PointerEvent, idx: number) => {
    if (!onReorder || e.pointerType === "mouse") return;
    const id = e.pointerId;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let active = false;
    const timer = setTimeout(() => {
      active = true;
      hoverRef.current = idx;
      setDragSrc(idx);
      setDragHover(idx);
    }, 400);
    const blockScroll = (ev: TouchEvent) => {
      if (active) ev.preventDefault();
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      if (!active) {
        if (Math.abs(ev.clientX - x0) > 10 || Math.abs(ev.clientY - y0) > 10) finish(false);
        return;
      }
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-tab-index]");
      const at = under ? Number(under.dataset.tabIndex) : null;
      if (at !== null && at !== hoverRef.current) {
        hoverRef.current = at;
        setDragHover(at);
      }
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === id) finish(ev.type === "pointerup");
    };
    function finish(drop: boolean) {
      clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.removeEventListener("touchmove", blockScroll);
      if (active && drop && hoverRef.current !== null && hoverRef.current !== idx) onReorder?.(idx, hoverRef.current);
      if (active) {
        setDragSrc(null);
        setDragHover(null);
      }
      hoverRef.current = null;
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    document.addEventListener("touchmove", blockScroll, { passive: false });
  };

  if (tabs.length <= 1) return null;

  return (
    <>
    <div
      ref={stripRef}
      className="doc-tabs"
      // Using `role="group"` rather than `tablist` — tablist mandates that
      // every direct child be a `role="tab"` (axe `aria-required-children`).
      // Each tab includes a sibling close button that ARIA spec doesn't
      // count as a tab; `group` keeps the semantic without that constraint.
      role="group"
      aria-label={t("docTabs.label")}
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
            onPointerDown={(e) => startTouchDrag(e, idx)}
            onContextMenu={(e) => {
              // A long press shouldn't open the browser's menu over the tab being dragged.
              if (dragSrc !== null) {
                e.preventDefault();
                return;
              }
              // W13.Y5 (WCAG 2.5.7): right-click (or the Menu key) opens Move earlier / later — reordering without a drag.
              if (!onReorder) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ idx, x: e.clientX || r.left, y: e.clientY || r.bottom });
            }}
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
            onDragEnd={(e) => {
              setDragSrc(null);
              setDragHover(null);
              if (onDragOut && e.dataTransfer.dropEffect === "none" && droppedOutside(e, { w: window.innerWidth, h: window.innerHeight })) onDragOut(tab.id);
            }}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "stretch",
              borderInlineEnd: "1px solid hsl(var(--border) / 0.5)",
              borderBottom: isActive
                ? "2px solid hsl(var(--accent))"
                : "2px solid transparent",
              borderInlineStart: isDropTarget
                ? "2px solid hsl(var(--accent))"
                : "2px solid transparent",
              background: isActive ? "hsl(var(--bg))" : "transparent",
              opacity: isDragSource ? 0.45 : 1,
            }}
          >
            <button
              type="button"
              // `aria-current="page"` is the recommended way to mark the
              // active tab when not using the strict tab/tablist pattern.
              aria-current={isActive ? "page" : undefined}
              onClick={() => onSelect(tab.id)}
              data-doc-tab=""
              onKeyDown={(e) => {
                // Cmd/Ctrl+W → close from the keyboard while focused on the tab.
                if (matchShortcut(e, "Mod+W")) {
                  e.preventDefault();
                  onClose(tab.id);
                  return;
                }
                // W13.Y5: Alt+Shift+←/→ moves the tab itself one place, in the direction drawn (RTL aware).
                const strip = e.currentTarget.closest(".doc-tabs");
                if (onReorder && e.altKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                  e.preventDefault();
                  const rtl = inlineDirectionOf(strip) === "rtl";
                  const later = (e.key === "ArrowRight") !== rtl;
                  move(idx, idx + (later ? 1 : -1));
                  return;
                }
                const next = rovingIndex(e.key, inlineDirectionOf(strip), idx, tabs.length);
                if (next === null || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                strip?.querySelectorAll<HTMLButtonElement>("button[data-doc-tab]")[next]?.focus();
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
              title={t("docTabs.close")}
              aria-label={t("docTabs.close")}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                // 24 px: the WCAG 2.2 minimum target (2.5.8).
                width: 24,
                height: 24,
                margin: "auto 6px auto 0",
                borderRadius: 4,
                border: "none",
                background: "transparent",
                color: "hsl(var(--fg-muted))",
                cursor: "pointer",
                flexShrink: 0,
                opacity: isActive ? 0.7 : 0.5,
                transition: "opacity var(--duration-fast) var(--ease-out)",
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
    {menu && (
      <TabMenu
        x={menu.x}
        y={menu.y}
        label={tabs[menu.idx]?.name ?? ""}
        menuRef={menuRef}
        canEarlier={menu.idx > 0}
        canLater={menu.idx < tabs.length - 1}
        onEarlier={() => (move(menu.idx, menu.idx - 1), setMenu(null))}
        onLater={() => (move(menu.idx, menu.idx + 1), setMenu(null))}
        onClose={() => {
          const i = menu.idx;
          setMenu(null);
          focusTab(i);
        }}
      />
    )}
    </>
  );
});

/**
 * The tab's menu (W13.Y5, WCAG 2.5.7 Dragging Movements): Move earlier /
 * Move later, one click each — the single-pointer way to do what dragging
 * a tab does. Earlier/later follow the reading order, so the words are right
 * in Hebrew as in English. ↑/↓ move between the items, Escape closes and
 * gives focus back to the tab.
 */
function TabMenu(p: { x: number; y: number; label: string; menuRef: React.RefObject<HTMLDivElement | null>; canEarlier: boolean; canLater: boolean; onEarlier: () => void; onLater: () => void; onClose: () => void }) {
  React.useEffect(() => {
    p.menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not([aria-disabled=true])")?.focus();
    const away = (e: PointerEvent) => {
      if (!p.menuRef.current?.contains(e.target as Node)) p.onClose();
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const item: React.CSSProperties = { display: "block", width: "100%", minHeight: 28, padding: "4px 12px", textAlign: "start", border: "none", background: "transparent", color: "inherit", font: "inherit", fontSize: 13, cursor: "pointer", borderRadius: 4 };
  const entries: Array<{ label: string; on: () => void; ok: boolean }> = [
    { label: t("docTabs.moveEarlier"), on: p.onEarlier, ok: p.canEarlier },
    { label: t("docTabs.moveLater"), on: p.onLater, ok: p.canLater },
  ];
  return (
    <div
      ref={p.menuRef}
      role="menu"
      aria-label={t("docTabs.menu", { name: p.label })}
      data-testid="doc-tab-menu"
      style={{ position: "fixed", left: Math.min(p.x, window.innerWidth - 200), top: Math.min(p.y, window.innerHeight - 90), zIndex: 1000, minWidth: 180, padding: 4, background: "hsl(var(--bg))", color: "hsl(var(--fg))", border: "1px solid hsl(var(--border))", borderRadius: 8, boxShadow: "var(--shadow-md, 0 6px 20px rgba(0,0,0,.15))" }}
      onKeyDown={(e) => {
        const items = [...(p.menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          p.onClose();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
        }
      }}
    >
      {entries.map((en) => (
        <button key={en.label} type="button" role="menuitem" aria-disabled={!en.ok || undefined} style={{ ...item, opacity: en.ok ? 1 : 0.5 }} onClick={() => en.ok && en.on()}>
          {en.label}
        </button>
      ))}
    </div>
  );
}

/** Utility: generate a unique tab ID. Mirrored in `useStore.tabIdOf`. */
export function tabId(doc: DocFile): string {
  return doc.workspaceName ?? doc.name ?? t("doc.untitled");
}
