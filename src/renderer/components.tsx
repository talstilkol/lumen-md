import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import type { JSX } from "react";
import { isAssetName, readWorkspaceBlob } from "../storage/workspace";

const ChartBlock = lazy(() => import("../plugins/ChartBlock"));
const MermaidBlock = lazy(() => import("../plugins/MermaidBlock"));
const CsvBlock = lazy(() => import("../plugins/CsvBlock"));
const JsonTableBlock = lazy(() => import("../plugins/JsonTableBlock"));
const MapBlock = lazy(() => import("../plugins/MapBlock"));
const GraphvizBlock = lazy(() => import("../plugins/GraphvizBlock"));
const AbcBlock = lazy(() => import("../plugins/AbcBlock"));
const Model3DBlock = lazy(() => import("../plugins/Model3DBlock"));
const PlantUMLBlock = lazy(() => import("../plugins/PlantUMLBlock"));
const EmbedBlock = lazy(() => import("../plugins/EmbedBlock"));
const HtmlPreviewBlock = lazy(() => import("../plugins/HtmlPreviewBlock"));
const BibtexBlock = lazy(() => import("../plugins/BibtexBlock"));

function getText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children))
    return children
      .map((c) => (typeof c === "string" ? c : ""))
      .join("");
  return "";
}

function PluginFallback({ label }: { label: string }) {
  return (
    <div
      style={{
        margin: "1.25rem 0",
        padding: "1rem",
        border: "1px dashed hsl(var(--border-strong))",
        borderRadius: "0.5rem",
        background: "hsl(var(--bg-subtle))",
        color: "hsl(var(--fg-muted))",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, sans-serif",
        fontSize: "13px",
      }}
    >
      Loading {label}…
    </div>
  );
}

function withSuspense<P extends object>(
  Component: ComponentType<P>,
  label: string,
): ComponentType<P> {
  return function Wrapped(props: P) {
    return (
      <Suspense fallback={<PluginFallback label={label} />}>
        <Component {...props} />
      </Suspense>
    );
  };
}

interface BlockProps {
  children?: React.ReactNode;
  lang?: string;
  meta?: string;
}

const Chart = withSuspense<BlockProps>(
  (props) => <ChartBlock source={getText(props.children)} meta={props.meta} />,
  "chart",
);

const Mermaid = withSuspense<BlockProps>(
  (props) => <MermaidBlock source={getText(props.children)} />,
  "diagram",
);

const Csv = withSuspense<BlockProps>(
  (props) => (
    <CsvBlock
      source={getText(props.children)}
      lang={(props.lang as "csv" | "tsv") ?? "csv"}
      meta={props.meta}
    />
  ),
  "data",
);

const JsonTable = withSuspense<BlockProps>(
  (props) => <JsonTableBlock source={getText(props.children)} meta={props.meta} />,
  "data",
);

const MapView = withSuspense<BlockProps>(
  (props) => (
    <MapBlock
      source={getText(props.children)}
      lang={(props.lang as "map" | "geojson") ?? "map"}
    />
  ),
  "map",
);

const Graphviz = withSuspense<BlockProps>(
  (props) => <GraphvizBlock source={getText(props.children)} meta={props.meta} />,
  "diagram",
);

const Abc = withSuspense<BlockProps>(
  (props) => <AbcBlock source={getText(props.children)} />,
  "music",
);

const Model = withSuspense<BlockProps>(
  (props) => <Model3DBlock source={getText(props.children)} meta={props.meta} />,
  "3D model",
);

const PlantUML = withSuspense<BlockProps>(
  (props) => <PlantUMLBlock source={getText(props.children)} />,
  "diagram",
);

const Embed = withSuspense<BlockProps>(
  (props) => <EmbedBlock source={getText(props.children)} />,
  "embed",
);

const HtmlPreview = withSuspense<BlockProps>(
  (props) => (
    <HtmlPreviewBlock source={getText(props.children)} meta={props.meta} />
  ),
  "html preview",
);

const Bibtex = withSuspense<BlockProps>(
  (props) => <BibtexBlock source={getText(props.children)} />,
  "bibliography",
);

/**
 * Asset-aware <img> wrapper. If `src` looks like an OPFS asset (`lumen-asset-*`
 * or `./lumen-asset-*`), resolve it to a blob URL on first render. Cached blob
 * URLs survive across re-renders within the page lifetime (no revoke); OPFS
 * assets are tiny relative to a long-lived editor session, so this is a fair
 * trade.
 */
const blobUrlCache = new Map<string, string>();

function isOpfsAssetSrc(src: string | undefined): src is string {
  if (!src) return false;
  if (/^[a-z]+:/i.test(src)) return false; // http:, data:, blob:, etc.
  const stripped = src.replace(/^\.\//, "").replace(/^\//, "");
  return isAssetName(stripped);
}

interface ImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string;
}

function LumenImg(props: ImgProps) {
  const { src, ...rest } = props;
  const [resolved, setResolved] = useState<string | undefined>(() =>
    isOpfsAssetSrc(src) ? blobUrlCache.get(normalize(src!)) : src,
  );
  useEffect(() => {
    if (!isOpfsAssetSrc(src)) {
      setResolved(src);
      return;
    }
    const key = normalize(src);
    const cached = blobUrlCache.get(key);
    if (cached) {
      setResolved(cached);
      return;
    }
    let cancelled = false;
    readWorkspaceBlob(key)
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        blobUrlCache.set(key, url);
        setResolved(url);
      })
      .catch(() => {
        if (!cancelled) setResolved(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);
  // eslint-disable-next-line jsx-a11y/alt-text
  return <img {...rest} src={resolved} />;
}

function normalize(src: string): string {
  return src.replace(/^\.\//, "").replace(/^\//, "");
}

/**
 * Click-to-copy support for Shiki code blocks.
 * Mounted once at the document root by the Preview component.
 */
export function CopyButtonHandler() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest("[data-copy]") as HTMLElement | null;
      if (!btn) return;
      e.preventDefault();
      const text = btn.getAttribute("data-copy") ?? "";
      navigator.clipboard?.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = original;
        }, 1100);
      });
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}

// rehype-react expects a record of lowercase tag names → React components.
// Custom tag names use kebab-case so they pass through unchanged.
export const components: Record<string, ComponentType<JSX.IntrinsicAttributes & BlockProps>> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "lumen-chart": Chart as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "lumen-mermaid": Mermaid as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "lumen-csv": Csv as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "lumen-tsv": Csv as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "lumen-jsontable": JsonTable as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "lumen-map": MapView as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "lumen-geojson": MapView as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "lumen-dot": Graphviz as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "lumen-abc": Abc as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "lumen-model": Model as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "lumen-plantuml": PlantUML as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "lumen-embed": Embed as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "lumen-htmlpreview": HtmlPreview as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "lumen-bibtex": Bibtex as any,
  // Asset-resolving <img> override.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  img: LumenImg as any,
};
