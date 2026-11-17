/**
 * The offline map's settings (plan W13.G3): which basemap is in the vault
 * (region, zooms, size, credit), import a .pmtiles file the user downloaded,
 * remove it. The app never downloads a basemap itself: the panel says where
 * to get one and the user brings the file — so no new network path.
 */
import { useEffect, useId, useRef, useState } from "react";
import { t } from "../i18n";
import { importOfflineMap, listOfflineMaps, removeOfflineMap, type MapVault, type OfflineMapInfo } from "./offlineStore";
import "./offlineMapStrings";

const btn: React.CSSProperties = { fontSize: 12, padding: "3px 10px", borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit" };
const mb = (n: number) => `${(n / 1_048_576).toFixed(n < 10 * 1_048_576 ? 1 : 0)} MB`;

export default function OfflineMapPanel({ vault, onChange }: { vault?: MapVault; onChange?: () => void }) {
  const id = useId();
  const [maps, setMaps] = useState<OfflineMapInfo[] | null>(null);
  const [status, setStatus] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const refresh = () =>
    listOfflineMaps(vault)
      .then(setMaps)
      .catch(() => setMaps([]));
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setStatus(t("map.offline.importing", { name: f.name }));
    try {
      const info = await importOfflineMap(f, vault);
      setStatus(t("map.offline.imported", { name: info.name }));
      await refresh();
      onChange?.();
    } catch (e) {
      setStatus(t("map.offline.bad", { error: e instanceof Error ? e.message : String(e) }));
    }
    if (input.current) input.current.value = "";
  };

  return (
    <section aria-labelledby={`${id}-t`} data-testid="offline-map-panel" style={{ display: "grid", gap: 8, fontSize: 13, padding: 12 }}>
      <h3 id={`${id}-t`} style={{ margin: 0, fontSize: 14 }}>
        {t("map.offline.title")}
      </h3>
      <p style={{ margin: 0, color: "hsl(var(--fg-muted))" }}>{t("map.offline.about")}</p>
      {maps === null ? null : maps.length === 0 ? (
        <p style={{ margin: 0 }} data-testid="offline-map-none">
          {t("map.offline.none")}
        </p>
      ) : (
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          {maps.map((m) => (
            <li key={m.path} data-map={m.path}>
              {/* Each part isolated (audit r4 A3 #13): in a Hebrew line "0.0 MB" read "MB 0.0" and the zoom range ran backwards. */}
              <bdi dir="auto" data-part="name">{m.name}</bdi> · <bdi dir="ltr" data-part="size">{mb(m.size)}</bdi> · <bdi data-part="zooms">{t("map.offline.zooms", { min: String(m.header.minZoom), max: String(m.header.maxZoom) })}</bdi> ·{" "}
              <bdi dir="ltr" data-part="bbox">
                {m.header.minLat.toFixed(2)},{m.header.minLon.toFixed(2)} – {m.header.maxLat.toFixed(2)},{m.header.maxLon.toFixed(2)}
              </bdi>
              <br />
              <small dir="auto">
                <bdi>{m.attribution}</bdi>
              </small>{" "}
              <button
                type="button"
                style={btn}
                onClick={async () => {
                  await removeOfflineMap(m.path, vault);
                  setStatus(t("map.offline.removed", { name: m.name }));
                  await refresh();
                  onChange?.();
                }}
              >
                {t("map.offline.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={btn}>
          {t("map.offline.import")}
          <input ref={input} type="file" accept=".pmtiles,application/vnd.pmtiles" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="offline-map-file" />
        </label>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "hsl(var(--fg-muted))" }}>
        {t("map.offline.where")} <code dir="ltr">pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles israel.pmtiles --bbox=34.2,29.4,35.9,33.4</code>
      </p>
      <p role="status" aria-live="polite" style={{ margin: 0 }} data-testid="offline-map-status">
        {status}
      </p>
    </section>
  );
}
