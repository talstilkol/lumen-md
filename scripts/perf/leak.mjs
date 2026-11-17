#!/usr/bin/env node
/**
 * Memory leaks (plan W13.V2): a local app stays open for days, so what it
 * opens and closes must leave nothing behind.
 *
 *   node scripts/perf/leak.mjs --notes 500 [--switches 50] [--docs 500]
 *        [--browser [--url http://localhost:5173]] [--typing-min 30] [--json <file>]
 *        [--plant-leak]   keep what is closed: the gate must then fail (its self-check)
 *
 * Node phases (always; the app's own modules, bundled with esbuild):
 *   index    open and close `--notes` notes in the vault index (upsert, a query,
 *            remove), as tabs do;
 *   vault    `--switches` vault switches (a memory backend, the watchVault
 *            listener the index keeps, its unsubscribe);
 *   yjs      `--docs` collaborative documents with comments and a change
 *            listener, unsubscribed and destroyed (src/collab/comments.ts).
 * Each phase measures the heap after a full GC (--expose-gc; the script
 * restarts itself with it) before and after, and counts the objects it closed
 * that are still alive (WeakRef after GC): backends, Y.Doc instances.
 *
 * Browser phase (`--browser`; Chromium through Playwright): with `--url`, the
 * real app — `--notes` notes opened and closed through its own events, and
 * `--typing-min` minutes of typing; without it, a page with the real
 * CodeMirror (the app's editor core) mounting and destroying `--notes`
 * editors. After GC: the JS heap (Runtime.getHeapUsage), DOM nodes and
 * listeners (Memory.getDOMCounters), and the detached DOM nodes counted in a
 * heap snapshot (HeapProfiler).
 *
 * The gate: every phase's heap after GC ≤ its baseline + 10 %, nothing closed
 * still alive, 0 detached DOM nodes. Exit 1 otherwise. A report by object
 * type goes to stdout (and `--json`). Nightly: scripts/nightly/plan.mjs.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const HEAP_SLACK = 0.1;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

/** Heap after a full GC (three rounds: finalizers and WeakRefs settle). */
async function heapAfterGc() {
  for (let i = 0; i < 3; i++) {
    globalThis.gc();
    await new Promise((r) => setTimeout(r, 10));
  }
  return process.memoryUsage().heapUsed;
}

/** One phase's verdict: heap within the slack and nothing closed left alive. */
export function verdict(name, before, after, alive = 0, slack = HEAP_SLACK) {
  const limit = before * (1 + slack);
  return { phase: name, beforeMB: +(before / 2 ** 20).toFixed(2), afterMB: +(after / 2 ** 20).toFixed(2), growthPct: +(((after - before) / before) * 100).toFixed(1), alive, ok: after <= limit && alive === 0 };
}

async function bundleApp() {
  const { build } = await import("esbuild");
  const dir = mkdtempSync(join(tmpdir(), "lumen-leak-"));
  const entry = join(dir, "entry.ts");
  writeFileSync(
    entry,
    [
      `export { VaultIndex } from ${JSON.stringify(join(ROOT, "src/storage/vaultIndexCore.ts"))};`,
      `export { createMemoryBackend } from ${JSON.stringify(join(ROOT, "src/storage/vault/memory.ts"))};`,
      `export { setVaultBackend, watchVault } from ${JSON.stringify(join(ROOT, "src/storage/vault/index.ts"))};`,
      `export { addComment, getCommentsMap, onCommentsChanged } from ${JSON.stringify(join(ROOT, "src/collab/comments.ts"))};`,
      `export * as Y from "yjs";`,
    ].join("\n"),
  );
  const out = join(dir, "app.mjs");
  // LUMEN_ALIAS="yjs=/src/yjs/index.js,lib0=/src/lib0": source checkouts where node_modules has none (an offline machine).
  const alias = process.env.LUMEN_ALIAS ? Object.fromEntries(process.env.LUMEN_ALIAS.split(",").map((kv) => kv.split("="))) : undefined;
  // LUMEN_STUB_MISSING=1 (an offline machine without the full node_modules): a package that is not
  // installed becomes an empty module — the phases only run the vault, the index and Yjs, not the UI it reaches.
  const stub = {
    name: "stub-missing",
    setup(b) {
      if (process.env.LUMEN_STUB_MISSING !== "1") return;
      b.onResolve({ filter: /^[^./]/ }, async (a) => {
        if (a.pluginData?.probe || a.path.startsWith("node:")) return undefined;
        const r = await b.resolve(a.path, { resolveDir: a.resolveDir, kind: a.kind, pluginData: { probe: true } });
        return r.errors.length ? { path: a.path, namespace: "stub" } : r;
      });
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "module.exports = new Proxy(function () {}, { get: (t, k) => (k === '__esModule' ? false : k === 'default' ? module.exports : module.exports), apply: () => undefined, construct: () => ({}) });", loader: "js" }));
    },
  };
  await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error", alias, plugins: [stub], define: { "import.meta.env": "{}" }, loader: { ".json": "json", ".css": "empty", ".svg": "empty", ".wasm": "empty" }, external: ["node:*"] });
  return import(pathToFileURL(out).href);
}

function note(i, size = 2000) {
  let s = `# פתק ${i}\n\nNote ${i} about project ${i % 37}. `;
  while (s.length < size) s += `שורה ${i} עם [[note ${i % 50}]] ו-#tag${i % 9}. `;
  return s;
}

export async function nodePhases({ notes = 500, switches = 50, docs = 500, plant = false } = {}) {
  // --plant-leak: keep what is closed, to show the gate catches it (its own check, not a measurement).
  const planted = [];
  const app = await bundleApp();
  const out = [];

  // index: open and close notes
  {
    const idx = new app.VaultIndex();
    for (let i = 0; i < 200; i++) idx.upsert({ path: `base/${i}.md`, name: `${i}.md`, content: note(i), modified: i });
    idx.search("project", { limit: 20 });
    // A warm-up round: the first churn fills caches that stay by design (the BM25 vocabulary of the terms used).
    for (let i = 0; i < 50; i++) {
      idx.upsert({ path: `open/${i}.md`, name: `${i}.md`, content: note(10_000 + i), modified: i });
      idx.remove(`open/${i}.md`);
    }
    const before = await heapAfterGc();
    for (let i = 0; i < notes; i++) {
      idx.upsert({ path: `open/${i}.md`, name: `${i}.md`, content: note(10_000 + i), modified: i });
      idx.search(`project ${i % 37}`, { limit: 10 });
      idx.backlinks(`base/${i % 200}.md`);
      idx.remove(`open/${i}.md`);
    }
    out.push(verdict("index: open and close notes", before, await heapAfterGc()));
  }

  // vault: switches
  {
    const warm = app.createMemoryBackend();
    app.setVaultBackend(warm);
    const before = await heapAfterGc();
    const refs = [];
    // Each switch in its own function, so no local of the loop keeps the last backend alive.
    const once = async (i) => {
      const b = app.createMemoryBackend({ id: `v${i}` });
      for (let k = 0; k < 20; k++) await b.write(`n${k}.md`, note(k, 400));
      app.setVaultBackend(b);
      const off = app.watchVault(() => undefined);
      await b.write("touch.md", "x");
      off();
      if (plant) planted.push(b);
      return new WeakRef(b);
    };
    for (let i = 0; i < switches; i++) refs.push(await once(i));
    app.setVaultBackend(warm);
    const after = await heapAfterGc();
    out.push(verdict("vault: switches", before, after, refs.filter((r) => r.deref()).length));
  }

  // yjs: collaborative documents
  {
    const before = await heapAfterGc();
    const once = (i) => {
      const doc = new app.Y.Doc();
      const text = doc.getText("md");
      text.insert(0, note(i, 600));
      const off = app.onCommentsChanged(doc, () => undefined);
      app.addComment(doc, text, `@dana ${i}`, 0, 5, { name: "Dana", color: "#c00" });
      off();
      doc.destroy();
      if (plant) planted.push(doc);
      return new WeakRef(doc);
    };
    const refs = [];
    for (let i = 0; i < docs; i++) refs.push(once(i));
    const after = await heapAfterGc();
    out.push(verdict("yjs: documents with comments", before, after, refs.filter((r) => r.deref()).length));
  }
  return out;
}

/** Detached DOM nodes in a Chromium heap snapshot (taken through CDP). */
export function countDetached(snapshot) {
  const m = snapshot.snapshot.meta;
  const F = m.node_fields.length;
  const nameAt = m.node_fields.indexOf("name");
  // V8 marks DOM wrappers with `detachedness` (2 = detached); older snapshots name them "Detached …".
  const detAt = m.node_fields.indexOf("detachedness");
  const strings = snapshot.strings;
  const nodes = snapshot.nodes;
  const byName = new Map();
  for (let i = 0; i < nodes.length; i += F) {
    const name = strings[nodes[i + nameAt]];
    const detached = detAt >= 0 ? nodes[i + detAt] === 2 : name.startsWith("Detached ");
    if (detached) byName.set(name, (byName.get(name) ?? 0) + 1);
  }
  return { total: [...byName.values()].reduce((a, b) => a + b, 0), byName: Object.fromEntries([...byName].sort((a, b) => b[1] - a[1]).slice(0, 10)) };
}

async function heapSnapshot(cdp) {
  const chunks = [];
  const on = (e) => chunks.push(e.chunk);
  cdp.on("HeapProfiler.addHeapSnapshotChunk", on);
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  cdp.off("HeapProfiler.addHeapSnapshotChunk", on);
  return JSON.parse(chunks.join(""));
}

async function gcAndCount(cdp) {
  for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage");
  const heap = await cdp.send("Runtime.getHeapUsage");
  const dom = await cdp.send("Memory.getDOMCounters");
  return { heap: heap.usedSize, nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents };
}

export async function browserPhase({ notes = 500, url, typingMin = 0, plant = false } = {}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  const out = [];
  try {
    if (url) {
      await page.addInitScript(() => localStorage.setItem("lumen-tour-done", "1"));
      await page.goto(url);
      await page.locator(".cm-content").first().waitFor({ timeout: 60_000 });
      const cycle = (i) =>
        page.evaluate(async (i) => {
          const root = await navigator.storage.getDirectory();
          const fh = await root.getFileHandle(`leak-${i % 20}.md`, { create: true });
          const w = await fh.createWritable();
          await w.write(`# leak ${i}\n\n${"text ".repeat(200)}`);
          await w.close();
          window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path: `leak-${i % 20}.md` } }));
          await new Promise((r) => setTimeout(r, 30));
          window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "tabs.close" } }));
        }, i);
      for (let i = 0; i < 20; i++) await cycle(i);
      const before = await gcAndCount(cdp);
      for (let i = 0; i < notes; i++) await cycle(i);
      const after = await gcAndCount(cdp);
      const detached = countDetached(await heapSnapshot(cdp));
      out.push({ ...verdict("app: open and close notes", before.heap, after.heap, 0), nodes: [before.nodes, after.nodes], listeners: [before.listeners, after.listeners], detached, ok: after.heap <= before.heap * (1 + HEAP_SLACK) && detached.total === 0 });
      if (typingMin > 0) {
        await page.locator(".cm-content").first().click();
        const t0 = await gcAndCount(cdp);
        const end = Date.now() + typingMin * 60_000;
        while (Date.now() < end) await page.keyboard.type("שלום world 123 ", { delay: 40 });
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.press("Backspace");
        const t1 = await gcAndCount(cdp);
        out.push({ ...verdict(`app: ${typingMin} min of typing`, t0.heap, t1.heap, 0), nodes: [t0.nodes, t1.nodes], listeners: [t0.listeners, t1.listeners] });
      }
    } else {
      const { build } = await import("esbuild");
      const dir = mkdtempSync(join(tmpdir(), "lumen-leak-page-"));
      const entry = join(dir, "page.ts");
      writeFileSync(
        entry,
        `import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
const host = document.body.appendChild(document.createElement("div"));
(window as any).cycle = (i: number) => {
  const v = new EditorView({ parent: host, state: EditorState.create({ doc: "# פתק " + i + "\\n\\n" + "שלום world 123 ".repeat(300), extensions: [drawSelection(), EditorView.lineWrapping, keymap.of([])] }) });
  v.dispatch({ selection: { anchor: 5 } });
  v.destroy();
  if ((window as any).PLANT) ((window as any).kept ??= []).push(v.dom);
};`,
      );
      const js = await build({ entryPoints: [entry], bundle: true, write: false, format: "iife", logLevel: "error", nodePaths: [join(ROOT, "node_modules"), ...(process.env.LUMEN_NODE_PATHS ?? "").split(":").filter(Boolean)] });
      await page.setContent(`<!doctype html><html><body><script>window.PLANT = ${plant};</script><script>${js.outputFiles[0].text}</script></body></html>`);
      await page.evaluate(() => {
        for (let i = 0; i < 20; i++) window.cycle(i);
      });
      const before = await gcAndCount(cdp);
      await page.evaluate((n) => {
        for (let i = 0; i < n; i++) window.cycle(i);
      }, notes);
      const after = await gcAndCount(cdp);
      const detached = countDetached(await heapSnapshot(cdp));
      out.push({ ...verdict("editor: mount and destroy CodeMirror", before.heap, after.heap, 0), nodes: [before.nodes, after.nodes], listeners: [before.listeners, after.listeners], detached, ok: after.heap <= before.heap * (1 + HEAP_SLACK) && detached.total === 0 && after.nodes <= before.nodes });
    }
  } finally {
    await browser.close();
  }
  return out;
}

export function render(rows) {
  const lines = ["phase                                   heap before → after (MB)  growth  alive  extra", "-".repeat(96)];
  for (const r of rows) {
    const extra = [r.detached ? `detached DOM ${r.detached.total}` : "", r.nodes ? `DOM nodes ${r.nodes[0]}→${r.nodes[1]}` : "", r.listeners ? `listeners ${r.listeners[0]}→${r.listeners[1]}` : ""].filter(Boolean).join(", ");
    lines.push(`${r.ok ? "✓" : "✗"} ${r.phase.padEnd(38)} ${String(r.beforeMB).padStart(7)} → ${String(r.afterMB).padEnd(8)} ${`${r.growthPct}%`.padStart(7)}  ${String(r.alive).padStart(5)}  ${extra}`);
  }
  return lines.join("\n");
}

async function main() {
  if (typeof globalThis.gc !== "function") {
    const r = spawnSync(process.execPath, ["--expose-gc", fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: "inherit" });
    process.exit(r.status ?? 1);
  }
  const notes = Number(arg("notes", "500"));
  const plant = has("plant-leak");
  const rows = await nodePhases({ notes, switches: Number(arg("switches", "50")), docs: Number(arg("docs", String(notes))), plant });
  if (has("browser")) rows.push(...(await browserPhase({ notes, url: arg("url"), typingMin: Number(arg("typing-min", "0")), plant })));
  console.log(render(rows));
  const json = arg("json");
  if (json) {
    mkdirSync(dirname(resolve(json)), { recursive: true });
    writeFileSync(json, JSON.stringify({ at: new Date().toISOString(), node: process.version, rows }, null, 2) + "\n");
  }
  const bad = rows.filter((r) => !r.ok);
  if (!rows.length || bad.length) {
    console.error(`leak: ${bad.length} phase(s) over the baseline + ${HEAP_SLACK * 100} % or with objects left alive`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
