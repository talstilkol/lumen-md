import React, { useEffect, useMemo, useRef, useState } from "react";
import { extractToc } from "../renderer/pipeline";
import { LARGE_DOC_CHARS } from "../renderer/previewDoc";
import type { IncrementalToc, TocEntry } from "../renderer/incrementalToc";
import { t } from "../i18n";
import { scrollBehavior } from "../lib/motion";
import { useAppStore } from "../store/useStore";
import { EmptyState } from "./EmptyState";
import { HelpButton } from "./HelpButton";
import { filterMatch, highlightParts } from "../text/filterMatch";
import outlineFilterEnglish from "../i18n/lazy/outlineFilter.json";
import { registerEnglish } from "../i18n";

registerEnglish(outlineFilterEnglish);

/** The search results' highlight (searchSnippet.tsx): the accent tint, readable in both themes. */
const MARK: React.CSSProperties = { background: "hsl(var(--accent) / 0.25)", color: "hsl(var(--fg))", padding: 0, borderRadius: 2 };

interface Props {
  markdownText: string;
  /** Phone width (plan 10.2.4): a bottom sheet over the editor, closed by its button or by picking a heading. */
  sheet?: boolean;
}

export const Outline = React.memo(function Outline({ markdownText, sheet = false }: Props) {
  // Debounce expensive TOC extraction.
  const [debounced, setDebounced] = useState(markdownText);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(markdownText), 200);
    return () => clearTimeout(h);
  }, [markdownText]);

  // A long document re-parses only the blocks that changed (plan 8.4);
  // the result is the same as extractToc's.
  const large = debounced.length >= LARGE_DOC_CHARS;
  const smallToc = useMemo(() => (large ? null : extractToc(debounced)), [debounced, large]);
  const incrementalRef = useRef<IncrementalToc | null>(null);
  const [largeToc, setLargeToc] = useState<TocEntry[]>([]);
  useEffect(() => {
    if (!large) return;
    let cancelled = false;
    void import("../renderer/incrementalToc").then((m) => {
      if (cancelled) return;
      const inc = (incrementalRef.current ??= new m.IncrementalToc());
      setLargeToc(inc.update(debounced));
      setLargeFor(debounced);
    });
    return () => {
      cancelled = true;
    };
  }, [debounced, large]);
  const toc = smallToc ?? largeToc;
  // The heading filter (W13.E3): niqqud, accents, case and geresh do not count.
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => (filter.trim() ? toc.filter((h) => filterMatch(h.text, filter)) : toc), [toc, filter]);
  const navRef = useRef<HTMLElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  // The ready marker (plan W7.25): the list is built from the text on screen, not a stale or pending parse.
  const [largeFor, setLargeFor] = useState<string | null>(null);
  const ready = debounced === markdownText && (!large || largeFor === debounced);

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
      className={
        sheet
          ? "outline-aside outline-sheet"
          : `
        outline-aside h-full overflow-y-auto py-3 px-1 bg-bg-subtle border-s border-border
        w-[260px] shrink-0
        max-md:hidden md:block
      `
      }
      aria-label={sheet ? t("outline.title") : undefined}
      data-testid={sheet ? "outline-sheet" : "outline"}
      data-ready={String(ready)}
    >
      {sheet && <div className="outline-sheet-grip" aria-hidden="true" />}
      <div className="px-2 mb-2 text-[11px] uppercase tracking-wider text-fg-muted font-semibold outline-sheet-head">
        <span>{t("outline.title")}</span>
        <HelpButton topic="workspace/panels#outline" />
        {sheet && (
          <button type="button" className="icon-btn outline-sheet-close" onClick={() => useAppStore.getState().toggleOutline()} aria-label={t("outline.close")}>
            ✕
          </button>
        )}
      </div>
      {toc.length === 0 ? (
        <EmptyState
          style={{ padding: "0 8px" }}
          message={t("outline.empty")}
          action={{ label: t("outline.addHeading"), onClick: () => window.dispatchEvent(new CustomEvent("lumen-mobile-insert", { detail: { insert: "\n# ", cursorOffset: 0 } })) }}
        />
      ) : (
        <>
        {toc.length > 1 && (
          <div className="px-2 mb-2">
            <input
              ref={filterRef}
              type="search"
              className="w-full rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
              placeholder={t("outline.filter")}
              aria-label={t("outline.filter")}
              data-testid="outline-filter"
              dir="auto"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && filter) {
                  // Clear first; a second Escape goes on to whatever closes the panel.
                  e.preventDefault();
                  e.stopPropagation();
                  setFilter("");
                } else if (e.key === "ArrowDown" || (e.key === "Enter" && shown.length)) {
                  const first = navRef.current?.querySelector<HTMLElement>("a");
                  if (first) {
                    e.preventDefault();
                    if (e.key === "Enter") first.click();
                    else first.focus();
                  }
                }
              }}
            />
            {filter.trim() && (
              <p className="sr-only" role="status" aria-live="polite">
                {shown.length ? t("outline.filterCount", { n: shown.length, total: toc.length }) : ""}
              </p>
            )}
          </div>
        )}
        {shown.length === 0 && filter.trim() ? (
          <p className="px-2 text-sm text-fg-muted" role="status" data-testid="outline-filter-empty" dir="auto">
            {t("outline.filterNoMatch", { q: filter.trim() })}
          </p>
        ) : null}
        <nav
          aria-label={t("outline.title")}
          ref={navRef}
          onKeyDown={(e) => {
            // Up from the first heading goes back to the filter box.
            if (e.key === "ArrowUp" && e.target === navRef.current?.querySelector("a")) {
              e.preventDefault();
              filterRef.current?.focus();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              const links = [...(navRef.current?.querySelectorAll<HTMLElement>("a") ?? [])];
              const at = links.indexOf(e.target as HTMLElement);
              const next = links[at + (e.key === "ArrowDown" ? 1 : -1)];
              if (at >= 0 && next) {
                e.preventDefault();
                next.focus();
              }
            }
          }}
        >
          {shown.map((h, i) => (
            <a
              key={`${h.id}-${i}`}
              href={`#${h.id}`}
              className={`outline-link h${h.depth}${activeId === h.id ? " active" : ""}`}
              aria-current={activeId === h.id ? "location" : undefined}
              // A Hebrew heading in an English UI (and the reverse) keeps
              // its own direction (T45).
              dir="auto"
              onClick={(e) => {
                e.preventDefault();
                const el = document.getElementById(h.id);
                if (el) el.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
                // The sheet covers the text: picking a heading closes it.
                if (sheet) useAppStore.getState().toggleOutline();
              }}
            >
              {filter.trim() ? (
                <bdi>{highlightParts(h.text, filter).map((p, j) => (p.hit ? <mark key={j} style={MARK}>{p.text}</mark> : <React.Fragment key={j}>{p.text}</React.Fragment>))}</bdi>
              ) : (
                <bdi>{h.text}</bdi>
              )}
            </a>
          ))}
        </nav>
        </>
      )}
    </aside>
  );
});
