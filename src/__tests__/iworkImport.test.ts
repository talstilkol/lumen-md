/**
 * Apple iWork import (.pages / .numbers / .key). Fixtures are synthesized
 * here: real ZIPs (via the zip writer), real snappy blocks (literal + copy
 * elements), Apple's IWA chunk framing, and protobuf ArchiveInfo/payload
 * streams shaped like the ones Pages/Numbers/Keynote write.
 */
import { describe, it, expect } from "vitest";
import { zip } from "../storage/zip";
import {
  snappyDecompress,
  decodeIwa,
  parseIwaMessages,
  extractIwaText,
  iworkXmlToMarkdown,
  iworkToMarkdown,
  looksLikeText,
} from "../storage/iwork";
import { fileToMarkdown, isSupportedFormat } from "../storage/fileFormats";

/* ─── tiny encoders ─── */

const enc = new TextEncoder();

function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return out;
}

const cat = (...parts: (Uint8Array | number[])[]) => {
  const arr = parts.flatMap((p) => Array.from(p));
  return new Uint8Array(arr);
};

const pbVarint = (num: number, v: number) => cat(varint(num * 8), varint(v));
const pbBytes = (num: number, b: Uint8Array) => cat(varint(num * 8 + 2), varint(b.length), b);
const pbString = (num: number, s: string) => pbBytes(num, enc.encode(s));

/** Snappy block made only of literal elements (valid, uncompressed). */
function snappyLiteral(data: Uint8Array): Uint8Array {
  const parts: number[][] = [varint(data.length)];
  for (let i = 0; i < data.length; i += 60) {
    const chunk = data.subarray(i, i + 60);
    parts.push([(chunk.length - 1) << 2], Array.from(chunk));
  }
  return cat(...parts);
}

/** Wrap snappy blocks in Apple's IWA framing. */
function iwaFrame(...blocks: Uint8Array[]): Uint8Array {
  return cat(
    ...blocks.map((b) => cat([0, b.length & 0xff, (b.length >> 8) & 0xff, (b.length >> 16) & 0xff], b)),
  );
}

/** One IWA object: varint(len) ArchiveInfo + payload. */
function iwaObject(id: number, type: number, payload: Uint8Array): Uint8Array {
  const messageInfo = cat(pbVarint(1, type), pbVarint(2, 1), pbVarint(3, payload.length));
  const archiveInfo = cat(pbVarint(1, id), pbBytes(2, messageInfo));
  return cat(varint(archiveInfo.length), archiveInfo, payload);
}

function fileFrom(bytes: Uint8Array, name: string): File {
  return {
    name,
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File;
}

const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);

/* ─── snappy + framing ─── */

describe("snappyDecompress", () => {
  it("decodes literal-only blocks", () => {
    const data = enc.encode("hello snappy ".repeat(12));
    expect(new TextDecoder().decode(snappyDecompress(snappyLiteral(data)))).toBe("hello snappy ".repeat(12));
  });

  it("decodes 1- and 2-byte-offset copies, including overlapping runs", () => {
    // "abcd" literal, then copy-1 (len 8, offset 4) → "abcdabcdabcd",
    // then copy-2 (len 6, offset 1) → six more "d"s (overlapping RLE copy).
    const block = cat(
      varint(18),
      [(4 - 1) << 2], enc.encode("abcd"),
      [((8 - 4) << 2) | 1, 4],
      [((6 - 1) << 2) | 2, 1, 0],
    );
    expect(new TextDecoder().decode(snappyDecompress(block))).toBe("abcdabcdabcddddddd");
  });

  it("decodes long literals with an extra length byte", () => {
    const data = enc.encode("x".repeat(200));
    const block = cat(varint(200), [60 << 2, 199], data);
    expect(snappyDecompress(block).length).toBe(200);
  });

  it("rejects malformed blocks", () => {
    expect(() => snappyDecompress(cat(varint(10), [((4 - 4) << 2) | 1, 9]))).toThrow();
    expect(() => snappyDecompress(cat(varint(5), [(2 - 1) << 2], enc.encode("ab")))).toThrow(/length mismatch/);
  });
});

describe("decodeIwa", () => {
  it("concatenates multiple framed chunks (no CRC, no stream header)", () => {
    const framed = iwaFrame(snappyLiteral(enc.encode("first-")), snappyLiteral(enc.encode("second")));
    expect(new TextDecoder().decode(decodeIwa(framed))).toBe("first-second");
  });

  it("rejects unknown chunk types", () => {
    expect(() => decodeIwa(new Uint8Array([1, 0, 0, 0]))).toThrow(/chunk type/);
  });

  it("bounds the cumulative decompressed size before allocating", () => {
    const block = snappyLiteral(new TextEncoder().encode("x".repeat(40)));
    const framed = iwaFrame(block, block, block);
    expect(decodeIwa(framed, 120).length).toBe(120);
    expect(() => decodeIwa(framed, 100)).toThrow(/exceeds limit/);
    // A block that merely *declares* a huge size is refused up front.
    const huge = new Uint8Array([...varint(200 * 1024 * 1024), 0]);
    expect(() => decodeIwa(iwaFrame(huge))).toThrow(/exceeds limit/);
  });
});

/* ─── protobuf / IWA messages ─── */

function pagesDocumentIwa(): Uint8Array {
  // TSWP.StorageArchive (type 2001): field 3 = text, paragraphs split by \n;
  // U+FFFC marks an inline image attachment and must be dropped.
  const storage = cat(pbVarint(1, 0), pbString(3, "Quarterly Report\nRevenue grew \ufffcby 12% this quarter.\n\nNext steps follow."));
  const styleNoise = cat(pbString(1, "com.apple.style.body"), pbVarint(2, 7));
  const stream = cat(iwaObject(1, 10000, styleNoise), iwaObject(2, 2001, storage));
  return iwaFrame(snappyLiteral(stream));
}

describe("parseIwaMessages / extractIwaText", () => {
  it("splits an IWA stream into typed messages", () => {
    const msgs = parseIwaMessages(decodeIwa(pagesDocumentIwa()));
    expect(msgs.map((m) => [m.id, m.type])).toEqual([[1, 10000], [2, 2001]]);
  });

  it("extracts StorageArchive paragraphs and table string lists", () => {
    const tableList = cat(
      pbVarint(1, 1),
      pbVarint(2, 3),
      pbBytes(3, cat(pbVarint(1, 1), pbVarint(2, 1), pbString(3, "Apples"))),
      pbBytes(3, cat(pbVarint(1, 2), pbVarint(2, 1), pbString(3, "Pears"))),
    );
    const files = new Map([
      ["Index/Document.iwa", pagesDocumentIwa()],
      ["Index/Tables/DataList.iwa", iwaFrame(snappyLiteral(iwaObject(9, 6005, tableList)))],
    ]);
    const ex = extractIwaText(files);
    expect(ex.heuristic).toBe(false);
    expect(ex.paragraphs).toEqual([
      "Quarterly Report",
      "Revenue grew by 12% this quarter.",
      "Next steps follow.",
    ]);
    expect(ex.tableStrings).toEqual(["Apples", "Pears"]);
  });

  it("bounds decompression across all IWA files of a document", () => {
    const one = (text: string) => iwaFrame(snappyLiteral(iwaObject(3, 4242, cat(pbString(2, text)))));
    const decodedSize = decodeIwa(one("Component number 1 text.")).length;
    const files = new Map<string, Uint8Array>();
    for (let i = 1; i <= 5; i++) files.set(`Index/Part-${i}.iwa`, one(`Component number ${i} text.`));
    // Budget for two components: the rest are never decompressed.
    const ex = extractIwaText(files, decodedSize * 2);
    expect(ex.paragraphs).toEqual(["Component number 1 text.", "Component number 2 text."]);
    expect(extractIwaText(files).paragraphs).toHaveLength(5);
  });

  it("falls back to a heuristic scan of nested string fields", () => {
    const nested = cat(pbBytes(4, cat(pbString(2, "A sentence hidden in an unknown message."))), pbString(5, "com.apple.iWork.id"));
    const ex = extractIwaText(new Map([["Index/Other.iwa", iwaFrame(snappyLiteral(iwaObject(3, 4242, nested)))]]));
    expect(ex.heuristic).toBe(true);
    expect(ex.paragraphs).toEqual(["A sentence hidden in an unknown message."]);
  });

  it("looksLikeText filters identifiers but keeps prose (incl. Hebrew)", () => {
    expect(looksLikeText("Hello world")).toBe(true);
    expect(looksLikeText("שלום עולם")).toBe(true);
    expect(looksLikeText("com.apple.style")).toBe(false);
    expect(looksLikeText("ABCDEF12-3456")).toBe(false);
    expect(looksLikeText("x")).toBe(false);
  });
});

/* ─── legacy XML iWork ─── */

const PAGES09 = `<?xml version="1.0"?>
<sl:document xmlns:sl="http://developer.apple.com/namespaces/sl" xmlns:sf="http://developer.apple.com/namespaces/sf">
  <sf:text-storage>
    <sf:text-body>
      <sf:p>Hello from Pages '09</sf:p>
      <sf:p>Second <sf:span>paragraph</sf:span> here.</sf:p>
    </sf:text-body>
  </sf:text-storage>
  <sf:tabular-model sf:name="Fruit">
    <sf:grid sf:numcols="2" sf:numrows="3">
      <sf:datasource>
        <sf:t><sf:ct sfa:s="Name" xmlns:sfa="http://developer.apple.com/namespaces/sfa"/></sf:t>
        <sf:t><sf:ct sfa:s="Qty" xmlns:sfa="http://developer.apple.com/namespaces/sfa"/></sf:t>
        <sf:t><sf:ct sfa:s="Apple" xmlns:sfa="http://developer.apple.com/namespaces/sfa"/></sf:t>
        <sf:n sf:v="5"/>
        <sf:t><sf:ct sfa:s="Pear | green" xmlns:sfa="http://developer.apple.com/namespaces/sfa"/></sf:t>
        <sf:g/>
      </sf:datasource>
    </sf:grid>
  </sf:tabular-model>
</sl:document>`;

const KEY09 = `<?xml version="1.0"?>
<key:presentation xmlns:key="http://developer.apple.com/namespaces/keynote2" xmlns:sf="http://developer.apple.com/namespaces/sf">
  <key:slide-list>
    <key:slide><sf:p>Intro</sf:p><sf:p>Welcome everyone</sf:p></key:slide>
    <key:slide><sf:p>Roadmap</sf:p></key:slide>
  </key:slide-list>
</key:presentation>`;

describe("iworkXmlToMarkdown", () => {
  it("extracts paragraphs and tabular-model grids", () => {
    const md = iworkXmlToMarkdown(PAGES09);
    expect(md).toContain("Hello from Pages '09");
    expect(md).toContain("Second paragraph here.");
    expect(md).toContain("### Fruit");
    expect(md).toContain("| Name | Qty |");
    expect(md).toContain("| Apple | 5 |");
    expect(md).toContain("| Pear \\| green |  |");
  });

  it("renders Keynote '09 slides as sections", () => {
    const md = iworkXmlToMarkdown(KEY09);
    expect(md).toContain("## Slide 1: Intro");
    expect(md).toContain("Welcome everyone");
    expect(md).toContain("## Slide 2: Roadmap");
  });
});

/* ─── end-to-end ─── */

describe("iworkToMarkdown / fileToMarkdown", () => {
  it("imports a modern .pages (IWA) with preview image and a fidelity note", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const archive = await zip([
      { name: "Index/Document.iwa", data: pagesDocumentIwa() },
      { name: "preview.jpg", data: jpeg, store: true },
      { name: "Metadata/Properties.plist", data: "<plist/>" },
    ]);
    const { name, content } = await fileToMarkdown(fileFrom(archive, "Report.pages"));
    expect(name).toBe("Report.md");
    expect(content).toMatch(/Imported from Apple Pages \(iWork IWA format\) — limited fidelity/);
    expect(content).toContain("![Document preview](data:image/jpeg;base64,/9j/4AECA//Z)");
    expect(content).toContain("Quarterly Report\n\nRevenue grew by 12% this quarter.");
  });

  it("imports a legacy .key (gzipped index.apxl)", async () => {
    const { gzipSync } = await import("node:zlib");
    const gz = new Uint8Array(gzipSync(Buffer.from(KEY09)));
    const archive = await zip([{ name: "index.apxl.gz", data: gz, store: true }]);
    const md = await iworkToMarkdown(buf(archive), "key");
    expect(md).toContain("Imported from Apple Keynote (iWork '09 XML format)");
    expect(md).toContain("## Slide 2: Roadmap");
  });

  it("imports a legacy .numbers (index.xml) table", async () => {
    const archive = await zip([{ name: "index.xml", data: PAGES09 }]);
    const md = await iworkToMarkdown(buf(archive), "numbers");
    expect(md).toContain("Apple Numbers");
    expect(md).toContain("| Apple | 5 |");
  });

  it("uses the QuickLook PDF fallback when IWA yields no text", async () => {
    const archive = await zip([
      { name: "Index/Document.iwa", data: iwaFrame(snappyLiteral(iwaObject(1, 1, cat(pbVarint(1, 3))))) },
      { name: "QuickLook/Preview.pdf", data: "%PDF-fake" },
    ]);
    const md = await iworkToMarkdown(buf(archive), "pages", {
      pdfFallback: async (pdf) => `PDF text (${pdf.length} bytes)`,
    });
    expect(md).toContain("text came from the embedded QuickLook PDF preview");
    expect(md).toContain("PDF text (9 bytes)");
  });

  it("degrades with a visible warning for non-iWork archives and non-zips", async () => {
    const archive = await zip([{ name: "random.txt", data: "hi" }]);
    expect(await iworkToMarkdown(buf(archive), "pages")).toMatch(/doesn't look like an Apple Pages document/);
    expect(await iworkToMarkdown(new Uint8Array([1, 2, 3]).buffer, "numbers")).toMatch(/Could not read Apple Numbers file/);
  });

  it("registers .pages / .numbers / .key as import extensions", () => {
    expect(isSupportedFormat("a.pages")).toBe(true);
    expect(isSupportedFormat("a.numbers")).toBe(true);
    expect(isSupportedFormat("a.key")).toBe(true);
  });
});

describe("ZIP inflation limits", () => {
  it("stops inflating an entry past the per-entry limit", async () => {
    const { unzip } = await import("../storage/zip");
    const bomb = await zip([{ name: "big.bin", data: new Uint8Array(2 * 1024 * 1024) }]); // zeros compress tiny
    expect(bomb.length).toBeLessThan(64 * 1024);
    await expect(unzip(bomb.slice().buffer, { maxEntryBytes: 1024 * 1024 })).rejects.toThrow(/size limit/);
    expect((await unzip(bomb.slice().buffer)).get("big.bin")!.length).toBe(2 * 1024 * 1024);
  });

  it("enforces a total limit across entries", async () => {
    const { unzip } = await import("../storage/zip");
    const many = await zip(
      Array.from({ length: 4 }, (_, i) => ({ name: `p${i}.bin`, data: new Uint8Array(512 * 1024) })),
    );
    await expect(unzip(many.slice().buffer, { maxTotalBytes: 1024 * 1024 })).rejects.toThrow(/size limit/);
  });

  it("the iWork importer applies its limits to the outer package", async () => {
    const { IWORK_UNZIP_LIMITS } = await import("../storage/iwork");
    expect(IWORK_UNZIP_LIMITS.maxEntryBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
});

describe("legacy iWork gzip limit", () => {
  it("stops inflating a gzip member past its cap", async () => {
    const { gunzip } = await import("../storage/iwork");
    const cs = new CompressionStream("gzip");
    const big = new Uint8Array(2 * 1024 * 1024);
    const src = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(big);
        c.close();
      },
    });
    const reader = src.pipeThrough(cs as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    const gz = new Uint8Array(parts.reduce((a, c) => a + c.length, 0));
    let o = 0;
    for (const p of parts) {
      gz.set(p, o);
      o += p.length;
    }
    expect(gz.length).toBeLessThan(64 * 1024);
    await expect(gunzip(gz, 1024 * 1024)).rejects.toThrow(/size limit/);
    expect((await gunzip(gz)).length).toBe(2 * 1024 * 1024);
  });
});
