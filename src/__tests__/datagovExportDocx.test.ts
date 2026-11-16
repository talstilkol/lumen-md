/**
 * Plan W7.6 acceptance 3 (the DOCX half): a note with a data.gov.il and a
 * CBS block, exported with the app's DOCX exporter (storage/exportDocx),
 * keeps each attribution line in word/document.xml — the publisher, the
 * dataset's title, the retrieval date and the data link. The PDF half is
 * the browser's print path and stays on the Mac (plan/mac-pack/L6.json).
 * The datasets are the recorded fixtures (fixtures/datagov/datasets.json).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unzip } from "../storage/zip";
import { importResource, importSeries, type FileStore } from "../sources/datagov/core";
import { dataUrl } from "../sources/datagov/snapshot";

interface Fixture { source: "datagov" | "cbs"; slug?: string; resource?: string; series?: string; package_show?: unknown; datastore_search?: unknown; series_data?: unknown }
const FIX: { datasets: Fixture[] } = JSON.parse(readFileSync(join(__dirname, "fixtures", "datagov", "datasets.json"), "utf8"));

const memory = (): FileStore => {
  const files = new Map<string, string>();
  return { read: async (p) => files.get(p) ?? null, write: async (p, c) => void files.set(p, c) };
};
const services = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.pathname.endsWith("/package_show")) return json(FIX.datasets.find((d) => d.slug === url.searchParams.get("id"))!.package_show);
  if (url.pathname.endsWith("/datastore_search")) return json(FIX.datasets.find((x) => x.resource === url.searchParams.get("resource_id"))!.datastore_search);
  if (url.hostname === "apis.cbs.gov.il") return json(FIX.datasets.find((x) => x.series === url.searchParams.get("id"))!.series_data);
  return new Response("not found", { status: 404 });
}) as unknown as typeof fetch;

/** The document's visible text: every w:t run joined. */
async function docxText(md: string): Promise<string> {
  const { markdownToDocxBytes } = await import("../storage/exportDocx");
  const bytes = await markdownToDocxBytes(md);
  const files = await unzip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const xml = new TextDecoder().decode(files.get("word/document.xml")!);
  const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
  const links = [...xml.matchAll(/Target="([^"]+)"/g)].map((m) => m[1]);
  const rels = files.has("word/_rels/document.xml.rels") ? new TextDecoder().decode(files.get("word/_rels/document.xml.rels")!) : "";
  return `${text}\n${links.join("\n")}\n${rels}`.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'");
}

describe("W7.6 attribution survives the DOCX export", () => {
  it("a data.gov.il block and a CBS block: each attribution's parts are in the document", async () => {
    const gov = FIX.datasets.find((d) => d.source === "datagov")!;
    const cbs = FIX.datasets.find((d) => d.source === "cbs")!;
    const a = await importResource({ name: gov.slug! }, gov.resource!, { fetch: services, store: memory(), retrieved: "2026-11-14" });
    const b = await importSeries(cbs.series!, { fetch: services, store: memory(), retrieved: "2026-11-14" });
    const note = `# נתונים\n\n${a.markdown}\n${b.markdown}`;
    const text = await docxText(note);
    for (const part of ["data.gov.il", a.block.title, "נשלף 14.11.2026", dataUrl(a.block)]) expect(text, part).toContain(part);
    for (const part of ['הלשכה המרכזית לסטטיסטיקה (הלמ"ס)', b.block.title, "(14.11.2026)", "as is", dataUrl(b.block)]) expect(text, part).toContain(part);
  });
});
