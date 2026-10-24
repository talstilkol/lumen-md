import { useEffect, useRef, useState } from "react";
import { sanitizeSvgMarkup } from "../lib/markupSanitizer";
import { safeSetHtml } from "../lib/trustedTypes";

// Layout runs in ./graphviz.worker (F4): the only code that needs eval
// lives there, under its own CSP; the page itself allows none.
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (svg: string) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./graphviz.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<{ id: number; svg?: string; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error !== undefined) p.reject(new Error(e.data.error));
    else p.resolve(e.data.svg ?? "");
  };
  w.onerror = (e) => {
    e.preventDefault();
    for (const p of pending.values()) p.reject(new Error(e.message || "Graphviz worker failed"));
    pending.clear();
    worker = null;
  };
  worker = w;
  return w;
}

function layout(dot: string, engine: string): Promise<string> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, dot, engine });
  });
}

interface Props {
  source: string;
  meta?: string;
}

interface CacheEntry {
  key: string;
  svg: string;
}

type RenderState = "idle" | "rendering" | "ready" | "failed";

const cache = new Map<string, CacheEntry>();
const MAX_CACHE = 12;

export default function GraphvizBlock({ source, meta }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<RenderState>("idle");
  const [durationMs, setDurationMs] = useState<number | null>(null);
  // Defer the heavy WASM load + render until the diagram enters viewport.
  const [inView, setInView] = useState(false);

  // Engine: dot (default), neato, fdp, twopi, circo, sfdp, osage, patchwork.
  const engineMatch = meta?.match(/engine=([\w]+)/);
  const engine = engineMatch?.[1] ?? "dot";

  useEffect(() => {
    if (!containerRef.current || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(containerRef.current);
    return () => io.disconnect();
  }, [inView]);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    const key = `${engine}::${source}`;
    setState("rendering");
    setDurationMs(null);
    setError(null);
    (async () => {
      const cached = cache.get(key);
      if (cached) {
        setState("ready");
        setDurationMs(null);
        if (!cancelled && contentRef.current) {
        safeSetHtml(contentRef.current, cached.svg, "svg");
        }
        return;
      }
      try {
        const started = performance.now();
        const svg = await layout(source, engine);
        if (cancelled || !contentRef.current) return;
        const cleanSvg = sanitizeSvgMarkup(svg);
        safeSetHtml(contentRef.current, cleanSvg, "svg");
        setDurationMs(Math.round(performance.now() - started));
        setState("ready");
        cache.set(key, { key, svg: cleanSvg });
        if (cache.size > MAX_CACHE) {
          const first = cache.keys().next().value;
          if (first) cache.delete(first);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, engine, inView]);

  if (error) {
    return (
      <div className="mermaid-block">
        <div className="mermaid-error">⚠︎ Graphviz error:{"\n"}{error}</div>
      </div>
    );
  }
  const statusText =
    state === "rendering"
      ? "Rendering…"
      : state === "ready"
        ? durationMs == null
          ? "Rendered (cache)"
          : `Rendered in ${durationMs} ms`
        : inView
          ? "Queued"
          : "Scroll to render";
  return (
    <div className="mermaid-block" ref={containerRef}>
      <div
        style={{
          padding: "0 10px 8px",
          fontSize: 11,
          color: "hsl(var(--fg-muted))",
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span>Graphviz · {engine}</span>
        <span>{statusText}</span>
      </div>
      <div ref={contentRef} />
      {!inView && (
        <div
          aria-busy="true"
          style={{
            padding: 18,
            color: "hsl(var(--fg-muted))",
            fontSize: 12,
            textAlign: "center",
          }}
        >
          Graphviz diagram (scroll to render)
        </div>
      )}
    </div>
  );
}
