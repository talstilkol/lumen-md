/**
 * W12.F4 (notebook viewer), W12.F5 (data files as a table) and W12.F7
 * (GeoJSON/GPX on a map).
 *
 * Real data: 12 public notebooks (fixtures/ipynb-public, BSD-3-Clause, from
 * jupyter/notebook and jupyter/nbformat) and 6 public GPX files
 * (fixtures/gpx-public, Apache-2.0, from gpxpy). The notebook with hostile
 * outputs, the 10,000-row CSV and the small XLSX are synthetic and built
 * here, labelled as such.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileViewerKind } from "../viewers/fileViewers";
import { parseNotebook, stripAnsi } from "../viewers/notebook";
import { NotebookView } from "../viewers/NotebookView";
import { parseDataText, parseDelimited, writeCell } from "../viewers/dataFile";
import { DataTableView } from "../viewers/DataFileView";
import { featureRows, gpxToGeoJson, lineLengthKm, parseGeoJson } from "../viewers/geoFile";
import { FileViewerOverlay, loadFileView, type FileViewerIo } from "../viewers/FileViewerOverlay";
import { addBaseTiles } from "../plugins/map/tiles";
import { enableAirplaneMode } from "../privacy/airplane";
import { setOnlineTilesAllowed } from "../privacy/mapTiles";
import { zip } from "../storage/zip";

afterEach(cleanup);

/** Plain text in place of the app's Markdown renderer (Shiki/KaTeX are lazy chunks not loaded here). */
const plain = async (md: string) => <pre data-md="">{md}</pre>;

describe("which files open in a viewer", () => {
  it("maps extensions to viewers and leaves dot-folders as text", () => {
    expect(fileViewerKind("a/b.ipynb")).toBe("notebook");
    for (const p of ["x.csv", "x.TSV", "x.xlsx", "x.json", "x.yaml", "x.yml"]) expect(fileViewerKind(p), p).toBe("data");
    expect(fileViewerKind("trip.gpx")).toBe("geo");
    expect(fileViewerKind("areas.geojson")).toBe("geo");
    expect(fileViewerKind("note.md")).toBeNull();
    expect(fileViewerKind(".lumen/types/person.json")).toBeNull();
    expect(fileViewerKind("x/.obsidian/app.json")).toBeNull();
  });
});

const nbDir = "src/__tests__/fixtures/ipynb-public";
const notebooks = readdirSync(nbDir).filter((n) => n.endsWith(".ipynb")).sort();

describe("notebook viewer (W12.F4) on 12 public notebooks", () => {
  it("parses every one, with every cell", () => {
    expect(notebooks.length).toBeGreaterThanOrEqual(10);
    for (const n of notebooks) {
      const text = readFileSync(join(nbDir, n), "utf8");
      const nb = parseNotebook(text);
      expect(nb.cells.length, n).toBe((JSON.parse(text) as { cells: unknown[] }).cells.length);
    }
  });

  it("renders every one: markdown and code cells, outputs, execution counts", async () => {
    for (const n of notebooks) {
      const nb = parseNotebook(readFileSync(join(nbDir, n), "utf8"));
      const { container, unmount } = render(<NotebookView notebook={nb} render={plain} />);
      await waitFor(() => expect(container.querySelectorAll(".nb-cell")).toHaveLength(nb.cells.length));
      expect(container.querySelectorAll(".nb-code")).toHaveLength(nb.cells.filter((c) => c.type === "code").length);
      unmount();
    }
  });

  it("classifies nbformat's test4 outputs: PNG image, HTML, JavaScript shown and not run", () => {
    const nb = parseNotebook(readFileSync(join(nbDir, "nbformat-test4.ipynb"), "utf8"));
    const kinds = nb.cells.flatMap((c) => c.outputs.map((o) => o.kind));
    expect(kinds).toContain("image");
    expect(kinds).toContain("html");
    const js = nb.cells.flatMap((c) => c.outputs).find((o) => o.kind === "code");
    expect(js).toMatchObject({ kind: "code", mime: "application/javascript" });
    const img = nb.cells.flatMap((c) => c.outputs).find((o) => o.kind === "image");
    expect(img && "src" in img && img.src.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("an error output keeps its traceback, without ANSI colour codes", () => {
    const nb = parseNotebook(readFileSync(join(nbDir, "nbformat-many_tracebacks.ipynb"), "utf8"));
    const err = nb.cells.flatMap((c) => c.outputs).find((o) => o.kind === "error");
    expect(err).toBeDefined();
    expect(err && "text" in err && err.text).not.toMatch(/\u001b\[/);
    expect(stripAnsi("\u001b[0;31mValueError\u001b[0m: x")).toBe("ValueError: x");
  });

  it("synthetic hostile notebook: <script>, onerror, javascript: and JS outputs run 0 times", async () => {
    const w = window as unknown as { __nbRan?: number };
    delete w.__nbRan;
    const hostile = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [
        {
          cell_type: "code",
          execution_count: 1,
          source: "display(HTML(...))",
          outputs: [
            { output_type: "display_data", data: { "text/html": '<table><tr><td>שלום</td></tr></table><script>window.__nbRan = 1</script><img src="x" onerror="window.__nbRan = 2"><a href="javascript:window.__nbRan=3">x</a>' } },
            { output_type: "display_data", data: { "image/svg+xml": '<svg xmlns="http://www.w3.org/2000/svg"><script>window.__nbRan = 4</script><circle r="3" onload="window.__nbRan = 5"/></svg>' } },
            { output_type: "display_data", data: { "application/javascript": "window.__nbRan = 6" } },
          ],
        },
      ],
    };
    const { container } = render(<NotebookView notebook={parseNotebook(JSON.stringify(hostile))} render={plain} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container.querySelector("td")?.textContent).toBe("שלום");
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(container.querySelector("[onerror], [onload]")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector(".nb-inactive pre")?.textContent).toBe("window.__nbRan = 6");
    expect(w.__nbRan).toBeUndefined();
  });
});

describe("data files as a table (W12.F5)", () => {
  it("parses RFC 4180 CSV: quotes, doubled quotes, line breaks in a field, CRLF and a BOM", () => {
    const text = '﻿שם,הערה\r\n"כהן, דנה","אמרה ""שלום"""\r\nלוי,"שתי\nשורות"\r\n';
    const recs = parseDelimited(text, ",");
    expect(recs.map((r) => r.fields)).toEqual([["שם", "הערה"], ["כהן, דנה", 'אמרה "שלום"'], ["לוי", "שתי\nשורות"]]);
  });

  it("editing a cell changes only that row's bytes", () => {
    const text = 'id,שם,עיר\n1,דנה,"תל אביב"\n2,יוסי,חיפה\n3,"רון, ג׳וניור",ירושלים';
    const table = parseDataText("csv", text);
    const next = writeCell("csv", text, 1, "עיר", "באר שבע", table.columns)!;
    expect(next).toBe('id,שם,עיר\n1,דנה,"תל אביב"\n2,יוסי,באר שבע\n3,"רון, ג׳וניור",ירושלים');
    const quoted = writeCell("csv", text, 0, "שם", 'דנה "הגדולה", בת 7', table.columns)!;
    expect(quoted.split("\n")[1]).toBe('1,"דנה ""הגדולה"", בת 7","תל אביב"');
    expect(quoted.split("\n").filter((_, i) => i !== 1)).toEqual(text.split("\n").filter((_, i) => i !== 1));
    expect(writeCell("tsv", "a\tb\nx\ty\n", 0, "b", "z", ["a", "b"])).toBe("a\tb\nx\tz\n");
  });

  it("synthetic: a Hebrew CSV of 10,000 rows parses and renders in under a second (virtualized)", () => {
    const cities = ["תל אביב", "ירושלים", "חיפה", "באר שבע", "אילת"];
    const lines = ["מזהה,שם,עיר,ציון"];
    for (let i = 0; i < 10_000; i++) lines.push(`${i},"תלמיד ${i}",${cities[i % 5]},${i % 100}`);
    const csv = lines.join("\n");
    const t0 = performance.now();
    const table = parseDataText("csv", csv);
    const { container } = render(<DataTableView table={table} onEdit={() => {}} />);
    const ms = performance.now() - t0;
    expect(table.rows).toHaveLength(10_000);
    const shown = container.querySelectorAll('[role="row"]').length - 1;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(200);
    expect(ms).toBeLessThan(1000);
  });

  it("JSON (array of objects) and YAML (list) open as tables and write back; YAML keeps its comments", () => {
    const json = '[\n  {"name": "דנה", "age": 30},\n  {"name": "יוסי", "age": 41}\n]\n';
    const jt = parseDataText("json", json);
    expect(jt.columns).toEqual(["name", "age"]);
    expect(writeCell("json", json, 1, "age", "42", jt.columns)).toBe('[\n  {\n    "name": "דנה",\n    "age": 30\n  },\n  {\n    "name": "יוסי",\n    "age": 42\n  }\n]\n');
    const yaml = "# אנשי קשר\n- name: דנה # ראשונה\n  city: חיפה\n- name: יוסי\n  city: אילת\n";
    const yt = parseDataText("yaml", yaml);
    expect(yt.rows).toEqual([["דנה", "חיפה"], ["יוסי", "אילת"]]);
    const y2 = writeCell("yaml", yaml, 1, "city", "צפת", yt.columns)!;
    expect(y2).toContain("# אנשי קשר");
    expect(y2).toContain("# ראשונה");
    expect(y2).toContain("city: צפת");
    expect(() => parseDataText("json", '{"a": 1}')).toThrow(/array/);
    expect(parseDataText("json", '[{"a": {"b": 1}}]').editable).toBe(false);
  });

  it("synthetic XLSX opens read only through the existing reader", async () => {
    const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>7</v></c></row></sheetData></worksheet>`;
    const shared = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>שם</t></si><si><t>ציון</t></si><si><t>דנה</t></si></sst>`;
    const bytes = await zip([
      { name: "xl/worksheets/sheet1.xml", data: sheet },
      { name: "xl/sharedStrings.xml", data: shared },
    ]);
    const io: FileViewerIo = { readText: async () => "", readBytes: async () => bytes.slice().buffer, writeText: async () => {} };
    const l = await loadFileView({ kind: "data", path: "grades.xlsx" }, io);
    expect(l).toMatchObject({ kind: "data", table: { columns: ["שם", "ציון"], rows: [["דנה", "7"]], editable: false } });
  });

  it("the overlay: Enter on a cell, type, Enter, and the file is written with only that row changed", async () => {
    let file = "שם,עיר\nדנה,חיפה\nיוסי,אילת\n";
    const writes: string[] = [];
    const io: FileViewerIo = {
      readText: async () => file,
      readBytes: async () => new ArrayBuffer(0),
      writeText: async (_p, text) => {
        writes.push(text);
        file = text;
      },
    };
    render(<FileViewerOverlay view={{ kind: "data", path: "people.csv", seq: 1 }} onClose={() => {}} onOpenAsText={() => {}} io={io} />);
    const cell = await screen.findByRole("button", { name: "עיר 2: אילת" });
    fireEvent.keyDown(cell, { key: "Enter" });
    const input = screen.getByRole("textbox", { name: "עיר 2" });
    fireEvent.change(input, { target: { value: "צפת" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(writes).toEqual(["שם,עיר\nדנה,חיפה\nיוסי,צפת\n"]));
    expect(await screen.findByRole("button", { name: "עיר 2: צפת" })).toBeTruthy();
  });
});

const gpxDir = "src/__tests__/fixtures/gpx-public";
const gpxFiles = readdirSync(gpxDir).filter((n) => n.endsWith(".gpx")).sort();

describe("GeoJSON and GPX on a map (W12.F7)", () => {
  it("opens the 6 public GPX files: every waypoint is a point, every segment of 2+ points a line", () => {
    expect(gpxFiles).toHaveLength(6);
    for (const n of gpxFiles) {
      const xml = readFileSync(join(gpxDir, n), "utf8");
      const geo = gpxToGeoJson(xml);
      const points = geo.features.filter((f) => f.geometry.type === "Point");
      expect(points.length, n).toBe((xml.match(/<wpt\b/g) ?? []).length);
      expect(geo.features.length, n).toBeGreaterThan(0);
      for (const f of geo.features) for (const c of (f.geometry.type === "Point" ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][]) {
        expect(Math.abs(c[1]), n).toBeLessThanOrEqual(90);
        expect(Math.abs(c[0]), n).toBeLessThanOrEqual(180);
      }
      expect(featureRows(geo)).toHaveLength(geo.features.length);
    }
  });

  it("a track keeps all its points, elevations and a plausible length", () => {
    const geo = gpxToGeoJson(readFileSync(join(gpxDir, "Mojstrovka.gpx"), "utf8"));
    const line = geo.features.find((f) => f.geometry.type === "LineString")!;
    const coords = line.geometry.coordinates as number[][];
    expect(coords).toHaveLength(184);
    expect(coords[0]).toHaveLength(3);
    const km = lineLengthKm(coords);
    expect(km).toBeGreaterThan(0.5);
    expect(km).toBeLessThan(50);
  });

  it("GeoJSON: a collection, a feature or a bare geometry; anything else is refused", () => {
    expect(parseGeoJson('{"type":"FeatureCollection","features":[]}').features).toEqual([]);
    expect(parseGeoJson('{"type":"Point","coordinates":[34.78,32.08]}').features[0].geometry.type).toBe("Point");
    expect(() => parseGeoJson('{"type":"Thing"}')).toThrow(/not GeoJSON/);
    expect(() => gpxToGeoJson("<kml/>")).toThrow(/not a GPX/);
  });

  it("background tiles are the only request, only with consent, and in airplane mode none is added", async () => {
    const calls: string[] = [];
    const L = { tileLayer: (url: string) => ({ addTo: () => calls.push(url) }) } as unknown as typeof import("leaflet");
    const map = { _container: {} } as never;
    expect(addBaseTiles(L, map)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toEqual([]); // no consent yet (audit r4 A3 #6)
    setOnlineTilesAllowed(true);
    try {
      addBaseTiles(L, map);
      await waitFor(() => expect(calls).toEqual(["https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"]));
      enableAirplaneMode();
      expect(addBaseTiles(L, map)).toBe(false);
      await new Promise((r) => setTimeout(r, 50));
      expect(calls).toHaveLength(1);
    } finally {
      setOnlineTilesAllowed(false);
    }
  });
});
