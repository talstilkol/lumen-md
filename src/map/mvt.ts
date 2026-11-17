/**
 * A Mapbox Vector Tile decoder (plan W13.G3): the protobuf of a vector tile
 * (spec 2.1) into layers of features with tile-space geometry and their
 * properties. Small and dependency-free — enough for drawing a basemap
 * tile; written from the public specification.
 */

export const enum GeomType {
  Unknown = 0,
  Point = 1,
  Line = 2,
  Polygon = 3,
}

export type Props = Record<string, string | number | boolean>;

export interface Feature {
  id?: number;
  type: GeomType;
  /** Rings / lines / point groups, each a flat [x0, y0, x1, y1, …] in tile units. */
  geometry: number[][];
  properties: Props;
}

export interface Layer {
  name: string;
  extent: number;
  features: Feature[];
}

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}
  varint(): number {
    let v = 0;
    let mul = 1;
    for (;;) {
      const b = this.buf[this.pos++];
      if (b === undefined) throw new Error("mvt: truncated");
      v += (b & 0x7f) * mul;
      if (b < 0x80) return v;
      mul *= 128;
    }
  }
  /** A field key: [field number, wire type]. */
  key(): [number, number] {
    const k = this.varint();
    return [Math.floor(k / 8), k & 7];
  }
  bytes(): Uint8Array {
    const n = this.varint();
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`mvt: wire type ${wire}`);
  }
  get done() {
    return this.pos >= this.buf.length;
  }
}

const utf8 = new TextDecoder();
const zigzag = (n: number) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

function packed(b: Uint8Array): number[] {
  const r = new Reader(b);
  const out: number[] = [];
  while (!r.done) out.push(r.varint());
  return out;
}

function value(b: Uint8Array): string | number | boolean {
  const r = new Reader(b);
  let v: string | number | boolean = "";
  while (!r.done) {
    const [f, w] = r.key();
    const view = new DataView(b.buffer, b.byteOffset + r.pos);
    if (f === 1 && w === 2) v = utf8.decode(r.bytes());
    else if (f === 2 && w === 5) {
      v = view.getFloat32(0, true);
      r.pos += 4;
    } else if (f === 3 && w === 1) {
      v = view.getFloat64(0, true);
      r.pos += 8;
    } else if ((f === 4 || f === 5) && w === 0) v = r.varint();
    else if (f === 6 && w === 0) v = zigzag(r.varint());
    else if (f === 7 && w === 0) v = r.varint() !== 0;
    else r.skip(w);
  }
  return v;
}

/** Commands → rings / lines / points (MoveTo starts a new part). */
export function decodeGeometry(cmds: readonly number[]): number[][] {
  const parts: number[][] = [];
  let cur: number[] | null = null;
  let x = 0;
  let y = 0;
  for (let i = 0; i < cmds.length; ) {
    const c = cmds[i++];
    const id = c & 7;
    const count = c >>> 3;
    if (id === 7) {
      // ClosePath: repeat the first point.
      if (cur && cur.length >= 2) cur.push(cur[0], cur[1]);
      continue;
    }
    for (let k = 0; k < count; k++) {
      x += zigzag(cmds[i++]);
      y += zigzag(cmds[i++]);
      if (id === 1) {
        cur = [x, y];
        parts.push(cur);
      } else if (id === 2 && cur) cur.push(x, y);
    }
  }
  return parts;
}

function feature(b: Uint8Array, keys: string[], values: Array<string | number | boolean>): Feature {
  const r = new Reader(b);
  const f: Feature = { type: GeomType.Unknown, geometry: [], properties: {} };
  let tags: number[] = [];
  let geom: number[] = [];
  while (!r.done) {
    const [n, w] = r.key();
    if (n === 1 && w === 0) f.id = r.varint();
    else if (n === 2 && w === 2) tags = packed(r.bytes());
    else if (n === 3 && w === 0) f.type = r.varint() as GeomType;
    else if (n === 4 && w === 2) geom = packed(r.bytes());
    else r.skip(w);
  }
  for (let i = 0; i + 1 < tags.length; i += 2) {
    const k = keys[tags[i]];
    if (k !== undefined && tags[i + 1] < values.length) f.properties[k] = values[tags[i + 1]];
  }
  f.geometry = decodeGeometry(geom);
  return f;
}

/** Decode a tile's layers. Unknown fields are skipped; a broken tile throws. */
export function decodeTile(buf: Uint8Array): Layer[] {
  const r = new Reader(buf);
  const layers: Layer[] = [];
  while (!r.done) {
    const [n, w] = r.key();
    if (n !== 3 || w !== 2) {
      r.skip(w);
      continue;
    }
    const lr = new Reader(r.bytes());
    const keys: string[] = [];
    const values: Array<string | number | boolean> = [];
    const raw: Uint8Array[] = [];
    const layer: Layer = { name: "", extent: 4096, features: [] };
    while (!lr.done) {
      const [ln, lw] = lr.key();
      if (ln === 1 && lw === 2) layer.name = utf8.decode(lr.bytes());
      else if (ln === 2 && lw === 2) raw.push(lr.bytes());
      else if (ln === 3 && lw === 2) keys.push(utf8.decode(lr.bytes()));
      else if (ln === 4 && lw === 2) values.push(value(lr.bytes()));
      else if (ln === 5 && lw === 0) layer.extent = lr.varint();
      else lr.skip(lw);
    }
    layer.features = raw.map((f) => feature(f, keys, values));
    layers.push(layer);
  }
  return layers;
}
