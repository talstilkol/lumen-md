import { useEffect, useRef, useState } from "react";
import YAML from "yaml";
import { sanitizeUrl } from "../lib/urlSanitizer";

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Defer model-viewer script + heavy 3D load until visible.
  const [inView, setInView] = useState(false);

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
    ensureModelViewerLoaded();
  }, [inView]);

  const spec = parseSpec(source);
  const heightMatch = meta?.match(/height=(\d+)/);
  const height = heightMatch ? Number(heightMatch[1]) : 360;
  const isSourceSafe = Boolean(spec?.src && sanitizeUrl(spec.src));
  const isPosterSafe = !spec?.poster || sanitizeUrl(spec.poster);

  useEffect(() => {
    if (!inView || !spec || !isSourceSafe || !isPosterSafe) return;
    const container = hostRef.current;
    if (!container) return;
    container.innerHTML = "";
    const viewer = document.createElement("model-viewer") as HTMLElement;
    viewer.setAttribute("src", spec.src);
    if (spec.poster) viewer.setAttribute("poster", spec.poster);
    if (spec.alt) viewer.setAttribute("alt", spec.alt);
    if (spec.autoRotate !== false) viewer.setAttribute("auto-rotate", "");
    viewer.setAttribute("camera-controls", "");
    if (typeof spec.shadowIntensity === "number") {
      viewer.setAttribute("shadow-intensity", String(spec.shadowIntensity));
    }
    viewer.setAttribute("style", "width: 100%; height: 100%; --poster-color: transparent;");
    container.appendChild(viewer);
  }, [spec, isSourceSafe, isPosterSafe, inView]);

  if (!spec || !spec.src) {
    return (
      <div className="chart-block" style={{ padding: "1rem" }}>
        <div style={{ color: "hsl(0 80% 60%)", fontSize: 13 }}>
          ⚠︎ 3D block needs at least a `src` URL (gltf or glb).
        </div>
      </div>
    );
  }

  if (!isSourceSafe || !isPosterSafe) {
    return (
      <div className="chart-block">
        <div style={{ padding: "1rem", color: "hsl(0 80% 60%)", fontSize: 13 }}>
          ⚠︎ 3D block contains unsafe asset URL.
        </div>
      </div>
    );
  }

  return (
    <div className="chart-block" ref={containerRef}>
      <div className="chart-block-header">
        <span>3D · {spec.alt ?? new URL(spec.src, location.href).pathname.split("/").pop()}</span>
      </div>
      <div ref={hostRef} style={{ height, background: spec.background ?? "transparent" }} />
    </div>
  );
}
