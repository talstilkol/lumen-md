/**
 * Marketplace HTTP service — a thin, dependency-free wrapper over ./registry.mjs
 * with JSON-file persistence. Replaces the old static registry.json +
 * localStorage-counter facade with a real publish / install / rate backend.
 *
 *   GET  /items?type=&q=          list (ranked by real download count)
 *   POST /items                   publish/update  { id, type, name, ... }
 *   POST /items/:id/install       record a real install → { downloads }
 *   POST /items/:id/rate          add a 1–5 rating   { rating } → { rating: avg }
 *   GET  /healthz
 *
 *   start:  node server.mjs   (PORT, MARKETPLACE_DATA env overrides)
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  createStore,
  listItems,
  publishItem,
  recordInstall,
  rateItem,
  dumpStore,
} from "./registry.mjs";

const DATA_FILE = process.env.MARKETPLACE_DATA || "./marketplace-data.json";
const PORT = Number(process.env.PORT) || 8090;

function loadStore() {
  if (existsSync(DATA_FILE)) {
    try {
      return createStore(JSON.parse(readFileSync(DATA_FILE, "utf8")));
    } catch {
      /* corrupt file → start fresh */
    }
  }
  return createStore();
}
const store = loadStore();
function persist() {
  try {
    writeFileSync(DATA_FILE, JSON.stringify(dumpStore(store), null, 1));
  } catch {
    /* best effort */
  }
}

function json(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname.split("/").filter(Boolean);
  try {
    if (req.method === "GET" && p[0] === "healthz") {
      return json(res, 200, { ok: true, items: store.items.size });
    }
    if (req.method === "GET" && p[0] === "items" && p.length === 1) {
      return json(res, 200, listItems(store, {
        type: url.searchParams.get("type") || undefined,
        query: url.searchParams.get("q") || undefined,
      }));
    }
    if (req.method === "POST" && p[0] === "items" && p.length === 1) {
      const item = publishItem(store, await readBody(req));
      persist();
      return json(res, 201, item);
    }
    if (req.method === "POST" && p[0] === "items" && p[2] === "install") {
      const downloads = recordInstall(store, decodeURIComponent(p[1]));
      persist();
      return json(res, 200, { downloads });
    }
    if (req.method === "POST" && p[0] === "items" && p[2] === "rate") {
      const { rating } = await readBody(req);
      const avg = rateItem(store, decodeURIComponent(p[1]), rating);
      persist();
      return json(res, 200, { rating: avg });
    }
    return json(res, 404, { error: "not found" });
  } catch (e) {
    return json(res, 400, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, () => console.log(`marketplace-server listening on :${PORT}`));
