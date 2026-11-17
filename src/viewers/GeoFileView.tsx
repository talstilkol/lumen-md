/**
 * A GeoJSON or GPX file on a map (plan W12.F7), with a table of its features
 * beside it as the non-visual alternative. Leaflet is the app's self-hosted
 * copy (BSD-2), loaded with the viewer. The background tiles are the only
 * request and are skipped in airplane mode (../plugins/map/tiles).
 */
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { getLeaflet } from "../plugins/map/leaflet";
import { addBaseTiles } from "../plugins/map/tiles";
import { featureRows, type GeoCollection } from "./geoFile";
import { EmptyState, learnHow } from "../ui/EmptyState";

/** The kinds a row can have (./geoFile featureRows), named in the UI language; anything else is shown as the file has it. */
const KINDS = new Set(["waypoint", "track", "route", "Point", "LineString", "Polygon", "MultiPoint", "MultiLineString", "MultiPolygon"]);
const kindLabel = (k: string) => (KINDS.has(k) ? t(`fileViewer.geo.kind.${k}`) : k);

export function GeoFileView({ geo }: { geo: GeoCollection }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [tiles, setTiles] = useState<boolean | null>(null);
  const rows = featureRows(geo);

  useEffect(() => {
    if (!ref.current || geo.features.length === 0) return;
    let cancelled = false;
    let map: import("leaflet").Map | null = null;
    void getLeaflet().then((mod) => {
      const L = ((mod as { default?: typeof import("leaflet") }).default ?? mod) as typeof import("leaflet");
      if (cancelled || !ref.current) return;
      map = L.map(ref.current, { scrollWheelZoom: true });
      setTiles(addBaseTiles(L, map));
      const layer = L.geoJSON(geo as unknown as GeoJSON.GeoJsonObject, {
        style: { color: "#7c5cff", weight: 3 },
        onEachFeature: (f, l) => {
          const name = (f.properties as { name?: unknown } | null)?.name;
          if (typeof name === "string" && name) {
            // Text only: a name from the file is never parsed as HTML.
            const box = document.createElement("span");
            box.dir = "auto";
            box.textContent = name;
            l.bindPopup(box);
          }
        },
      }).addTo(map);
      const b = layer.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [16, 16], maxZoom: 16 });
      else map.setView([31.5, 34.9], 7);
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [geo]);

  return (
    <div className="geo-view">
      {geo.features.length > 0 ? (
        <div ref={ref} className="geo-map" role="img" aria-label={t("fileViewer.geo.mapLabel", { n: geo.features.length })} />
      ) : (
        <EmptyState message={t("fileViewer.geo.empty")} action={learnHow("workspace/file-viewers")} />
      )}
      {tiles === false && <p className="geo-note">{t("fileViewer.geo.noTiles")}</p>}
      <table className="geo-table">
        <caption>{t("fileViewer.geo.features", { n: rows.length })}</caption>
        <thead>
          <tr>
            <th scope="col">{t("fileViewer.geo.name")}</th>
            <th scope="col">{t("fileViewer.geo.type")}</th>
            <th scope="col">{t("fileViewer.geo.detail")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td dir="auto">{r.name}</td>
              <td>{kindLabel(r.type)}</td>
              <td dir="ltr">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
