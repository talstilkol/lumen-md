import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Word-style paginated page view with page numbers and navigation.
 * Wraps the Preview component's rendered content into A4-like pages.
 */

const PAGE_HEIGHT = 1056; // A4 at 96dpi ~ 1056px
const PAGE_WIDTH = 816; // A4 width at 96dpi

interface Props {
  children: React.ReactNode;
  totalContentHeight: number;
  onPageChange?: (page: number, total: number) => void;
}

export function PageView({ children, totalContentHeight, onPageChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(totalContentHeight / PAGE_HEIGHT));
  const [currentPage, setCurrentPage] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(totalPages, page));
      setCurrentPage(clamped);
      onPageChange?.(clamped, totalPages);
      if (containerRef.current) {
        containerRef.current.scrollTo({
          top: (clamped - 1) * (PAGE_HEIGHT + 40), // 40px gap between pages
          behavior: "smooth",
        });
      }
    },
    [totalPages, onPageChange],
  );

  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    for (let i = 1; i <= totalPages; i++) pages.push(i);
    return pages;
  }, [totalPages]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Navigation bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderBottom: "1px solid hsl(var(--border))",
          width: "100%",
          background: "hsl(var(--bg))",
          fontSize: 12,
          color: "hsl(var(--fg-muted))",
          flexShrink: 0,
        }}
      >
        <button
          className="icon-btn"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          style={{ padding: "2px 8px", fontSize: 11 }}
        >
          ◀
        </button>
        <select
          value={currentPage}
          onChange={(e) => goToPage(Number(e.target.value))}
          style={{
            background: "hsl(var(--bg-subtle))",
            color: "hsl(var(--fg))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 4,
            padding: "2px 6px",
            fontSize: 11,
          }}
        >
          {pageNumbers.map((p) => (
            <option key={p} value={p}>
              Page {p}
            </option>
          ))}
        </select>
        <span>of {totalPages}</span>
        <button
          className="icon-btn"
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
          style={{ padding: "2px 8px", fontSize: 11 }}
        >
          ▶
        </button>
      </div>

      {/* Page container */}
      <div
        ref={containerRef}
        onScroll={() => {
          if (!containerRef.current) return;
          const scrollTop = containerRef.current.scrollTop;
          const page = Math.floor(scrollTop / (PAGE_HEIGHT + 40)) + 1;
          const clamped = Math.max(1, Math.min(totalPages, page));
          if (clamped !== currentPage) {
            setCurrentPage(clamped);
            onPageChange?.(clamped, totalPages);
          }
        }}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "24px 0",
          background: "hsl(var(--bg-subtle) / 0.5)",
        }}
      >
        {/* Render pages */}
        {pageNumbers.map((pageNum) => (
          <div
            key={pageNum}
            style={{
              width: PAGE_WIDTH,
              minHeight: PAGE_HEIGHT,
              margin: "0 auto 40px",
              background: "hsl(var(--bg))",
              boxShadow: "0 2px 12px hsl(0 0% 0% / 0.15), 0 0 0 1px hsl(var(--border) / 0.3)",
              borderRadius: 2,
              padding: "72px 72px 72px 72px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Page content (CSS clip) */}
            <div
              style={{
                position: "absolute",
                top: 72,
                left: 72,
                right: 72,
                bottom: 72,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  transform: `translateY(-${(pageNum - 1) * (PAGE_HEIGHT - 144)}px)`,
                }}
              >
                {children}
              </div>
            </div>

            {/* Page number footer */}
            <div
              style={{
                position: "absolute",
                bottom: 24,
                left: 0,
                right: 0,
                textAlign: "center",
                fontSize: 10,
                color: "hsl(var(--fg-muted) / 0.4)",
                fontFamily: "Georgia, serif",
              }}
            >
              {pageNum}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
