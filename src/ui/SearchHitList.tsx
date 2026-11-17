/**
 * The search results as a virtual list (plan W13.V3): a vault search with
 * thousands of matches keeps a few dozen rows in the DOM, whatever its size.
 * Every row has the same height — name and path, the snippet, and the
 * "matched as …" line (R12.16), each one line — so a page arriving below,
 * or the explanation of a match, never moves what is on screen.
 */
import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { FileText } from "lucide-react";
import type { SearchHit } from "../storage/workspaceIndex";
import { MatchedAsLine, renderSnippet, SNIPPET_STYLE } from "./searchSnippet";

/** One row, in CSS px: three lines and the padding (.cmd-palette-item). */
export const HIT_ROW_HEIGHT = 66;
/** Rows drawn above and below the visible ones. */
export const HIT_OVERSCAN = 8;

/** The rows to draw for a scroll position: [start, end). */
export function visibleRange(count: number, scrollTop: number, viewport: number, rowH = HIT_ROW_HEIGHT, overscan = HIT_OVERSCAN): [number, number] {
  const first = Math.floor(Math.max(0, scrollTop) / rowH);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(viewport, rowH)) / rowH);
  return [Math.max(0, first - overscan), Math.min(count, last + overscan)];
}

const ONE_LINE = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

interface Props {
  hits: SearchHit[];
  active: number;
  setActive: (i: number) => void;
  onOpen: (hit: SearchHit) => void;
  query: string;
  showMatchedAs: boolean;
  /** The scrolling list the rows live in (.cmd-palette-list). */
  scrollRef: RefObject<HTMLDivElement | null>;
}

export function SearchHitList({ hits, active, setActive, onOpen, query, showMatchedAs, scrollRef }: Props) {
  const [view, setView] = useState({ top: 0, height: 600, offset: 0 });
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root || !host) return;
    const measure = () => setView({ top: root.scrollTop, height: root.clientHeight || 600, offset: host.offsetTop - root.offsetTop });
    measure();
    root.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    return () => {
      root.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, [scrollRef, host]);

  // The keyboard's row is kept in view, drawn or not.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !host || active < 0 || active >= hits.length) return;
    const top = host.offsetTop - root.offsetTop + active * HIT_ROW_HEIGHT;
    if (top < root.scrollTop) root.scrollTop = top;
    else if (top + HIT_ROW_HEIGHT > root.scrollTop + root.clientHeight) root.scrollTop = top + HIT_ROW_HEIGHT - root.clientHeight;
  }, [active, hits.length, scrollRef, host]);

  const [start, end] = visibleRange(hits.length, view.top - view.offset, view.height);
  return (
    <div ref={setHost} data-testid="search-hit-list" data-count={hits.length} style={{ position: "relative", blockSize: hits.length * HIT_ROW_HEIGHT }}>
      {hits.slice(start, end).map((hit, k) => {
        const i = start + k;
        return (
          <div
            key={hit.path}
            data-search-index={i}
            className={`cmd-palette-item ${i === active ? "active" : ""}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => onOpen(hit)}
            style={{ position: "absolute", insetInline: 0, insetBlockStart: i * HIT_ROW_HEIGHT, blockSize: HIT_ROW_HEIGHT - 2, alignItems: "flex-start", overflow: "hidden", boxSizing: "border-box" }}
            title={hit.path}
          >
            <FileText size={14} style={{ opacity: 0.7, marginTop: 1, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="cmd-palette-label" style={{ fontWeight: 500, ...ONE_LINE }}>
                <bdi>{hit.name}</bdi>
                {hit.path !== hit.name && (
                  <span style={{ color: "hsl(var(--fg-muted))", fontWeight: 400, marginInlineStart: 6, fontSize: 11 }}>
                    <bdi>{hit.path}</bdi>
                  </span>
                )}
              </div>
              <div style={{ ...SNIPPET_STYLE, ...ONE_LINE, minBlockSize: "1.3em" }}>{hit.snippet ? renderSnippet(hit) : null}</div>
              <div style={{ ...ONE_LINE, minBlockSize: "1.2em" }}>{showMatchedAs && <MatchedAsLine query={query} hit={hit} />}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
