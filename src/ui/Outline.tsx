import React, { useEffect, useMemo, useState } from "react";
import { extractToc } from "../renderer/pipeline";
import { t } from "../i18n";

interface Props {
  markdownText: string;
}

export const Outline = React.memo(function Outline({ markdownText }: Props) {
  // Debounce expensive TOC extraction.
  const [debounced, setDebounced] = useState(markdownText);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(markdownText), 200);
    return () => clearTimeout(h);
  }, [markdownText]);

  const toc = useMemo(() => extractToc(debounced), [debounced]);

  // Scroll-spy: track which heading is currently in view within the preview pane.
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (toc.length === 0) {
      setActiveId(null);
      return;
    }
    const root = document.querySelector<HTMLElement>("[data-preview-root]");
    if (!root) return;

    const ids = toc.map((h) => h.id);
    // Track which IDs are currently intersecting.
    const visible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).id;
          if (!id) continue;
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        // Pick the first heading (in document order) that is visible.
        const firstVisible = ids.find((id) => visible.has(id));
        if (firstVisible) {
          setActiveId(firstVisible);
        } else {
          // Fall back: find the last heading above the viewport top.
          let fallback: string | null = null;
          const scrollTop = root.scrollTop;
          for (const id of ids) {
            const el = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
            if (el && el.offsetTop <= scrollTop + 8) fallback = id;
          }
          setActiveId(fallback);
        }
      },
      { root, rootMargin: "0px 0px -70% 0px", threshold: [0, 1] },
    );

    for (const id of ids) {
      const el = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [toc]);

  return (
    <aside
      className="
        outline-aside h-full overflow-y-auto py-3 px-1 bg-bg-subtle border-l border-border
        w-[260px] flex-shrink-0
        max-md:hidden md:block
      "
    >
      <div className="px-2 mb-2 text-[11px] uppercase tracking-wider text-fg-muted font-semibold">
        {t("outline.title")}
      </div>
      {toc.length === 0 ? (
        <div className="px-2 text-[12px] text-fg-muted">
          {t("outline.empty")}
        </div>
      ) : (
        <nav aria-label={t("outline.title")}>
          {toc.map((h, i) => (
            <a
              key={i}
              href={`#${h.id}`}
              className={`outline-link h${h.depth}${activeId === h.id ? " active" : ""}`}
              aria-current={activeId === h.id ? "location" : undefined}
              onClick={(e) => {
                e.preventDefault();
                const el = document.getElementById(h.id);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {h.text}
            </a>
          ))}
        </nav>
      )}
    </aside>
  );
});
