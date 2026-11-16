#!/usr/bin/env node
/**
 * The English spelling worker in a real browser (plan 6.10).
 *
 * spell-en.mjs scores englishSpelling() under Node. This runs the shipped
 * worker itself — src/ai/englishSpell.worker.ts, bundled with esbuild the
 * way the app bundles it (nspell, the privacy-ledger install, the
 * dictionary fetched same-origin from dict/) — inside a module Worker in
 * headless Chromium, sends it every sentence of a split over its message
 * protocol, and scores the answers with the same metrics and targets.
 *
 * It also checks what the worker fetched: only the two dict/ files on the
 * page's own origin, nothing else (local-only: 0 requests to
 * api.languagetool.org or any other host).
 *
 *   node scripts/golden/evals/spell-en-browser.mjs [--set dev|common] [--chromium <path>]
 *     prints one JSON line; exits 1 below target or on any other request
 *
 * Needs playwright (dev dependency) and a Chromium: Playwright's own, or
 * --chromium / PW_CHROMIUM. Numbers only; no item text is printed.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { tsImport } from "tsx/esm/api";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(import.meta.url);
export const TARGETS = { detection_recall: 0.9, fp_word_rate: 0.03 };

/** The worker as the app ships it, minus Vite: the virtual dictionary module is `inline = null` outside Vitest. */
export async function bundleWorker() {
  const out = await build({
    entryPoints: [join(ROOT, "src/ai/englishSpell.worker.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    logLevel: "silent",
    define: { "import.meta.env": JSON.stringify({ BASE_URL: "/", MODE: "production", PROD: true, DEV: false }) },
    plugins: [
      {
        name: "lumen-dictionary-en",
        setup(b) {
          b.onResolve({ filter: /^virtual:lumen-dictionary-en$/ }, () => ({ path: "dict", namespace: "lumen-virtual" }));
          b.onLoad({ filter: /.*/, namespace: "lumen-virtual" }, () => ({ contents: "export const inline = null;", loader: "js" }));
        },
      },
    ],
  });
  return out.outputFiles[0].text;
}

function dictFile(name) {
  const dir = dirname(fileURLToPath(import.meta.resolve("dictionary-en")));
  return readFileSync(join(dir, name), "utf8");
}

export function itemsOf(set) {
  const file = set === "common" ? "src/__tests__/fixtures/spell-en-common.json" : "eval/golden/spell-en/dev/moby.json";
  return JSON.parse(readFileSync(join(ROOT, file), "utf8")).items;
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>spell</title><script type="module">
const w = new Worker("/worker.js", { type: "module" });
let seq = 0; const waiting = new Map();
w.onmessage = (e) => { waiting.get(e.data.id)?.(e.data); waiting.delete(e.data.id); };
w.onerror = (e) => { window.__workerError = String(e.message || e); };
window.check = (text) => new Promise((res) => { const id = ++seq; waiting.set(id, res); w.postMessage({ type: "check", id, text }); });
window.ready = true;
</script>`;

/** Score `items` in the worker; `requests`: every URL the page and its worker asked for. */
export async function runInBrowser(items, { chromium: exe } = {}) {
  const workerJs = await bundleWorker();
  const files = {
    "/": ["text/html", PAGE],
    "/worker.js": ["text/javascript", workerJs],
    "/dict/en-US.aff.txt": ["text/plain; charset=utf-8", dictFile("index.aff")],
    "/dict/en-US.dic.txt": ["text/plain; charset=utf-8", dictFile("index.dic")],
  };
  const served = [];
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    served.push(path);
    const f = files[path];
    if (!f) return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": f[0] }).end(f[1]);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = require("playwright");
  const executablePath = exe ?? process.env.PW_CHROMIUM;
  const browser = await chromium.launch(executablePath && existsSync(executablePath) ? { executablePath } : {});
  const requests = [];
  try {
    const context = await browser.newContext();
    context.on("request", (r) => requests.push(r.url()));
    const page = await context.newPage();
    await page.goto(origin + "/");
    await page.waitForFunction(() => window.ready === true);
    const overlaps = (m, e) => m.offset < e.end && e.start < m.offset + m.length;
    // The checked-word count as spell-en.mjs counts it (the shipped spellWords).
    const { spellWords } = await tsImport("../../../src/ai/englishSpell.ts", import.meta.url);
    const wordsOf = (t) => spellWords(t).length;
    let edits = 0, found = 0, at1 = 0, at5 = 0, words = 0, flagged = 0, failed = 0;
    for (const it of items) {
      const noisy = await page.evaluate((t) => window.check(t), String(it.noisy));
      const clean = await page.evaluate((t) => window.check(t), String(it.clean));
      if (noisy.type !== "result" || clean.type !== "result") failed++;
      for (const e of it.edits ?? []) {
        edits++;
        const m = (noisy.matches ?? []).find((x) => overlaps(x, e));
        if (!m) continue;
        found++;
        if (m.replacements[0] === e.right) at1++;
        if (m.replacements.slice(0, 5).includes(e.right)) at5++;
      }
      words += wordsOf(String(it.clean));
      flagged += (clean.matches ?? []).length;
    }
    const workerError = await page.evaluate(() => window.__workerError ?? null);
    const rate = (a, n) => (n ? a / n : NaN);
    const own = new Set([origin + "/", origin + "/worker.js", origin + "/dict/en-US.aff.txt", origin + "/dict/en-US.dic.txt"]);
    return {
      items: items.length,
      detection_recall: rate(found, edits),
      correction_at1: rate(at1, edits),
      correction_at5: rate(at5, edits),
      fp_word_rate: rate(flagged, words),
      failed_replies: failed,
      worker_error: workerError,
      dict_fetched: served.filter((p) => p.startsWith("/dict/")).length,
      other_requests: requests.filter((u) => !own.has(u)).length,
    };
  } finally {
    await browser.close();
    server.close();
  }
}

export function meetsTargets(s) {
  return s.detection_recall >= TARGETS.detection_recall && s.fp_word_rate <= TARGETS.fp_word_rate && s.failed_replies === 0 && !s.worker_error && s.other_requests === 0 && s.dict_fetched === 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
  const set = arg("--set") ?? "dev";
  const s = await runInBrowser(itemsOf(set), { chromium: arg("--chromium") });
  console.log(JSON.stringify({ set, runner: "chromium module worker", ...s, targets: TARGETS, pass: meetsTargets(s) }));
  process.exit(meetsTargets(s) ? 0 : 1);
}
