import { useEffect, useRef, useState } from "react";
import { sanitizeSvgMarkup } from "../lib/markupSanitizer";

interface GraphvizInstance {
  layout(dot: string, format: string, engine: string): string;
}

let graphvizPromise: Promise<GraphvizInstance> | null = null;

async function getGraphviz() {
  if (!graphvizPromise) {
    graphvizPromise = (async () => {
      // Import the focused subpath so we don't pull in DuckDB / Expat / zstd.
      const mod = (await import("@hpcc-js/wasm/graphviz")) as {
        Graphviz: { load: () => Promise<GraphvizInstance> };
      };
      return await mod.Graphviz.load();
    })();
  }
  return graphvizPromise;
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
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<RenderState>("idle");
  const [durationMs, setDurationMs] = useState<number | null>(null);

  // Engine: dot (default), neato, fdp, twopi, circo, sfdp, osage, patchwork.
  const engineMatch = meta?.match(/engine=([\w]+)/);
  const engine = engineMatch?.[1] ?? "dot";

  useEffect(() => {
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
        if (!cancelled && ref.current) {
        ref.current.innerHTML = cached.svg;
        }
        return;
      }
      try {
        const started = performance.now();
        const gv = await getGraphviz();
        const svg = gv.layout(source, "svg", engine);
        if (cancelled || !ref.current) return;
        const cleanSvg = sanitizeSvgMarkup(svg);
        ref.current.innerHTML = cleanSvg;
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
  }, [source, engine]);

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
        : "Queued";
  return (
    <div className="mermaid-block">
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
      <div ref={ref} />
    </div>
  );
}
