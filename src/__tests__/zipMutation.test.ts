/**
 * Plan 0.15 — storage/zip without mocks or DOM: round trips (stored and
 * deflated), the header fields other tools read, and the import limits that
 * stop a ZIP bomb.
 */
import { describe, expect, it } from "vitest";
import { unzip, unzipText, zip } from "../storage/zip";

const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : null);
const big = "שלום עולם ".repeat(500);

describe("storage/zip", () => {
  it("round-trips stored and deflated entries, Hebrew names included", async () => {
    const z = await zip([
      { name: "a.txt", data: "hello" },
      { name: "תיקייה/ב.md", data: big },
      { name: "bin", data: new Uint8Array([0, 1, 2, 255]), store: true },
      { name: "forced.txt", data: big, store: true },
    ]);
    const files = await unzip(z.buffer);
    expect([...files.keys()]).toEqual(["a.txt", "תיקייה/ב.md", "bin", "forced.txt"]);
    expect(text(files.get("a.txt"))).toBe("hello");
    expect(text(files.get("תיקייה/ב.md"))).toBe(big);
    expect([...files.get("bin")!]).toEqual([0, 1, 2, 255]);
    expect(text(files.get("forced.txt"))).toBe(big);
    expect(z.length).toBeLessThan(big.length * 2 + 2000);
  });

  it("writes the fields other tools rely on", async () => {
    const z = await zip([{ name: "a.txt", data: "hello" }, { name: "ב.txt", data: "x" }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint16(4, true)).toBe(20);
    expect(v.getUint16(6, true)).toBe(0); // ASCII name: no UTF-8 flag
    expect(v.getUint16(8, true)).toBe(0); // stored (5 bytes)
    expect(v.getUint16(12, true)).toBe(0x21);
    expect(v.getUint32(14, true)).toBe(0x3610a686); // CRC-32 of "hello"
    expect(v.getUint32(18, true)).toBe(5);
    expect(v.getUint32(22, true)).toBe(5);
    expect(v.getUint16(26, true)).toBe(5);
    const second = 30 + 5 + 5;
    expect(v.getUint16(second + 6, true)).toBe(0x0800); // UTF-8 name
    const eocd = z.length - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);
    expect(v.getUint16(eocd + 8, true)).toBe(2);
    expect(v.getUint16(eocd + 10, true)).toBe(2);
  });

  it("writes the central directory record by the spec (APPNOTE 4.3.12) and a zero mod time (W10.E26)", async () => {
    const z = await zip([{ name: "a.txt", data: "hello" }, { name: "ב.txt", data: "x".repeat(70) }]);
    const v = new DataView(z.buffer);
    expect(v.getUint16(10, true)).toBe(0); // local mod time
    const eocd = z.length - 22;
    let c = v.getUint32(eocd + 16, true); // central directory offset
    const rows: number[][] = [];
    for (let i = 0; i < 2; i++) {
      expect(v.getUint32(c, true)).toBe(0x02014b50);
      rows.push([4, 6, 8, 10, 12, 14].map((o) => v.getUint16(c + o, true)).concat([v.getUint32(c + 16, true), v.getUint32(c + 20, true), v.getUint32(c + 24, true)]));
      c += 46 + v.getUint16(c + 28, true) + v.getUint16(c + 30, true) + v.getUint16(c + 32, true);
    }
    // made by 2.0, needs 2.0, flags, method, time 0, date 1980-01-01, CRC, compressed, uncompressed.
    expect(rows[0]).toEqual([20, 20, 0, 0, 0, 0x21, 0x3610a686, 5, 5]);
    expect(rows[1].slice(0, 6)).toEqual([20, 20, 0x0800, 8, 0, 0x21]);
    expect(rows[1][8]).toBe(70);
    expect(rows[1][7]).toBeLessThan(70);
  });

  it("reads a real Info-ZIP archive whose entries carry extra fields and file comments", async () => {
    // Made with Zip 3.0 (Info-ZIP): `printf 'comment one\ncomment two\n' | zip -c real.zip a.txt b.txt`.
    // Local and central headers carry a UT/ux extra field (24 / 28 bytes), and each central entry a comment.
    const real = Uint8Array.from(atob("UEsDBAoAAAAAAO0Sb13fMNv0CwAAAAsAAAAFABwAYS50eHRVVAkAA337+Gp9+/hqdXgLAAEEAAAAAAQAAAAAZmlyc3QgZmlsZQpQSwMECgAAAAAA7RJvXSmjGjoJAAAACQAAAAUAHABiLnR4dFVUCQADffv4an37+Gp1eAsAAQQAAAAABAAAAADXqdec15XXnQpQSwECHgMKAAAAAADtEm9d3zDb9AsAAAALAAAABQAYAAsAAAABAAAApIEAAAAAYS50eHRVVAUAA337+Gp1eAsAAQQAAAAABAAAAABjb21tZW50IG9uZVBLAQIeAwoAAAAAAO0Sb10poxo6CQAAAAkAAAAFABgACwAAAAEAAACkgUoAAABiLnR4dFVUBQADffv4anV4CwABBAAAAAAEAAAAAGNvbW1lbnQgdHdvUEsFBgAAAAACAAIArAAAAJIAAAAAAA=="), (ch) => ch.charCodeAt(0));
    const files = await unzip(real.buffer);
    expect([...files.keys()]).toEqual(["a.txt", "b.txt"]);
    expect(text(files.get("a.txt"))).toBe("first file\n");
    expect(text(files.get("b.txt"))).toBe("שלום\n");
  });

  it("deflates entries above 64 bytes and stores the rest", async () => {
    const z = await zip([{ name: "a", data: "x".repeat(64) }, { name: "b", data: "x".repeat(65) }]);
    const v = new DataView(z.buffer);
    expect(v.getUint16(8, true)).toBe(0);
    const second = 30 + 1 + 64;
    expect(v.getUint16(second + 8, true)).toBe(8);
  });

  it("skips directories and reads one entry as text", async () => {
    const z = await zip([{ name: "dir/", data: "" }, { name: "dir/a.md", data: "# hi" }]);
    expect([...(await unzip(z.buffer)).keys()]).toEqual(["dir/a.md"]);
    expect(await unzipText(z.buffer, "dir/a.md")).toBe("# hi");
    expect(await unzipText(z.buffer, "missing.md")).toBe(null);
  });

  it("enforces the per-entry and total limits", async () => {
    const z = await zip([{ name: "a", data: "y".repeat(5000) }, { name: "b", data: "z".repeat(5000) }]);
    await expect(unzip(z.buffer, { maxEntryBytes: 4000 })).rejects.toThrow();
    await expect(unzip(z.buffer, { maxTotalBytes: 8000 })).rejects.toThrow();
    expect((await unzip(z.buffer, { maxEntryBytes: 5000, maxTotalBytes: 10000 })).size).toBe(2);
    const s = await zip([{ name: "s", data: "q".repeat(100), store: true }]);
    await expect(unzip(s.buffer, { maxEntryBytes: 99 })).rejects.toThrow("exceeds the size limit");
    expect((await unzip(s.buffer, { maxEntryBytes: 100 })).size).toBe(1);
    await expect(unzip(s.buffer, { maxTotalBytes: 99 })).rejects.toThrow("total size limit");
  });

  it("refuses what is not a ZIP, and unknown compression", async () => {
    await expect(unzip(new Uint8Array(40).buffer)).rejects.toThrow("Not a ZIP");
    const z = await zip([{ name: "a", data: "hello" }]);
    const v = new DataView(z.buffer);
    const cen = v.getUint32(z.length - 22 + 16, true);
    v.setUint16(cen + 10, 12, true); // bzip2
    await expect(unzip(z.buffer)).rejects.toThrow("Unsupported ZIP compression method 12");
  });
});
