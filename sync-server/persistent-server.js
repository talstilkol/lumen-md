/**
 * Lumen persistent collab server (P2-03).
 *
 * Drop-in y-websocket signalling + storage backend. Each room becomes a Y.Doc
 * persisted to disk with `y-leveldb`, so a tab can re-join an empty room and
 * still recover the latest state — solving the "WebRTC room evaporates when
 * the last peer leaves" limitation.
 *
 * The server is intentionally tiny: it relies on the upstream
 * `y-websocket/utils` wiring for awareness, sync, and persistence callbacks.
 *
 * ── Local dev ─────────────────────────────────────────────────────────────
 *   cd sync-server
 *   npm install y-websocket y-leveldb level    # one-time
 *   PORT=4444 node persistent-server.js        # serves ws://localhost:4444
 *
 * ── Client wiring ─────────────────────────────────────────────────────────
 * Set `VITE_YJS_WEBSOCKET_URL=ws://localhost:4444` in `.env.local`. The
 * client (`src/collab/yjs.ts`) will attach a `WebsocketProvider` alongside
 * the WebRTC peer mesh, so docs survive across full sign-outs.
 *
 * ── Deployment ────────────────────────────────────────────────────────────
 *   • Fly.io: `fly launch && fly deploy` — set the persistent volume to mount
 *     at `./.yjs-persistence`.
 *   • Render / Railway: same, using a persistent disk.
 *   • Always front with TLS (wss://) before exposing publicly.
 */

const WebSocket = require("ws");
const http = require("http");
const path = require("path");

// utils.js is exported by y-websocket and wires up doc lifecycle, awareness,
// and persistence. We require it lazily so this file still parses if the
// dependency is missing (the operator gets a helpful error on startup).
let setupWSConnection;
let LeveldbPersistence;
try {
  ({ setupWSConnection } = require("y-websocket/bin/utils"));
  ({ LeveldbPersistence } = require("y-leveldb"));
} catch (err) {
  console.error(
    "Missing dependency. Run `npm install y-websocket y-leveldb level` first.",
    err.message,
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT || 4444);
const STORAGE_DIR = process.env.YJS_STORAGE_DIR || path.join(__dirname, ".yjs-persistence");

// ── Persistence ──────────────────────────────────────────────────────────────
const persistence = new LeveldbPersistence(STORAGE_DIR);

// y-websocket calls these hooks on each document open/update/close.
const yWebsocketUtils = require("y-websocket/bin/utils");
yWebsocketUtils.setPersistence({
  bindState: async (docName, ydoc) => {
    const persistedYdoc = await persistence.getYDoc(docName);
    const newUpdates = require("yjs").encodeStateAsUpdate(ydoc);
    persistence.storeUpdate(docName, newUpdates);
    require("yjs").applyUpdate(ydoc, require("yjs").encodeStateAsUpdate(persistedYdoc));
    ydoc.on("update", (update) => persistence.storeUpdate(docName, update));
  },
  writeState: () => Promise.resolve(),
});

// ── HTTP + WebSocket ─────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Lumen persistent collab server\n");
});

const wss = new WebSocket.Server({ server });
wss.on("connection", (conn, req) => {
  // The room name comes from the URL path: ws://host/room-name
  setupWSConnection(conn, req, {
    docName: req.url.slice(1).split("?")[0] || "default",
    gc: true,
  });
});

server.listen(PORT, () => {
  console.log(`Lumen persistent collab listening on :${PORT}`);
  console.log(`Storage at ${STORAGE_DIR}`);
});

// Graceful shutdown so LevelDB closes its files cleanly.
function shutdown(signal) {
  console.log(`Received ${signal}, closing…`);
  wss.close();
  server.close(() => {
    persistence.destroy().finally(() => process.exit(0));
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
