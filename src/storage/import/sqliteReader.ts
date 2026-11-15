/**
 * A minimal read-only reader of the SQLite file format (plan W10.E48), enough
 * to read the tables of Apple Notes' NoteStore.sqlite in the browser without
 * a SQLite library or WASM.
 *
 * It follows https://www.sqlite.org/fileformat2.html:
 *   - the 100-byte header (page size, reserved bytes, text encoding);
 *   - table b-trees: interior (0x05) and leaf (0x0D) pages;
 *   - cells whose payload spills onto overflow pages;
 *   - records: varint header, serial types 0–9 and blobs/text;
 *   - sqlite_schema on page 1, and each table's CREATE TABLE text for its
 *     column names (an INTEGER PRIMARY KEY column reads the rowid).
 *
 * What it does not do: write, indexes, WITHOUT ROWID tables, UTF-16 text,
 * or the write-ahead log. A database in WAL mode may have recent changes
 * only in its `-wal` file; `walMode` tells the caller, who should say so.
 * Every page is visited at most once per table scan, so a corrupt file
 * with a page cycle throws instead of looping.
 */

export type SqlValue = null | number | bigint | string | Uint8Array;

export interface SqliteTable {
  name: string;
  rootPage: number;
  columns: string[];
  /** The index of the INTEGER PRIMARY KEY column (it reads the rowid), or -1. */
  rowidColumn: number;
  sql: string;
}

export class SqliteFormatError extends Error {}

const MAGIC = "SQLite format 3\u0000";

export class SqliteFile {
  readonly pageSize: number;
  readonly usable: number;
  readonly walMode: boolean;
  readonly pageCount: number;
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly text = new TextDecoder("utf-8");
  private schemaCache: Map<string, SqliteTable> | null = null;

  constructor(bytes: Uint8Array) {
    if (bytes.length < 100) throw new SqliteFormatError("not a SQLite database: shorter than its header");
    const magic = String.fromCharCode(...bytes.subarray(0, 16));
    if (magic !== MAGIC) throw new SqliteFormatError("not a SQLite database: no \"SQLite format 3\" header");
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const raw = this.view.getUint16(16);
    this.pageSize = raw === 1 ? 65536 : raw;
    if (this.pageSize < 512 || (this.pageSize & (this.pageSize - 1)) !== 0) throw new SqliteFormatError(`bad page size ${raw}`);
    this.usable = this.pageSize - bytes[20];
    if (this.usable < 480) throw new SqliteFormatError("bad reserved space");
    this.walMode = bytes[18] === 2 || bytes[19] === 2;
    const encoding = this.view.getUint32(56);
    if (encoding !== 0 && encoding !== 1) throw new SqliteFormatError("UTF-16 databases are not supported");
    this.pageCount = Math.floor(bytes.length / this.pageSize);
  }

  /** The tables in sqlite_schema, by name (case as written). */
  tables(): Map<string, SqliteTable> {
    if (this.schemaCache) return this.schemaCache;
    const out = new Map<string, SqliteTable>();
    for (const { values } of this.scan(1)) {
      const [type, name, , rootpage, sql] = values;
      if (type !== "table" || typeof name !== "string" || typeof sql !== "string") continue;
      const root = typeof rootpage === "bigint" ? Number(rootpage) : rootpage;
      if (typeof root !== "number" || root < 1) continue;
      if (/\)\s*WITHOUT\s+ROWID\s*;?\s*$/i.test(sql)) continue;
      const { columns, rowidColumn } = parseColumns(sql);
      out.set(name, { name, rootPage: root, columns, rowidColumn, sql });
    }
    this.schemaCache = out;
    return out;
  }

  /** A table by name, ignoring case (SQLite names are case-insensitive). */
  table(name: string): SqliteTable | null {
    const want = name.toLowerCase();
    for (const t of this.tables().values()) if (t.name.toLowerCase() === want) return t;
    return null;
  }

  /** Every row of `name` as an object keyed by column name, in rowid order. */
  *rows(name: string): Generator<Record<string, SqlValue>> {
    const t = this.table(name);
    if (!t) throw new SqliteFormatError(`no table ${name}`);
    for (const { rowid, values } of this.scan(t.rootPage)) {
      const row: Record<string, SqlValue> = {};
      t.columns.forEach((c, i) => {
        row[c] = i === t.rowidColumn ? toNumber(rowid) : (values[i] ?? null);
      });
      yield row;
    }
  }

  /** The raw records of the table b-tree rooted at `root`. */
  *scan(root: number): Generator<{ rowid: bigint; values: SqlValue[] }> {
    const seen = new Set<number>();
    const stack = [root];
    // Depth-first, left to right, so rows come out in rowid order.
    while (stack.length) {
      const page = stack.pop()!;
      if (seen.has(page)) throw new SqliteFormatError(`page ${page} is reached twice: the file is corrupt`);
      seen.add(page);
      const base = this.pageOffset(page);
      const hdr = page === 1 ? base + 100 : base;
      const kind = this.bytes[hdr];
      const cells = this.view.getUint16(hdr + 3);
      if (kind === 0x05) {
        const children: number[] = [];
        for (let i = 0; i < cells; i++) {
          const ptr = base + this.view.getUint16(hdr + 12 + i * 2);
          children.push(this.view.getUint32(ptr));
        }
        children.push(this.view.getUint32(hdr + 8));
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      } else if (kind === 0x0d) {
        for (let i = 0; i < cells; i++) {
          const ptr = base + this.view.getUint16(hdr + 8 + i * 2);
          yield this.leafCell(ptr);
        }
      } else {
        throw new SqliteFormatError(`page ${page} is not a table b-tree page (type ${kind})`);
      }
    }
  }

  private pageOffset(page: number): number {
    if (!Number.isInteger(page) || page < 1 || page > this.pageCount) throw new SqliteFormatError(`page ${page} is outside the file`);
    return (page - 1) * this.pageSize;
  }

  private leafCell(ptr: number): { rowid: bigint; values: SqlValue[] } {
    const [size, a] = readVarint(this.bytes, ptr);
    const [rowid, b] = readVarint(this.bytes, ptr + a);
    const payloadSize = Number(size);
    const start = ptr + a + b;
    const U = this.usable;
    const X = U - 35;
    let payload: Uint8Array;
    if (payloadSize <= X) {
      payload = this.bytes.subarray(start, start + payloadSize);
    } else {
      const M = Math.floor(((U - 12) * 32) / 255) - 23;
      const K = M + ((payloadSize - M) % (U - 4));
      const local = K <= X ? K : M;
      payload = new Uint8Array(payloadSize);
      payload.set(this.bytes.subarray(start, start + local), 0);
      let filled = local;
      let next = this.view.getUint32(start + local);
      const seen = new Set<number>();
      while (filled < payloadSize) {
        if (next === 0 || seen.has(next)) throw new SqliteFormatError("an overflow chain ends early or loops");
        seen.add(next);
        const off = this.pageOffset(next);
        const take = Math.min(U - 4, payloadSize - filled);
        payload.set(this.bytes.subarray(off + 4, off + 4 + take), filled);
        filled += take;
        next = this.view.getUint32(off);
      }
    }
    return { rowid, values: this.record(payload) };
  }

  private record(p: Uint8Array): SqlValue[] {
    const [hsize, n0] = readVarint(p, 0);
    const headerEnd = Number(hsize);
    const types: number[] = [];
    let at = n0;
    while (at < headerEnd) {
      const [t, n] = readVarint(p, at);
      types.push(Number(t));
      at += n;
    }
    const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
    let off = headerEnd;
    return types.map((t) => {
      switch (t) {
        case 0:
          return null;
        case 1:
          return dv.getInt8(off++);
        case 2:
          off += 2;
          return dv.getInt16(off - 2);
        case 3: {
          const v = (p[off] << 16) | (p[off + 1] << 8) | p[off + 2];
          off += 3;
          return v & 0x800000 ? v - 0x1000000 : v;
        }
        case 4:
          off += 4;
          return dv.getInt32(off - 4);
        case 5: {
          const hi = dv.getInt16(off);
          const lo = dv.getUint32(off + 2);
          off += 6;
          return hi * 0x100000000 + lo;
        }
        case 6:
          off += 8;
          return toNumber(dv.getBigInt64(off - 8));
        case 7:
          off += 8;
          return dv.getFloat64(off - 8);
        case 8:
          return 0;
        case 9:
          return 1;
        default: {
          if (t < 12) throw new SqliteFormatError(`reserved serial type ${t}`);
          const len = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2;
          const slice = p.subarray(off, off + len);
          off += len;
          return t % 2 === 0 ? slice.slice() : this.text.decode(slice);
        }
      }
    });
  }
}

/** A SQLite varint: 1–9 bytes, big-endian groups of 7 bits, the 9th byte whole. */
export function readVarint(b: Uint8Array, at: number): [bigint, number] {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    const byte = b[at + i];
    if (byte === undefined) throw new SqliteFormatError("a varint runs past the end");
    v = (v << 7n) | BigInt(byte & 0x7f);
    if (!(byte & 0x80)) return [BigInt.asIntN(64, v), i + 1];
  }
  const last = b[at + 8];
  if (last === undefined) throw new SqliteFormatError("a varint runs past the end");
  return [BigInt.asIntN(64, (v << 8n) | BigInt(last)), 9];
}

function toNumber(v: bigint): number | bigint {
  return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
}

/** Column names of a CREATE TABLE, and which one is the INTEGER PRIMARY KEY. */
export function parseColumns(sql: string): { columns: string[]; rowidColumn: number } {
  const open = sql.indexOf("(");
  const close = sql.lastIndexOf(")");
  if (open < 0 || close < open) return { columns: [], rowidColumn: -1 };
  const body = sql.slice(open + 1, close);
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`" || ch === "[") {
      quote = ch === "[" ? "]" : ch;
      cur += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const columns: string[] = [];
  let rowidColumn = -1;
  for (const raw of parts) {
    const def = raw.trim();
    if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(def)) continue;
    const m = /^(?:"((?:[^"]|"")*)"|`([^`]*)`|\[([^\]]*)\]|'([^']*)'|(\S+))\s*(.*)$/s.exec(def);
    if (!m) continue;
    const name = (m[1]?.replace(/""/g, '"') ?? m[2] ?? m[3] ?? m[4] ?? m[5]).trim();
    const rest = m[6] ?? "";
    if (/^INTEGER\s+PRIMARY\s+KEY\b(?!\s+DESC)/i.test(rest.trim())) rowidColumn = columns.length;
    columns.push(name);
  }
  return { columns, rowidColumn };
}
