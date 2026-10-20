/**
 * TEMPORARY (plan 4.19, removed before review): prints tldraw 4.5's real
 * record shapes in CI so the converter's fixtures can be checked against
 * them. The npm registry isn't reachable where the converter was written.
 */
import { it, expect } from "vitest";
import * as tldraw from "tldraw";
import { buildFixtureCanvases } from "./fixtures/tldrawCanvases";

it("probe: tldraw 4.5 record shapes", () => {
  const m = tldraw as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  out.b64Vecs = typeof m.b64Vecs;
  if (m.b64Vecs && typeof m.b64Vecs === "object") {
    out.b64src = Object.entries(m.b64Vecs as Record<string, unknown>).map(([k, v]) => `${k}=${String(v).slice(0, 2500)}`);
    const enc = (m.b64Vecs as { encodePoints?: (p: unknown) => unknown }).encodePoints;
    if (enc) out.b64sample = enc([{ x: 0, y: 0, z: 0.5 }, { x: 10, y: 4, z: 0.5 }, { x: -3, y: 7.5, z: 0.25 }, { x: 1000.25, y: -2000.5, z: 1 }]);
  }
  for (const U of tldraw.defaultShapeUtils) {
    try {
      out[`props:${U.type}`] = (U.prototype as unknown as { getDefaultProps(): unknown }).getDefaultProps.call({ editor: {} });
    } catch (e) {
      out[`props:${U.type}`] = `ERR ${String(e)}`;
    }
  }
  for (const U of tldraw.defaultBindingUtils) {
    try {
      out[`binding:${U.type}`] = (U.prototype as unknown as { getDefaultProps(): unknown }).getDefaultProps.call({ editor: {} });
    } catch (e) {
      out[`binding:${U.type}`] = `ERR ${String(e)}`;
    }
  }
  try {
    out.richText = (m.toRichText as (s: string) => unknown)("שלום\nworld");
  } catch (e) {
    out.richText = `ERR ${String(e)}`;
  }
  const store = tldraw.createTLStore({ shapeUtils: tldraw.defaultShapeUtils, bindingUtils: tldraw.defaultBindingUtils });
  out.schema = store.schema.serialize();
  const errors: string[] = [];
  for (const c of buildFixtureCanvases()) {
    for (const r of c.records) {
      try {
        store.put([r as never]);
      } catch (e) {
        errors.push(`${c.name} ${r.id}: ${String((e as Error).message).slice(0, 300)}`);
      }
    }
  }
  out.putErrors = errors;
  try {
    out.snapshotKeys = Object.keys(tldraw.getSnapshot(store) as object);
    const snap = tldraw.getSnapshot(store) as { document: { store: Record<string, unknown> } };
    out.sampleDraw = Object.values(snap.document.store).find((r) => (r as { type?: string }).type === "draw");
    out.sampleArrow = Object.values(snap.document.store).find((r) => (r as { type?: string }).type === "arrow");
  } catch (e) {
    out.snapshot = `ERR ${String(e)}`;
  }
  // An old-format draw shape through tldraw's own migrations.
  try {
    const s2 = tldraw.createTLStore({ shapeUtils: tldraw.defaultShapeUtils, bindingUtils: tldraw.defaultBindingUtils });
    const schema = s2.schema.serialize() as { sequences: Record<string, number> };
    const old = { ...schema, sequences: { ...schema.sequences, "com.tldraw.shape.draw": 1 } };
    const c13 = buildFixtureCanvases().find((c) => c.name === "13-draw")!;
    tldraw.loadSnapshot(s2, { store: Object.fromEntries(c13.records.map((r) => [r.id, r])), schema: old } as never);
    const snap2 = tldraw.getSnapshot(s2) as { document: { store: Record<string, unknown> } };
    out.migratedDraw = snap2.document.store["shape:d2"];
  } catch (e) {
    out.migratedDraw = `ERR ${String(e)}`;
  }
  // eslint-disable-next-line no-console
  console.log("TLDRAW_PROBE " + JSON.stringify(out));
  expect(typeof tldraw.createTLStore).toBe("function");
});
