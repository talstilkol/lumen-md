/**
 * TEMPORARY (plan 4.19, removed before review): prints tldraw 4.5's real
 * record shapes in CI so the converter's fixtures can be checked against
 * them. The npm registry isn't reachable where the converter was written.
 */
import { it, expect } from "vitest";
import * as tldraw from "tldraw";
import { buildFixtureCanvases } from "./fixtures/tldrawCanvases";

it("probe: tldraw 4.5 draw-point encoding", () => {
  const m = tldraw as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const B = m.b64Vecs as Record<string, unknown> | undefined;
  if (B) {
    for (const k of Object.getOwnPropertyNames(B)) {
      const v = (B as Record<string, unknown>)[k];
      if (typeof v === "function") out[`fn:${k}`] = String(v).slice(0, 2200);
    }
    const enc = B.encodePoints as ((p: unknown) => unknown) | undefined;
    if (enc) out.sample = enc([{ x: 0, y: 0, z: 0.5 }, { x: 10, y: 4, z: 0.5 }, { x: -3, y: 7.5, z: 0.25 }, { x: 1000.25, y: -2000.5, z: 1 }]);
  }
  try {
    const s2 = tldraw.createTLStore({ shapeUtils: tldraw.defaultShapeUtils, bindingUtils: tldraw.defaultBindingUtils });
    const schema = s2.schema.serialize() as { sequences: Record<string, number> };
    const old = { ...schema, sequences: { ...schema.sequences, "com.tldraw.shape.draw": 3, "com.tldraw.shape.highlight": 2 } };
    const c13 = buildFixtureCanvases().find((c) => c.name === "13-draw")!;
    tldraw.loadSnapshot(s2, { store: Object.fromEntries(c13.records.map((r) => [r.id, r])), schema: old } as never);
    const snap2 = s2.getStoreSnapshot() as { store: Record<string, unknown> };
    out.migratedD2 = snap2.store["shape:d2"];
  } catch (e) {
    out.migratedD2 = `ERR ${String(e)}`;
  }
  const text = JSON.stringify(out);
  const esc = (x: string) => x.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  for (let i = 0, n = 0; i < text.length && n < 9; i += 3800, n++) {
    process.stdout.write(`\n::warning title=probe${n}::${esc(text.slice(i, i + 3800))}\n`);
  }
  expect(typeof tldraw.createTLStore).toBe("function");
});
