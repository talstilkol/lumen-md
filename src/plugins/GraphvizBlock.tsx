import { useEffect, useRef, useState } from "react";

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

export default function GraphvizBlock({ source, meta }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Engine: dot (default), neato, fdp, twopi, circo, sfdp, osage, patchwork.
  const engineMatch = meta?.match(/engine=([\w]+)/);
  const engine = engineMatch?.[1] ?? "dot";

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const gv = await getGraphviz();
        const svg = gv.layout(source, "svg", engine);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
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
  return <div className="mermaid-block" ref={ref} />;
}
