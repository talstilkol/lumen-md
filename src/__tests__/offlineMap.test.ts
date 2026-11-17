/**
 * W13.G3 — the offline map: a PMTiles v3 reader (header, varint
 * directories, gzip, leaf directories, Hilbert tile ids), an MVT decoder,
 * tile drawing with labels in the UI's language and the right direction, the
 * vault store, the background choice (a basemap in the vault means no tile
 * server is asked — and in airplane mode the map still draws from the file),
 * entity clusters, and the panel. Archives are built in the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { createElement as h } from "react";
import { buildArchive, encodeDirectory, encodeTile, israelTile, gzip } from "./helpers/pmtilesFixture";
import { bytesSource, findEntry, parseDirectory, parseHeader, PMTiles, readVarint, tileIdToZxy, zxyToTileId, TileType } from "../map/pmtiles";
import { decodeGeometry, decodeTile, GeomType } from "../map/mvt";
import { drawTile, labelDir, labelOf, LIGHT } from "../map/tileRender";
import { activeOfflineMap, importOfflineMap, listOfflineMaps, MAP_DIR, OFFLINE_FLAG, removeOfflineMap, type MapVault } from "../map/offlineStore";
import { drawArchiveTile } from "../map/offlineLayer";
import { clusterPoints, parseLocation, project } from "../map/cluster";
import { entityPoints } from "../map/entityMarkers";
import { addBaseTiles, TILE_URL } from "../plugins/map/tiles";
import OfflineMapPanel from "../map/OfflineMapPanel";

// The vault the store reaches through "../storage/workspace", and airplane mode, both under the test's control.
const env = vi.hoisted(() => ({ airplane: false, vault: null as null | Record<string, (...a: never[]) => unknown> }));
vi.mock("../privacy/airplane", () => ({ airplaneModeOn: () => env.airplane }));
vi.mock("../storage/workspace", () => {
  const call = (k: string) => (...a: never[]) => (env.vault ? env.vault[k](...a) : Promise.reject(new Error("no vault")));
  return { listWorkspaceFolder: call("listWorkspaceFolder"), readWorkspaceBlob: call("readWorkspaceBlob"), writeWorkspaceBlob: call("writeWorkspaceBlob"), deleteWorkspaceFile: call("deleteWorkspaceFile") };
});

/** A 2D context that records what is drawn. */
function recorder() {
  const calls: Array<{ op: string; args: unknown[]; dir?: string; fill?: unknown; font?: string }> = [];
  const state: Record<string, unknown> = { direction: "inherit", fillStyle: "#000", font: "10px sans-serif" };
  const ctx = new Proxy(state, {
    get: (t, k: string) => {
      if (k in t) return t[k];
      if (k === "measureText") return (s: string) => ({ width: s.length * 6 });
      return (...args: unknown[]) => void calls.push({ op: k, args, dir: String(t.direction), fill: t.fillStyle, font: String(t.font) });
    },
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

/** A fake vault in memory (the MapVault interface). */
function memVault(): MapVault & { files: Map<string, Blob> } {
  const files = new Map<string, Blob>();
  return {
    files,
    listWorkspaceFolder: async (p) => [...files.keys()].filter((k) => k.startsWith(`${p}/`)).map((k) => k.slice(p.length + 1)),
    readWorkspaceBlob: async (p) => {
      const b = files.get(p);
      if (!b) throw new Error("no such file");
      return b;
    },
    writeWorkspaceBlob: async (p, b) => void files.set(p, b),
    deleteWorkspaceFile: async (p) => void files.delete(p),
  };
}

describe("PMTiles: tile ids", () => {
  it("the Hilbert ids of the spec's examples, and back", () => {
    expect(zxyToTileId(0, 0, 0)).toBe(0);
    expect([zxyToTileId(1, 0, 0), zxyToTileId(1, 0, 1), zxyToTileId(1, 1, 1), zxyToTileId(1, 1, 0)]).toEqual([1, 2, 3, 4]);
    expect(zxyToTileId(2, 0, 0)).toBe(5);
    expect(zxyToTileId(12, 3423, 1023)).toBeGreaterThan(zxyToTileId(11, 2047, 2047));
    for (let k = 0; k < 300; k++) {
      const z = k % 15;
      const x = (k * 7919) % 2 ** z;
      const y = (k * 104729) % 2 ** z;
      expect(tileIdToZxy(zxyToTileId(z, x, y))).toEqual([z, x, y]);
    }
    expect(() => zxyToTileId(2, 4, 0)).toThrow(RangeError);
  });
  it("varints past 32 bits", () => {
    const b = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
    expect(readVarint(b, { i: 0 })).toBe(2 ** 36 - 1);
    expect(() => readVarint(Uint8Array.from([0x80]), { i: 0 })).toThrow(/truncated/);
  });
  it("directories: deltas, run lengths, lengths, offsets (0 = right after the previous)", () => {
    const entries = [
      { tileId: 0, offset: 0, length: 10, runLength: 1 },
      { tileId: 5, offset: 10, length: 20, runLength: 3 },
      { tileId: 9, offset: 100, length: 5, runLength: 1 },
      { tileId: 40, offset: 0, length: 77, runLength: 0 },
    ];
    expect(parseDirectory(encodeDirectory(entries))).toEqual(entries);
    const parsed = parseDirectory(encodeDirectory(entries));
    expect(findEntry(parsed, 6)!.tileId).toBe(5); // within the run
    expect(findEntry(parsed, 8)).toBeNull(); // run of 3 covers 5, 6, 7
    expect(findEntry(parsed, 45)!.runLength).toBe(0); // a leaf
  });
});

describe("PMTiles: reading an archive", () => {
  it("header, metadata, tiles, missing tiles; gzip directories and a leaf directory", async () => {
    const tiles = new Map([
      ["0/0/0", Uint8Array.from([1, 2, 3])],
      ["7/76/52", israelTile()],
      ["8/153/105", Uint8Array.from([9])],
    ]);
    for (const opts of [{}, { gzipDirs: true }, { gzipDirs: true, leaf: true }]) {
      const bytes = await buildArchive(tiles, { ...opts, metadata: { attribution: "<a>© OpenStreetMap contributors</a>", name: "israel" } });
      const a = new PMTiles(bytesSource(bytes));
      const h = await a.getHeader();
      expect([h.minZoom, h.maxZoom, h.tileType]).toEqual([0, 8, TileType.Mvt]);
      expect(h.minLon).toBeCloseTo(34.2);
      expect(h.maxLat).toBeCloseTo(33.4);
      expect((await a.getMetadata()).name).toBe("israel");
      expect(await a.getTile(0, 0, 0)).toEqual(Uint8Array.from([1, 2, 3]));
      expect(await a.getTile(7, 76, 52)).toEqual(israelTile());
      expect(await a.getTile(8, 153, 105)).toEqual(Uint8Array.from([9]));
      expect(await a.getTile(7, 76, 53)).toBeNull();
      expect(await a.getTile(9, 0, 0)).toBeNull(); // above the max zoom
    }
  });
  it("refuses what is not a PMTiles v3 file", () => {
    expect(() => parseHeader(new Uint8Array(200))).toThrow(/not a PMTiles/);
    const v2 = new Uint8Array(200);
    v2.set(new TextEncoder().encode("PMTiles"));
    v2[7] = 2;
    expect(() => parseHeader(v2)).toThrow(/version 2/);
    expect(() => parseHeader(new Uint8Array(10))).toThrow(/too short/);
  });
});

describe("MVT", () => {
  it("geometry commands: MoveTo, LineTo, ClosePath with zigzag deltas", () => {
    // MoveTo(1) (5,5), LineTo(2) (+3,0) (0,+3), ClosePath
    expect(decodeGeometry([9, 10, 10, 18, 6, 0, 0, 6, 15])).toEqual([[5, 5, 8, 5, 8, 8, 5, 5]]);
  });
  it("layers, features, properties of every value type", () => {
    const layers = decodeTile(israelTile());
    expect(layers.map((l) => l.name)).toEqual(["earth", "water", "landuse", "roads", "places"]);
    const places = layers.find((l) => l.name === "places")!;
    expect(places.extent).toBe(4096);
    expect(places.features[0].type).toBe(GeomType.Point);
    expect(places.features[0].geometry).toEqual([[1500, 1400]]);
    expect(places.features[0].properties).toMatchObject({ "name:he": "תל אביב-יפו", "name:en": "Tel Aviv-Yafo", min_zoom: 4 });
    expect(places.features[3].properties.population).toBe(209000);
    const water = layers.find((l) => l.name === "water")!.features[0];
    expect(water.type).toBe(GeomType.Polygon);
    expect(water.geometry[0].slice(-2)).toEqual(water.geometry[0].slice(0, 2));
    const t = decodeTile(encodeTile({ x: [{ type: 1, parts: [[1, 1]], props: { f: 1.5, b: true, s: "שלום" } }] }));
    expect(t[0].features[0].properties).toEqual({ f: 1.5, b: true, s: "שלום" });
  });
});

describe("drawing a tile, labels in the UI's language", () => {
  const layers = decodeTile(israelTile());
  it("Hebrew: name:he (else name), right to left; Arabic and English likewise", () => {
    const he = drawTile(recorder().ctx, layers, 256, { lang: "he", zoom: 8 });
    expect(he.map((l) => [l.text, l.dir])).toEqual([
      ["ירושלים", "rtl"],
      ["תל אביב-יפו", "rtl"],
      ["חיפה", "rtl"],
      ["באר שבע 2", "rtl"],
    ]);
    const en = drawTile(recorder().ctx, layers, 256, { lang: "en", zoom: 8 });
    expect(en.map((l) => [l.text, l.dir])).toEqual([
      ["Jerusalem", "ltr"],
      ["Tel Aviv-Yafo", "ltr"],
      ["Haifa", "ltr"],
      ["Be'er Sheva", "ltr"],
    ]);
    const ar = drawTile(recorder().ctx, layers, 256, { lang: "ar", zoom: 8 });
    expect(ar[0]).toMatchObject({ text: "القدس", dir: "rtl" });
  });
  it("every label is drawn with its own direction set on the canvas, halo first", () => {
    const { ctx, calls } = recorder();
    drawTile(ctx, layers, 256, { lang: "he", zoom: 8 });
    const texts = calls.filter((c) => c.op === "fillText");
    expect(texts.map((c) => [c.args[0], c.dir])).toEqual([
      ["ירושלים", "rtl"],
      ["תל אביב-יפו", "rtl"],
      ["חיפה", "rtl"],
      ["באר שבע 2", "rtl"],
    ]);
    expect(calls.filter((c) => c.op === "strokeText")).toHaveLength(4);
    // Water, land and the park were filled; the highway stroked.
    expect(calls.filter((c) => c.op === "fill").map((c) => c.fill)).toEqual(expect.arrayContaining([LIGHT.water, LIGHT.park]));
  });
  it("label choice and direction rules", () => {
    expect(labelOf({ name: "ירושלים", "name:en": "Jerusalem" }, "en")).toBe("Jerusalem");
    expect(labelOf({ name: "ירושלים", "name:en": "Jerusalem" }, "de")).toBe("ירושלים");
    expect(labelOf({ "name:en": "Jerusalem" }, "he")).toBe("Jerusalem");
    expect(labelOf({ "name:fr": "Jérusalem", name: "ירושלים" }, "fr")).toBe("Jérusalem");
    expect(labelOf({}, "he")).toBeNull();
    expect(labelDir("Tel Aviv תל אביב")).toBe("ltr");
    expect(labelDir("2 באר שבע")).toBe("rtl");
    expect(labelDir("1948")).toBe("ltr");
  });
  it("overlapping labels: the more important one stays", () => {
    const crowded = decodeTile(
      encodeTile({
        places: [
          { type: 1, parts: [[2000, 2000]], props: { name: "כפר קטן", min_zoom: 12 } },
          { type: 1, parts: [[2010, 2005]], props: { name: "עיר גדולה", min_zoom: 4 } },
        ],
      }),
    );
    expect(drawTile(recorder().ctx, crowded, 256, { lang: "he", zoom: 10 }).map((l) => l.text)).toEqual(["עיר גדולה"]);
  });
});

describe("the vault store", () => {
  beforeEach(() => localStorage.removeItem(OFFLINE_FLAG));
  it("imports a PMTiles file into .lumen/maps, lists it with its region and credit, removes it; refuses anything else", async () => {
    const vault = memVault();
    expect(await listOfflineMaps(vault)).toEqual([]);
    const bytes = await buildArchive(new Map([["7/76/52", israelTile()]]), { gzipDirs: true, metadata: { attribution: "© OpenStreetMap contributors" } });
    const file = Object.assign(new Blob([bytes as BlobPart]), { name: "israel.pmtiles" });
    const info = await importOfflineMap(file, vault);
    expect(info.path).toBe(`${MAP_DIR}/israel.pmtiles`);
    expect(info.attribution).toBe("© OpenStreetMap contributors");
    expect(localStorage.getItem(OFFLINE_FLAG)).toBe("1");
    const [listed] = await listOfflineMaps(vault);
    expect([listed.header.minZoom, listed.header.maxZoom, listed.size]).toEqual([7, 7, bytes.length]);
    const active = await activeOfflineMap(vault);
    expect(await active!.archive.getTile(7, 76, 52)).toEqual(israelTile());
    await expect(importOfflineMap(Object.assign(new Blob(["<html>not a map</html>".padEnd(200)]), { name: "x.pmtiles" }), vault)).rejects.toThrow(/not a PMTiles/);
    await removeOfflineMap(info.path, vault);
    expect(await listOfflineMaps(vault)).toEqual([]);
    expect(localStorage.getItem(OFFLINE_FLAG)).toBeNull();
  });
});

describe("drawing from the file, overzoom, no network", () => {
  it("an MVT tile and a raster tile draw from the archive; past the last zoom the last level is drawn larger; fetch is never called", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network")));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const a = new PMTiles(bytesSource(await buildArchive(new Map([["7/76/52", israelTile()]]), { gzipDirs: true })));
      const h = await a.getHeader();
      const { ctx, calls } = recorder();
      const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
      expect(await drawArchiveTile(a, h, canvas, 7, 76, 52, 256, { lang: "he" })).toBe(true);
      expect(calls.some((c) => c.op === "fillText" && c.args[0] === "ירושלים")).toBe(true);
      // Zoom 9: tile (305, 209) lies in 7/76/52 (305 >> 2 = 76, 209 >> 2 = 52): drawn 4× larger, shifted.
      const z9 = recorder();
      expect(await drawArchiveTile(a, h, { getContext: () => z9.ctx } as unknown as HTMLCanvasElement, 9, 305, 209, 256, { lang: "he" })).toBe(true);
      expect(z9.calls.find((c) => c.op === "translate")!.args).toEqual([-(305 - 76 * 4) * 256, -(209 - 52 * 4) * 256]);
      expect(await drawArchiveTile(a, h, canvas, 7, 0, 0, 256, { lang: "he" })).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/** Just enough Leaflet for addBaseTiles: records the layers added. */
function fakeLeaflet() {
  const added: string[] = [];
  const map = { _container: {}, eachLayer: () => undefined, removeLayer: () => undefined } as never;
  class GridLayer {
    static extend(proto: object) {
      return class extends GridLayer {
        proto = proto;
      };
    }
    constructor(public options: Record<string, unknown> = {}) {}
    addTo() {
      added.push(`offline:${String(this.options.className)}`);
      return this;
    }
  }
  const L = {
    tileLayer: (url: string) => ({ addTo: () => void added.push(url) }),
    GridLayer,
    latLngBounds: (a: unknown, b: unknown) => [a, b],
  } as unknown as typeof import("leaflet");
  return { L, map, added };
}

describe("the background: the file first, the network never while there is one", () => {
  afterEach(() => localStorage.removeItem(OFFLINE_FLAG));
  it("with a basemap in the vault and airplane mode on: drawn from the file, 0 tile requests", async () => {
    const vault = memVault();
    await importOfflineMap(Object.assign(new Blob([(await buildArchive(new Map([["7/76/52", israelTile()]]))) as BlobPart]), { name: "israel.pmtiles" }), vault);
    env.vault = vault as never;
    env.airplane = true;
    try {
      const { L, map, added } = fakeLeaflet();
      expect(addBaseTiles(L, map)).toBe(true);
      await waitFor(() => expect(added).toEqual(["offline:lumen-offline-basemap"]));
      expect(added).not.toContain(TILE_URL);
      // And with airplane mode off: still only the file.
      env.airplane = false;
      const second = fakeLeaflet();
      addBaseTiles(second.L, second.map);
      await waitFor(() => expect(second.added).toEqual(["offline:lumen-offline-basemap"]));
    } finally {
      env.airplane = false;
      env.vault = null;
    }
  });
  it("no basemap: the online tiles (none in airplane mode) — the W12.F7 behaviour", async () => {
    const vault = memVault();
    env.vault = vault as never;
    env.airplane = false;
    try {
      const a = fakeLeaflet();
      expect(addBaseTiles(a.L, a.map)).toBe(true);
      expect(a.added).toEqual([TILE_URL]);
      env.airplane = true;
      const b = fakeLeaflet();
      expect(addBaseTiles(b.L, b.map)).toBe(false);
      await new Promise((r) => setTimeout(r, 20));
      expect(b.added).toEqual([]);
    } finally {
      env.airplane = false;
      env.vault = null;
    }
  });
});

describe("entities on the map, clustered", () => {
  it("locations in several spellings; points that would overlap become one cluster, and split when zoomed in", async () => {
    expect(parseLocation("31.7683, 35.2137")).toEqual([31.7683, 35.2137]);
    expect(parseLocation("32.08;34.78")).toEqual([32.08, 34.78]);
    expect(parseLocation([29.55, 34.95])).toEqual([29.55, 34.95]);
    expect(parseLocation({ lat: 32.79, lon: 34.99 })).toEqual([32.79, 34.99]);
    expect(parseLocation("north")).toBeNull();
    expect(parseLocation("99, 35")).toBeNull();
    const files = new Map([
      ["ישויות/מקומות/ירושלים.md", "---\nentity-type: place\nlocation: 31.7683, 35.2137\n---\n"],
      ["ישויות/מקומות/העיר העתיקה.md", "---\nentity-type: place\nמיקום: 31.7767, 35.2345\n---\n"],
      ["ישויות/מקומות/חיפה.md", "---\nentity-type: place\ncoordinates: [32.794, 34.9896]\n---\n"],
      ["ישויות/מקומות/בלי מיקום.md", "---\nentity-type: place\n---\n"],
      ["הערות/ירושלים.md", "location: 31.7, 35.2\n"],
    ]);
    const points = await entityPoints(files);
    expect(points.map((p) => p.label).sort()).toEqual(["העיר העתיקה", "חיפה", "ירושלים"]);
    expect(clusterPoints(points, 6).map((c) => c.points.length).sort()).toEqual([1, 2]);
    expect(clusterPoints(points, 16).every((c) => c.points.length === 1)).toBe(true);
    const [x, y] = project(0, 0, 0);
    expect([x, y]).toEqual([128, 128]);
    // 2,000 points cluster in well under 50 ms.
    const many = Array.from({ length: 2000 }, (_, i) => ({ lat: 29.5 + (i % 40) * 0.1, lng: 34.3 + Math.floor(i / 40) * 0.03, id: `p${i}`, label: `${i}` }));
    const t0 = performance.now();
    expect(clusterPoints(many, 8).length).toBeLessThan(2000);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe("the panel", () => {
  beforeEach(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "he";
  });
  afterEach(() => {
    cleanup();
    document.documentElement.dir = "";
    localStorage.removeItem(OFFLINE_FLAG);
  });
  it("shows none, imports a picked file, lists it, refuses a wrong one, removes it; axe clean", async () => {
    const vault = memVault();
    const { container } = render(h(OfflineMapPanel, { vault }));
    await screen.findByTestId("offline-map-none");
    const good = new File([(await buildArchive(new Map([["7/76/52", israelTile()]]), { gzipDirs: true })) as BlobPart], "israel.pmtiles");
    await act(async () => {
      fireEvent.change(screen.getByTestId("offline-map-file"), { target: { files: [good] } });
    });
    await waitFor(() => expect(container.querySelector(`[data-map="${MAP_DIR}/israel.pmtiles"]`)).not.toBeNull());
    expect(container.textContent).toMatch(/34\.20/);
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
    const bad = new File(["nope".padEnd(300)], "bad.pmtiles");
    await act(async () => {
      fireEvent.change(screen.getByTestId("offline-map-file"), { target: { files: [bad] } });
    });
    await waitFor(() => expect(screen.getByTestId("offline-map-status").textContent).toMatch(/not a PMTiles/));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove|הסרה/ }));
    });
    await screen.findByTestId("offline-map-none");
  });
  it("the gzip helper round-trips (DecompressionStream is there)", async () => {
    const { decompress } = await import("../map/pmtiles");
    expect(await decompress(await gzip(Uint8Array.from([1, 2, 3])), 2)).toEqual(Uint8Array.from([1, 2, 3]));
  });
});
