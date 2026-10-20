/**
 * Cross-check of the tldraw → Excalidraw converter against the real tldraw
 * 4.5 package (plan 4.19): the fixture canvases are loaded into a tldraw
 * store — validated and migrated by tldraw itself (draw/highlight points
 * become 4.5's base64 `path`) — and converting tldraw's own snapshot must
 * give the same scene as converting the fixture.
 *
 * Delete this file with the `tldraw` dependency.
 */

import { describe, it, expect } from "vitest";
import {
  createTLStore,
  defaultAddFontsFromNode,
  defaultBindingUtils,
  defaultShapeUtils,
  Editor,
  loadSnapshot,
  tipTapDefaultExtensions,
  type TLShapeId,
} from "tldraw";
import { tldrawToExcalidraw, type ExcalidrawElement } from "../canvas/tldrawToExcalidraw";
import { buildFixtureCanvases } from "./fixtures/tldrawCanvases";
import { annotateFailures } from "./ghaFailures";
annotateFailures();

/** Older stored formats / a custom shape type: not valid tldraw 4.5 records on purpose. */
const PRE_45 = new Set(["17-legacy-store", "18-tldr-v2", "19-unsupported"]);

function throughTldraw(records: { id: string }[]): unknown {
  const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils });
  const schema = store.schema.serialize() as { sequences: Record<string, number> };
  // The fixtures write draw points as arrays (draw ≤ v3, highlight ≤ v2);
  // tldraw migrates them to its current encoding.
  const stored = { ...schema, sequences: { ...schema.sequences, "com.tldraw.shape.draw": 3, "com.tldraw.shape.highlight": 2 } };
  loadSnapshot(store, { store: Object.fromEntries(records.map((r) => [r.id, r])), schema: stored } as never);
  return store.getStoreSnapshot();
}

function withoutPoints(e: ExcalidrawElement): unknown {
  if (e.type !== "freedraw") return e;
  const rest: Record<string, unknown> = { ...e };
  for (const k of ["points", "pressures", "width", "height"]) delete rest[k];
  return rest;
}

describe("converter vs. real tldraw 4.5 snapshots", () => {
  const canvases = buildFixtureCanvases().filter((c) => !PRE_45.has(c.name));

  it.each(canvases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const real = tldrawToExcalidraw(throughTldraw(c.records));
    const ours = tldrawToExcalidraw(c.data);
    expect(real.file.elements.map((e) => `${e.id}:${e.type}`)).toEqual(ours.file.elements.map((e) => `${e.id}:${e.type}`));
    expect(real.file.elements.map(withoutPoints)).toEqual(ours.file.elements.map(withoutPoints));
    expect(real.file.files).toEqual(ours.file.files);
    // tldraw may drop a binding whose target is gone while loading; both sides then have no binding.
    const kept = (w: { code: string }[]) => w.filter((x) => x.code !== "binding-dropped");
    expect(kept(real.warnings)).toEqual(kept(ours.warnings));
    // Freehand: tldraw stores float16 deltas, so points match within rounding.
    ours.file.elements.forEach((e, i) => {
      const r = real.file.elements[i];
      if (e.type !== "freedraw" || r.type !== "freedraw") return;
      expect(r.points).toHaveLength(e.points.length);
      e.points.forEach(([x, y], j) => {
        expect(Math.abs(r.points[j][0] - x)).toBeLessThanOrEqual(0.1);
        expect(Math.abs(r.points[j][1] - y)).toBeLessThanOrEqual(0.1);
      });
      r.pressures.forEach((p, j) => expect(Math.abs(p - e.pressures[j])).toBeLessThanOrEqual(0.01));
    });
  });
});

describe("geometry vs. tldraw's own editor", () => {
  it("scaled and unscaled boxes and arrows land where tldraw draws them", () => {
    const c = buildFixtureCanvases().find((x) => x.name === "15-rotation")!;
    const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils });
    store.put(c.records as never);
    const editor = new Editor({
      store,
      shapeUtils: defaultShapeUtils,
      bindingUtils: defaultBindingUtils,
      tools: [],
      getContainer: () => document.body,
      textOptions: { tipTapConfig: { extensions: tipTapDefaultExtensions }, addFontsFromNode: defaultAddFontsFromNode },
    });
    try {
      const { elements } = tldrawToExcalidraw(c.data).file;
      for (const id of ["faded", "big", "sarr"]) {
        const b = editor.getShapePageBounds(`shape:${id}` as TLShapeId)!;
        const e = elements.find((x) => x.id === id)!;
        const box =
          e.type === "arrow"
            ? {
                x: e.x + Math.min(...e.points.map((p) => p[0])),
                y: e.y + Math.min(...e.points.map((p) => p[1])),
                w: e.width,
                h: e.height,
              }
            : { x: e.x, y: e.y, w: e.width, h: e.height };
        expect([box.x, box.y, box.w, box.h].map(Math.round), id).toEqual([b.x, b.y, b.w, b.h].map(Math.round));
      }
    } finally {
      editor.dispose();
    }
  });
});
