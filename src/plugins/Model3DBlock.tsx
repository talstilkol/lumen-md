import { useEffect, useRef } from "react";
import YAML from "yaml";

interface Props {
  source: string;
  meta?: string;
}

interface ModelSpec {
  src: string;
  alt?: string;
  poster?: string;
  /** auto-rotate (default true) */
  autoRotate?: boolean;
  /** background color */
  background?: string;
  /** shadow intensity 0..1 */
  shadowIntensity?: number;
}

let mvLoaded = false;
function ensureModelViewerLoaded() {
  if (mvLoaded) return;
  mvLoaded = true;
  // model-viewer is a Google web component; load via CDN to avoid bundle bloat.
  const id = "model-viewer-script";
  if (document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.type = "module";
  script.src =
    "https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js";
  document.head.appendChild(script);
}

function parseSpec(source: string): ModelSpec | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  // If it's just a URL, treat that as the src.
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    return { src: trimmed };
  }
  try {
    return JSON.parse(trimmed) as ModelSpec;
  } catch {
    /* fall through */
  }
  try {
    return YAML.parse(trimmed) as ModelSpec;
  } catch {
    return null;
  }
}

export default function Model3DBlock({ source, meta }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureModelViewerLoaded();
  }, []);

  const spec = parseSpec(source);
  const heightMatch = meta?.match(/height=(\d+)/);
  const height = heightMatch ? Number(heightMatch[1]) : 360;

  if (!spec || !spec.src) {
    return (
      <div className="chart-block" style={{ padding: "1rem" }}>
        <div style={{ color: "hsl(0 80% 60%)", fontSize: 13 }}>
          ⚠︎ 3D block needs at least a `src` URL (gltf or glb).
        </div>
      </div>
    );
  }

  return (
    <div className="chart-block">
      <div className="chart-block-header">
        <span>3D · {spec.alt ?? new URL(spec.src, location.href).pathname.split("/").pop()}</span>
      </div>
      <div
        ref={hostRef}
        style={{ height, background: spec.background ?? "transparent" }}
        // model-viewer is a custom element, so we render via dangerouslySetInnerHTML
        // to avoid TS jank with custom-element typings.
        dangerouslySetInnerHTML={{
          __html: `<model-viewer
            src="${escape(spec.src)}"
            ${spec.poster ? `poster="${escape(spec.poster)}"` : ""}
            ${spec.alt ? `alt="${escape(spec.alt)}"` : ""}
            ${spec.autoRotate !== false ? "auto-rotate" : ""}
            camera-controls
            shadow-intensity="${spec.shadowIntensity ?? 0.5}"
            style="width: 100%; height: 100%; --poster-color: transparent;"
          ></model-viewer>`,
        }}
      />
    </div>
  );
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
