import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "lumen-sidebar-width";
const MIN = 160;
const MAX = 480;

/**
 * Vertical drag handle that resizes the workspace sidebar by mutating the
 * `--sidebar-width` CSS variable on the document root. Width is persisted.
 */
export function SidebarResizer() {
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(240);

  // Restore saved width on mount.
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? Number(raw) : NaN;
    if (Number.isFinite(saved) && saved >= MIN && saved <= MAX) {
      document.documentElement.style.setProperty(
        "--sidebar-width",
        `${saved}px`,
      );
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      const isRTL = document.documentElement.getAttribute("dir") === "rtl";
      const delta = (e.clientX - startXRef.current) * (isRTL ? -1 : 1);
      const next = Math.max(MIN, Math.min(MAX, startWidthRef.current + delta));
      document.documentElement.style.setProperty(
        "--sidebar-width",
        `${next}px`,
      );
    }
    function onUp() {
      setDragging(false);
      const cur = getComputedStyle(document.documentElement).getPropertyValue(
        "--sidebar-width",
      );
      const px = parseInt(cur, 10);
      if (Number.isFinite(px)) localStorage.setItem(STORAGE_KEY, String(px));
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  return (
    <div
      className={`sidebar-resizer ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      onMouseDown={(e) => {
        startXRef.current = e.clientX;
        const cur = getComputedStyle(
          document.documentElement,
        ).getPropertyValue("--sidebar-width");
        startWidthRef.current = parseInt(cur, 10) || 240;
        setDragging(true);
        e.preventDefault();
      }}
    />
  );
}
