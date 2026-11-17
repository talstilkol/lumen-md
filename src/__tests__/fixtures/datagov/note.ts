/**
 * The note of W7.6 acceptance 3: one data.gov.il block and one CBS block,
 * inserted as the app inserts them, from the recorded fixtures
 * (datasets.json) with no network. Shared by datagovExportPdf.test.ts and
 * e2e/datagov-pdf.spec.ts (no test runner imports here).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importResource, importSeries, type FileStore } from "../../../sources/datagov/core";

interface Fixture { source: "datagov" | "cbs"; slug?: string; resource?: string; series?: string; package_show?: unknown; datastore_search?: unknown; series_data?: unknown }
// Both runners start in the repo root.
const FIX: { datasets: Fixture[] } = JSON.parse(readFileSync(join(process.cwd(), "src/__tests__/fixtures/datagov/datasets.json"), "utf8"));

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

/** The note of the acceptance: one block of each source, as the app inserts them. */
export async function datasetNote() {
  const gov = FIX.datasets.find((d) => d.source === "datagov")!;
  const cbs = FIX.datasets.find((d) => d.source === "cbs")!;
  const a = await importResource({ name: gov.slug! }, gov.resource!, { fetch: services, store: memory(), retrieved: "2026-11-14" });
  const b = await importSeries(cbs.series!, { fetch: services, store: memory(), retrieved: "2026-11-14" });
  return { a, b, md: `# נתונים\n\n${a.markdown}\n${b.markdown}` };
}
