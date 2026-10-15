/**
 * Lumen y-webrtc signaling server.
 *
 * Speaks the y-webrtc signaling protocol (mirrors the reference
 * implementation in `y-webrtc/bin/server.js`):
 *
 *   client → server  {type:'subscribe',   topics:[...]}
 *   client → server  {type:'unsubscribe', topics:[...]}
 *   client → server  {type:'publish',     topic, ...}   → forwarded to every
 *                    subscriber of `topic` (INCLUDING the sender), with a
 *                    `clients` field set to the subscriber count.
 *   client → server  {type:'ping'}  → server replies {type:'pong'}
 *
 * Legacy protocol (kept because it is cheap): `{type:'join', room}` subscribes
 * the socket to `room` and replies `{type:'joined', room, peers}`; any other
 * message from a joined socket is relayed to the other members of that room.
 *
 * Usage:
 *   node server.js                      # listens on $PORT (default 4444)
 *   require('./server').createServer({ port: 0, heartbeatMs: 100 })
 */

const WebSocket = require("ws");
const http = require("http");

const log = (...args) => {
  if (process.env.SIGNAL_QUIET) return;
  console.log(new Date().toISOString(), ...args);
};

const DEFAULT_PORT = 4444;
const DEFAULT_HEARTBEAT_MS = 30_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 120; // messages per minute per IP (SIGNAL_RATE_LIMIT_MAX)

/**
 * @param {{ port?: number, heartbeatMs?: number, rateLimitMax?: number }} [opts]
 * @returns {Promise<{ server: http.Server, wss: WebSocket.Server, port: number, topics: Map<string, Set<WebSocket>>, close: () => Promise<void> }>}
 */
function createServer(opts = {}) {
  const port = opts.port ?? Number(process.env.PORT || DEFAULT_PORT);
  const heartbeatMs =
    opts.heartbeatMs ?? Number(process.env.SIGNAL_HEARTBEAT_MS || DEFAULT_HEARTBEAT_MS);
  const rateLimitMax =
    opts.rateLimitMax ?? Number(process.env.SIGNAL_RATE_LIMIT_MAX || DEFAULT_RATE_LIMIT_MAX);

  /** topic -> Set<ws> */
  const topics = new Map();
  /** ip -> { count, resetAt } */
  const ipMap = new Map();

  function checkRateLimit(ip) {
    const now = Date.now();
    const entry = ipMap.get(ip);
    if (!entry || now > entry.resetAt) {
      ipMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }
    entry.count++;
    return entry.count <= rateLimitMax;
  }

  function send(conn, message) {
    if (conn.readyState !== WebSocket.CONNECTING && conn.readyState !== WebSocket.OPEN) {
      conn.close();
      return;
    }
    try {
      conn.send(JSON.stringify(message));
    } catch {
      conn.close();
    }
  }

  function subscribe(conn, topicName) {
    let subs = topics.get(topicName);
    if (!subs) {
      subs = new Set();
      topics.set(topicName, subs);
    }
    subs.add(conn);
    conn.subscribedTopics.add(topicName);
  }

  function unsubscribe(conn, topicName) {
    const subs = topics.get(topicName);
    if (subs) {
      subs.delete(conn);
      if (subs.size === 0) topics.delete(topicName);
    }
    conn.subscribedTopics.delete(topicName);
  }

  const startedAt = Date.now();
  const health = () => ({
    ok: true,
    status: "ok",
    service: "lumen-signal",
    topics: topics.size,
    // Backwards-compatible alias for the old `rooms` field.
    rooms: topics.size,
    clients: wss.clients.size,
    uptime: (Date.now() - startedAt) / 1000,
  });

  const server = http.createServer((req, res) => {
    const pathname = (req.url || "/").split("?")[0];
    if (pathname === "/healthz" || pathname === "/health" || pathname === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(health()));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });

  const wss = new WebSocket.Server({ server });

  wss.on("connection", (ws, req) => {
    const ip = (req && req.socket && req.socket.remoteAddress) || "unknown";
    ws.isAlive = true;
    ws.subscribedTopics = new Set();
    /** Legacy `join` room, if any. */
    let legacyRoom = null;
    let closed = false;

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw) => {
      if (closed) return;
      // Any traffic proves liveness.
      ws.isAlive = true;
      if (!checkRateLimit(ip)) {
        send(ws, { type: "error", error: "Rate limit exceeded" });
        ws.close(1008, "Rate limit exceeded");
        return;
      }

      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (e) {
        log("Parse error", e.message);
        send(ws, { type: "error", error: "Invalid JSON" });
        return;
      }
      if (!message || typeof message.type !== "string") return;

      switch (message.type) {
        case "subscribe":
          (Array.isArray(message.topics) ? message.topics : []).forEach((t) => {
            if (typeof t === "string") subscribe(ws, t);
          });
          return;
        case "unsubscribe":
          (Array.isArray(message.topics) ? message.topics : []).forEach((t) => {
            if (typeof t === "string") unsubscribe(ws, t);
          });
          return;
        case "publish": {
          if (!message.topic) return;
          const receivers = topics.get(message.topic);
          if (receivers) {
            message.clients = receivers.size;
            receivers.forEach((receiver) => send(receiver, message));
          }
          return;
        }
        case "ping":
          send(ws, { type: "pong" });
          return;
        case "join": {
          // Legacy protocol.
          if (typeof message.room !== "string") return;
          if (legacyRoom) unsubscribe(ws, legacyRoom);
          legacyRoom = message.room;
          subscribe(ws, legacyRoom);
          log(`[${legacyRoom}] Peer joined: ${message.peerId || "anon"} (${ip})`);
          send(ws, { type: "joined", room: legacyRoom, peers: topics.get(legacyRoom).size });
          return;
        }
        default: {
          // Legacy relay: forward to the other members of the joined room.
          if (!legacyRoom) return;
          const clients = topics.get(legacyRoom);
          if (!clients) return;
          clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) send(client, message);
          });
        }
      }
    });

    ws.on("close", () => {
      closed = true;
      Array.from(ws.subscribedTopics).forEach((t) => unsubscribe(ws, t));
    });
  });

  // ── Heartbeat ──────────────────────────────────────────────────────────
  // Each tick: sockets that haven't answered the previous ping (or sent any
  // message) since the last tick are terminated; the rest get a fresh ping.
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    });
  }, heartbeatMs);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  const close = () =>
    new Promise((resolve) => {
      clearInterval(heartbeat);
      wss.clients.forEach((ws) => ws.terminate());
      wss.close(() => server.close(() => resolve()));
    });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      const actualPort = server.address().port;
      resolve({ server, wss, port: actualPort, topics, close });
    });
  });
}

module.exports = { createServer, DEFAULT_PORT, DEFAULT_HEARTBEAT_MS };

if (require.main === module) {
  createServer().then(({ port, close }) => {
    log(`y-webrtc signaling server running on ws://localhost:${port}`);
    log(`Health check: http://localhost:${port}/healthz`);
    const shutdown = (sig) => {
      log(`Received ${sig}, closing…`);
      close().then(() => process.exit(0));
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  });
}
