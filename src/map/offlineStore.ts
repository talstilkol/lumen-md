/**
 * Offline basemaps in the vault (plan W13.G3): a regional PMTiles file the
 * user brings (Protomaps' Israel extract, say) is copied into
 * `.lumen/maps/` and every map draws from it — with no request to any tile
 * server, in airplane mode or not. The app never downloads one by itself:
 * the user picks the file (no new network path in the privacy ledger).
 */
import { blobSource, parseHeader, PMTiles, HEADER_BYTES, type Header } from "./pmtiles";

export const MAP_DIR = ".lumen/maps";
/** Set while a basemap is in the vault, so a map can tell at once that a background is coming. */
export const OFFLINE_FLAG = "lumen.map.offline";

export interface OfflineMapInfo {
  path: string;
  name: string;
  size: number;
  header: Header;
  attribution: string;
}

export interface MapVault {
  listWorkspaceFolder(path: string): Promise<string[]>;
  readWorkspaceBlob(path: string): Promise<Blob>;
  writeWorkspaceBlob(path: string, data: Blob): Promise<void>;
  deleteWorkspaceFile(path: string): Promise<void>;
}

const realVault = async (): Promise<MapVault> => import("../storage/workspace");

const setFlag = (on: boolean) => {
  try {
    if (on) localStorage.setItem(OFFLINE_FLAG, "1");
    else localStorage.removeItem(OFFLINE_FLAG);
  } catch {
    // why: no storage (private window): the flag is only a hint, the vault is the truth
  }
};
export const offlineHint = (): boolean => {
  try {
    return localStorage.getItem(OFFLINE_FLAG) === "1";
  } catch {
    // why: no storage: no hint
    return false;
  }
};

/** OSM data needs its credit wherever the map shows (ODbL). */
export const DEFAULT_ATTRIBUTION = "© OpenStreetMap contributors (ODbL) · Protomaps";

async function infoOf(path: string, blob: Blob): Promise<OfflineMapInfo> {
  const archive = new PMTiles(blobSource(blob));
  const header = await archive.getHeader();
  const meta = await archive.getMetadata().catch(() => ({}) as Record<string, unknown>);
  const attribution = typeof meta.attribution === "string" && meta.attribution.trim() ? meta.attribution.replace(/<[^>]*>/g, "").trim() : DEFAULT_ATTRIBUTION;
  return { path, name: path.slice(path.lastIndexOf("/") + 1), size: blob.size, header, attribution };
}

/** The basemaps in the vault, newest name last. */
export async function listOfflineMaps(vault?: MapVault): Promise<OfflineMapInfo[]> {
  const ws = vault ?? (await realVault());
  let names: string[] = [];
  try {
    names = (await ws.listWorkspaceFolder(MAP_DIR)).filter((n) => /\.pmtiles$/i.test(n)).sort();
  } catch {
    // why: no maps folder yet
    names = [];
  }
  const out: OfflineMapInfo[] = [];
  for (const n of names) {
    const path = n.includes("/") ? n : `${MAP_DIR}/${n}`;
    try {
      out.push(await infoOf(path, await ws.readWorkspaceBlob(path)));
    } catch {
      /* why: a file that is not a readable PMTiles archive is skipped, not fatal */
    }
  }
  setFlag(out.length > 0);
  return out;
}

/** Copy a picked file into the vault after checking it is a PMTiles v3 archive. */
export async function importOfflineMap(file: Blob & { name?: string }, vault?: MapVault): Promise<OfflineMapInfo> {
  parseHeader(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()));
  const base = (file.name ?? "basemap.pmtiles").replace(/[\\/:*?"<>|]/g, "_").replace(/\.pmtiles$/i, "") || "basemap";
  const path = `${MAP_DIR}/${base}.pmtiles`;
  const ws = vault ?? (await realVault());
  await ws.writeWorkspaceBlob(path, file);
  setFlag(true);
  return infoOf(path, file);
}

export async function removeOfflineMap(path: string, vault?: MapVault): Promise<void> {
  const ws = vault ?? (await realVault());
  await ws.deleteWorkspaceFile(path);
  await listOfflineMaps(ws);
}

/** The basemap to draw (the first one) and its archive, or null. */
export async function activeOfflineMap(vault?: MapVault): Promise<{ info: OfflineMapInfo; archive: PMTiles } | null> {
  const ws = vault ?? (await realVault());
  const [info] = await listOfflineMaps(ws);
  if (!info) return null;
  return { info, archive: new PMTiles(blobSource(await ws.readWorkspaceBlob(info.path))) };
}
