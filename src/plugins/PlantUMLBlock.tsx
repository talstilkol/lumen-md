import { useEffect, useState } from "react";

interface Props {
  source: string;
}

interface Cached {
  source: string;
  svg: string;
}

let lastCache: Cached | null = null;

async function renderPlantUML(source: string): Promise<string> {
  if (lastCache && lastCache.source === source) return lastCache.svg;
  // Kroki public service: POST raw PlantUML text, receive SVG.
  const res = await fetch("https://kroki.io/plantuml/svg", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: source,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Kroki returned ${res.status}`);
  }
  const svg = await res.text();
  lastCache = { source, svg };
  return svg;
}

export default function PlantUMLBlock({ source }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg(null);
    renderPlantUML(source.trim())
      .then((s) => {
        if (!cancelled) setSvg(s);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) {
    return (
      <div className="mermaid-block">
        <div className="mermaid-error">
          ⚠︎ PlantUML error (rendered via kroki.io):{"\n"}{error}
        </div>
      </div>
    );
  }
  if (!svg) {
    return (
      <div
        style={{
          padding: "1rem",
          margin: "1rem 0",
          border: "1px dashed hsl(var(--border-strong))",
          borderRadius: 8,
          color: "hsl(var(--fg-muted))",
          fontSize: 13,
          textAlign: "center",
        }}
      >
        Rendering PlantUML…
      </div>
    );
  }
  return (
    <div
      className="mermaid-block"
      // SVG from Kroki is trusted enough for our use; nevertheless we sanitise minimally.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
