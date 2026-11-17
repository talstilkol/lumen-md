import { lazy, Suspense, useEffect, useRef, useState } from "react";
import YAML from "yaml";
import { t } from "../i18n";
import { getLeaflet } from "./map/leaflet";
import { addBaseTiles } from "./map/tiles";
import "../map/offlineMapStrings";

// W13.G3: the offline basemap's panel, on demand.
const OfflineMapPanel = lazy(() => import("../map/OfflineMapPanel"));

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
  /** W13.G3: the vault's entities with a location (`location: 31.77, 35.21`), clustered. */
  entities?: boolean;
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

export default function MapBlock({ source, lang }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  // Defer heavy Leaflet load until the map enters viewport.
  const [inView, setInView] = useState(false);
  const [offline, setOffline] = useState(false);
  // A basemap imported or removed: draw the map again with it.
  const [redraw, setRedraw] = useState(0);

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

      addBaseTiles(L, mapInstance);

      for (const m of markers) {
        const marker = L.marker([m.lat, m.lng]).addTo(mapInstance);
        if (m.label) marker.bindPopup(m.label);
      }

      if (spec.entities) {
        const { addEntityMarkers } = await import("../map/entityMarkers");
        if (cancelled || !mapInstance) return;
        await addEntityMarkers(L, mapInstance, { fit: !spec.center && !markers.length && !spec.geojson });
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
          /* why: empty GeoJSON has no bounds: keep the default view */
        }
      }
    })();

    return () => {
      cancelled = true;
      mapInstance?.remove();
    };
  }, [source, lang, inView, redraw]);

  return (
    <div className="chart-block" ref={containerRef}>
      <div className="chart-block-header">
        <span>{t("plugin.map")}</span>
        <button type="button" className="chart-block-tab" aria-expanded={offline} onClick={() => setOffline((v) => !v)} data-testid="map-offline-toggle">
          {t("map.offline.toggle")}
        </button>
      </div>
      {offline && (
        <Suspense fallback={null}>
          <OfflineMapPanel onChange={() => setRedraw((n) => n + 1)} />
        </Suspense>
      )}
      <div ref={mapRef} style={{ height: 360, width: "100%" }} />
    </div>
  );
}
