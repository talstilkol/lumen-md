import { useEffect, useRef, useState } from "react";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let initializedFor: "dark" | "light" | null = null;

async function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  const mermaid = await mermaidPromise;
  const dark = document.documentElement.classList.contains("dark");
  const wantTheme: "dark" | "light" = dark ? "dark" : "light";
  if (initializedFor !== wantTheme) {
    mermaid.initialize({
      startOnLoad: false,
      theme: dark ? "dark" : "default",
      securityLevel: "strict",
      fontFamily:
        "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
      themeVariables: dark
        ? {
            background: "transparent",
            primaryColor: "#27314a",
            primaryTextColor: "#e7eaf3",
            primaryBorderColor: "#3b4760",
            lineColor: "#7c5cff",
            secondaryColor: "#1f2533",
            tertiaryColor: "#1a1f2c",
          }
        : {
            background: "transparent",
            primaryColor: "#eef2ff",
            primaryTextColor: "#0f172a",
            primaryBorderColor: "#c7d2fe",
            lineColor: "#7c5cff",
          },
    });
    initializedFor = wantTheme;
  }
  return mermaid;
}

function useThemeKey(): string {
  const [key, setKey] = useState(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setKey(
        document.documentElement.classList.contains("dark")
          ? "dark"
          : "light",
      ),
    );
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);
  return key;
}

let counter = 0;

interface Props {
  source: string;
}

export default function MermaidBlock({ source }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Defer the 2.7 MB Mermaid runtime download until the diagram is actually
  // about to enter the viewport. Long docs with mermaid blocks below the
  // fold no longer pay the cost up-front.
  const [inView, setInView] = useState(false);
  const themeKey = useThemeKey();

  useEffect(() => {
    if (!ref.current || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      // SSR / very old browsers — render eagerly so the doc still works.
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
      { rootMargin: "300px 0px" }, // start fetching 300px before scroll arrives
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [inView]);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const mermaid = await getMermaid();
        const id = `lumen-mermaid-${++counter}`;
        const { svg, bindFunctions } = await mermaid.render(id, source);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        bindFunctions?.(ref.current);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, themeKey, inView]);

  if (error) {
    return (
      <div className="mermaid-block">
        <div className="mermaid-error">⚠︎ Mermaid error:{"\n"}{error}</div>
      </div>
    );
  }
  return (
    <div className="mermaid-block" ref={ref}>
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
          Mermaid diagram (scroll to render)
        </div>
      )}
    </div>
  );
}
