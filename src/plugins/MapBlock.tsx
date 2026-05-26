import { useEffect, useRef, useState } from "react";
import YAML from "yaml";
import { t } from "../i18n";

interface Props {
  source: string;
  lang: "map" | "geojson";
}

interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  color?: string;
}

interface MapSpec {
  center?: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  geojson?: unknown;
}

function parseSpec(source: string, lang: "map" | "geojson"): MapSpec | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  try {
    if (lang === "geojson") {
      const geojson = JSON.parse(trimmed);
      return { geojson };
    }
    // try JSON, then YAML
    try {
      return JSON.parse(trimmed) as MapSpec;
    } catch {
      return YAML.parse(trimmed) as MapSpec;
    }
  } catch {
    return null;
  }
}

let leafletPromise: Promise<typeof import("leaflet")> | null = null;
async function getLeaflet() {
  if (!leafletPromise) {
    // load Leaflet CSS once
    const cssId = "leaflet-css";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    leafletPromise = import("leaflet");
  }
  return leafletPromise;
}

export default function MapBlock({ source, lang }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  // Defer heavy Leaflet load until the map enters viewport.
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
    const spec = parseSpec(source, lang);
    if (!spec || !mapRef.current) return;
    let cancelled = false;
    let mapInstance: import("leaflet").Map | null = null;
    (async () => {
      const L = await getLeaflet();
      if (cancelled || !mapRef.current) return;

      // Default center: world
      let center: [number, number] = spec.center ?? [20, 0];
      let zoom = spec.zoom ?? 2;
      const markers = spec.markers ?? [];

      if (markers.length > 0 && !spec.center) {
        const lats = markers.map((m) => m.lat);
        const lngs = markers.map((m) => m.lng);
        center = [
          (Math.min(...lats) + Math.max(...lats)) / 2,
          (Math.min(...lngs) + Math.max(...lngs)) / 2,
        ];
        zoom = markers.length === 1 ? 10 : 4;
      }

      mapInstance = L.map(mapRef.current, {
        center,
        zoom,
        scrollWheelZoom: false,
      });

      L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        },
      ).addTo(mapInstance);

      for (const m of markers) {
        const marker = L.marker([m.lat, m.lng]).addTo(mapInstance);
        if (m.label) marker.bindPopup(m.label);
      }

      if (spec.geojson) {
        const layer = L.geoJSON(
          spec.geojson as GeoJSON.GeoJsonObject,
          {
            style: {
              color: "#7c5cff",
              weight: 2,
              fillOpacity: 0.15,
            },
          },
        ).addTo(mapInstance);
        try {
          mapInstance.fitBounds(layer.getBounds(), { padding: [16, 16] });
        } catch {
          /* empty geojson */
        }
      }
    })();

    return () => {
      cancelled = true;
      mapInstance?.remove();
    };
  }, [source, lang]);

  return (
    <div className="chart-block" ref={containerRef}>
      <div className="chart-block-header">
        <span>{t("plugin.map")}</span>
      </div>
      <div ref={mapRef} style={{ height: 360, width: "100%" }} />
    </div>
  );
}
