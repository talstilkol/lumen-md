import { Component, lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import type { JSX } from "react";
import { isAssetName, readWorkspaceBlob } from "../storage/workspace";
import { log } from "../lib/logger";

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
const DataBlock = lazy(() => import("../plugins/DataBlock"));
const DatabaseBlock = lazy(() => import("../views/DatabaseBlock"));
const LiveCssBlock = lazy(() => import("../plugins/LiveCssBlock"));
const LiveJsBlock = lazy(() => import("../plugins/LiveJsBlock"));
const LiveSvgBlock = lazy(() => import("../plugins/LiveSvgBlock"));
const LiveGlslBlock = lazy(() => import("../plugins/LiveGlslBlock"));

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

/**
 * Per-block error boundary so a single broken Mermaid / Graphviz / EChart
 * spec doesn't crash the entire preview pipeline. The fallback renders a
 * compact error card with the message — the rest of the document keeps
 * rendering as if nothing happened.
 */
class BlockErrorBoundary extends Component<
  { label: string; children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    // Log so the issue surfaces in dev tools / Sentry; don't toast — the
    // visible error card already conveys the problem to the reader.
    log.error(`[lumen-block:${this.props.label}]`, error);
  }
  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          style={{
            margin: "12px 0",
            padding: "10px 14px",
            border: "1px solid hsl(0 80% 60% / 0.4)",
            borderRadius: 8,
            background: "hsl(0 80% 60% / 0.08)",
            color: "hsl(0 80% 70%)",
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          ⚠︎ {this.props.label} render failed: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function withSuspense<P extends object>(
  Component: ComponentType<P>,
  label: string,
): ComponentType<P> {
  return function Wrapped(props: P) {
    return (
      <BlockErrorBoundary label={label}>
        <Suspense fallback={<PluginFallback label={label} />}>
          <Component {...props} />
        </Suspense>
      </BlockErrorBoundary>
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

// `lumen-data` covers the SQL / Pandas / JS-object / auto-detect family.
// The fence language flows through as `props.lang` so DataBlock can pick
// the right parser. All four use the same DataTable + chart-suggestion UI.
const DataBlockComp = withSuspense<BlockProps>(
  (props) => (
    <DataBlock
      source={getText(props.children)}
      meta={props.meta}
      lang={(props.lang as "sql" | "pandas" | "object" | "data") ?? "data"}
    />
  ),
  "data",
);

const Database = withSuspense<BlockProps>(
  (props) => (
    <DatabaseBlock source={getText(props.children)} meta={props.meta} />
  ),
  "database",
);

const LiveCss = withSuspense<BlockProps>(
  (props) => <LiveCssBlock source={getText(props.children)} meta={props.meta} />,
  "live-css",
);
const LiveJs = withSuspense<BlockProps>(
  (props) => <LiveJsBlock source={getText(props.children)} meta={props.meta} />,
  "live-js",
);
const LiveSvg = withSuspense<BlockProps>(
  (props) => <LiveSvgBlock source={getText(props.children)} meta={props.meta} />,
  "live-svg",
);
const LiveGlsl = withSuspense<BlockProps>(
  (props) => <LiveGlslBlock source={getText(props.children)} meta={props.meta} />,
  "live-glsl",
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
  // The author-supplied `alt` is forwarded via {...rest}. We default to
  // the basename of the src when nothing is provided so screen-readers
  // get something descriptive instead of "image".
  const fallbackAlt = !rest.alt
    ? (src ?? "").split("/").pop()?.replace(/\.[^.]+$/, "") ?? "image"
    : undefined;
  return <img alt={fallbackAlt} {...rest} src={resolved} />;
}

function normalize(src: string): string {
  return src.replace(/^\.\//, "").replace(/^\//, "");
}

/**
 * GFM task-list checkbox override — adds aria-label so screen readers can
 * announce the task text instead of an unlabeled "checkbox".
 */
function LumenInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  if (props.type === "checkbox") {
    return <input {...props} aria-label={props["aria-label"] ?? "task"} />;
  }
  return <input {...props} />;
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
// Each plugin component reads only the props it needs; the cast widens its
// signature to the shared block-props shape so the registry types check.
type LumenBlock = ComponentType<JSX.IntrinsicAttributes & BlockProps>;

export const components: Record<string, LumenBlock> = {
  "lumen-chart": Chart as unknown as LumenBlock,
  "lumen-mermaid": Mermaid as unknown as LumenBlock,
  "lumen-csv": Csv as unknown as LumenBlock,
  "lumen-tsv": Csv as unknown as LumenBlock,
  "lumen-jsontable": JsonTable as unknown as LumenBlock,
  "lumen-map": MapView as unknown as LumenBlock,
  "lumen-geojson": MapView as unknown as LumenBlock,
  "lumen-dot": Graphviz as unknown as LumenBlock,
  "lumen-abc": Abc as unknown as LumenBlock,
  "lumen-model": Model as unknown as LumenBlock,
  "lumen-plantuml": PlantUML as unknown as LumenBlock,
  "lumen-embed": Embed as unknown as LumenBlock,
  "lumen-htmlpreview": HtmlPreview as unknown as LumenBlock,
  "lumen-bibtex": Bibtex as unknown as LumenBlock,
  "lumen-data": DataBlockComp as unknown as LumenBlock,
  "lumen-database": Database as unknown as LumenBlock,
  "lumen-livecss": LiveCss as unknown as LumenBlock,
  "lumen-livejs": LiveJs as unknown as LumenBlock,
  "lumen-livesvg": LiveSvg as unknown as LumenBlock,
  "lumen-liveglsl": LiveGlsl as unknown as LumenBlock,
  // Asset-resolving <img> override.
  img: LumenImg as unknown as LumenBlock,
  // GFM task-list checkboxes get an aria-label so they aren't announced bare.
  input: LumenInput as unknown as LumenBlock,
};
