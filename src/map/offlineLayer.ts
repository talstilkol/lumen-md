/**
 * The offline basemap as a Leaflet layer (plan W13.G3): a GridLayer whose
 * tiles are drawn from the PMTiles archive in the vault — vector tiles by
 * ./tileRender.ts, raster tiles (PNG / JPEG / WebP) as images. Past the
 * archive's last zoom the last level is drawn larger (overzoom), so a
 * regional extract stays usable down to the street. No tile is fetched.
 */
import type * as Leaflet from "leaflet";
import { decodeTile } from "./mvt";
import { TileType, type PMTiles, type Header } from "./pmtiles";
import { DARK, drawTile, LIGHT } from "./tileRender";

const MIME: Partial<Record<TileType, string>> = { [TileType.Png]: "image/png", [TileType.Jpeg]: "image/jpeg", [TileType.Webp]: "image/webp", [TileType.Avif]: "image/avif" };

export interface OfflineLayerOptions {
  lang: string;
  dark?: boolean;
  attribution: string;
}

/** Draw tile z/x/y of `archive` into `canvas` (size × size). Resolves to false when the archive has nothing there. */
export async function drawArchiveTile(archive: PMTiles, header: Header, canvas: HTMLCanvasElement, z: number, x: number, y: number, size: number, opts: Pick<OfflineLayerOptions, "lang" | "dark">): Promise<boolean> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  // Overzoom: past the last level, draw the covering tile of the last level, larger.
  const dz = Math.max(0, z - header.maxZoom);
  const f = 2 ** dz;
  const pz = z - dz;
  const px = Math.floor(x / f);
  const py = Math.floor(y / f);
  const bytes = await archive.getTile(pz, px, py);
  if (!bytes) return false;
  ctx.save();
  const ox = (x - px * f) * size;
  const oy = (y - py * f) * size;
  ctx.translate(-ox, -oy);
  try {
    if (header.tileType === TileType.Mvt) {
      // The visible part of the (larger) covering tile: its labels fit inside it (audit r4 A3 #7).
      drawTile(ctx, decodeTile(bytes), size * f, { lang: opts.lang, palette: opts.dark ? DARK : LIGHT, zoom: z, view: [ox, oy, ox + size, oy + size] });
    } else {
      const type = MIME[header.tileType];
      if (!type) return false;
      const img = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
      ctx.imageSmoothingEnabled = dz < 3;
      ctx.drawImage(img, 0, 0, size * f, size * f);
      img.close?.();
    }
  } finally {
    ctx.restore();
  }
  return true;
}

/** A Leaflet layer over the archive. */
export function offlineTileLayer(L: typeof Leaflet, archive: PMTiles, header: Header, opts: OfflineLayerOptions): Leaflet.GridLayer {
  const Layer = L.GridLayer.extend({
    createTile(coords: Leaflet.Coords, done: (err: Error | undefined, tile: HTMLElement) => void) {
      const size = 256;
      const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size * dpr;
      canvas.style.width = canvas.style.height = `${size}px`;
      const ctx = canvas.getContext("2d");
      ctx?.scale(dpr, dpr);
      drawArchiveTile(archive, header, canvas, coords.z, coords.x, coords.y, size, opts)
        .then(() => done(undefined, canvas))
        .catch((e: unknown) => done(e instanceof Error ? e : new Error(String(e)), canvas));
      return canvas;
    },
  });
  const bounds = header.maxLon > header.minLon ? L.latLngBounds([header.minLat, header.minLon], [header.maxLat, header.maxLon]) : undefined;
  return new (Layer as unknown as new (o: Leaflet.GridLayerOptions) => Leaflet.GridLayer)({
    attribution: opts.attribution.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!),
    minZoom: 0,
    maxZoom: 20,
    maxNativeZoom: undefined,
    bounds,
    tileSize: 256,
    className: "lumen-offline-basemap",
  });
}

/**
 * Add the vault's offline basemap to `map` when there is one. Resolves to
 * true when it was added (the caller then adds no network tiles).
 */
export async function addOfflineBasemap(L: typeof Leaflet, map: Leaflet.Map, opts: { lang: string; dark?: boolean }): Promise<boolean> {
  const { activeOfflineMap } = await import("./offlineStore");
  const active = await activeOfflineMap().catch(() => null);
  if (!active) return false;
  const header = await active.archive.getHeader();
  offlineTileLayer(L, active.archive, header, { ...opts, attribution: active.info.attribution }).addTo(map);
  return true;
}
