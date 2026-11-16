/**
 * The benchmark page (plan 7.8): `window.lumenBench`, driven by
 * scripts/bench-models.mjs. Dev server only (bench/models.html is not a
 * build input), so nothing here reaches the app's bundle.
 */
import type { BenchEngine, BenchEnv, BenchFamily, BenchItem, BenchRun } from "./types";

const adapters = import.meta.glob<{ engine: BenchEngine; family?: BenchFamily }>("./engines/*.ts");

const fileOf = (k: string) => k.replace(/^\.\/engines\/|\.ts$/g, "");

/** `<file>` → the file's engine; `<file>:<model>` → that variant of the file's family. */
async function engineById(id: string): Promise<BenchEngine> {
  const cut = id.indexOf(":");
  const file = cut < 0 ? id : id.slice(0, cut);
  const load = adapters[`./engines/${file}.ts`];
  if (!load) throw new Error(`no engine "${id}" (have: ${(await list()).join(", ")})`);
  const mod = await load();
  if (cut < 0) return mod.engine;
  const model = id.slice(cut + 1);
  if (!mod.family?.variants.includes(model)) throw new Error(`no engine "${id}": ${file} has no variant ${model}`);
  return mod.family.variant(model);
}

/** Every engine id: each file, then each variant of a file's family. */
async function list(): Promise<string[]> {
  const ids: string[] = [];
  for (const [k, load] of Object.entries(adapters)) {
    ids.push(fileOf(k));
    const { engine, family } = await load();
    // The file's own engine already covers its one model: no second id for it.
    for (const v of family?.variants ?? []) if (!(engine.models.length === 1 && engine.models[0] === v)) ids.push(`${fileOf(k)}:${v}`);
  }
  return [...new Set(ids)].sort();
}

async function env(): Promise<BenchEnv> {
  const nav = navigator as Navigator & { gpu?: GPU; deviceMemory?: number };
  const base: BenchEnv = { userAgent: navigator.userAgent, webgpu: false, adapter: null, f16: false, maxBufferMB: null, cores: nav.hardwareConcurrency ?? null, deviceMemoryGB: nav.deviceMemory ?? null };
  if (!nav.gpu) return base;
  const adapter = await nav.gpu.requestAdapter().catch(() => null);
  if (!adapter) return base;
  const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
  return {
    ...base,
    webgpu: true,
    adapter: info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null,
    f16: adapter.features.has("shader-f16"),
    maxBufferMB: Math.floor(adapter.limits.maxBufferSize / (1024 * 1024)),
  };
}

function heapMB(): number | null {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round((m.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null;
}

/** Run one engine over the items; times every step, samples the heap. */
async function run(id: string, payload: { shared?: Record<string, unknown>; items: BenchItem[] }): Promise<BenchRun> {
  const out: BenchRun = { engine: id, device: null, model: null, loadMs: null, prepareMs: 0, itemMs: [], outputs: {}, jsHeapPeakMB: heapMB(), error: null };
  const sample = () => {
    const h = heapMB();
    if (h != null && (out.jsHeapPeakMB == null || h > out.jsHeapPeakMB)) out.jsHeapPeakMB = h;
  };
  const timer = setInterval(sample, 100);
  let engine: BenchEngine | null = null;
  try {
    engine = await engineById(id);
    let t = performance.now();
    const info = await engine.load();
    out.loadMs = Math.round(performance.now() - t);
    out.device = info.device;
    out.model = info.model ?? engine.models[0] ?? null;
    const prepared = new Set<string>();
    for (const item of payload.items) {
      if (engine.prepare && !prepared.has(item.part)) {
        prepared.add(item.part);
        t = performance.now();
        await engine.prepare(item.part, payload.shared?.[item.part]);
        out.prepareMs += Math.round(performance.now() - t);
      }
      t = performance.now();
      out.outputs[item.id] = await engine.run(item);
      out.itemMs.push(Math.round((performance.now() - t) * 10) / 10);
      sample();
    }
  } catch (e) {
    // The first line only: an engine's message must not carry held-out data.
    out.error = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).split("\n")[0].slice(0, 200);
  } finally {
    clearInterval(timer);
    sample();
    await engine?.dispose?.().catch(() => {
      // why: the engine may already be disposed; the benchmark's numbers are taken
    });
  }
  return out;
}

async function describe(id: string): Promise<Pick<BenchEngine, "id" | "label" | "set" | "task" | "models">> {
  const e = await engineById(id);
  return { id: e.id, label: e.label, set: e.set, task: e.task ?? e.set, models: e.models };
}

declare global {
  interface Window {
    lumenBench?: { engines: typeof list; describe: typeof describe; env: typeof env; run: typeof run };
  }
}

window.lumenBench = { engines: list, describe, env, run };
document.body.dataset.ready = "1";
