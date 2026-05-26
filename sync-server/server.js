const WebSocket = require("ws");
const http = require("http");

const log = (...args) => console.log(new Date().toISOString(), ...args);

// ── Rate limiting ──────────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120; // messages per minute per IP
const ipMap = new Map(); // ip -> { count, resetAt }

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = ipMap.get(ip);
  if (!entry || now > entry.resetAt) {
    ipMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// ── Room registry ───────────────────────────────────────────────────────────
const rooms = new Map(); // roomId -> Set<ws>
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 90_000;

// ── HTTP server ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: rooms.size, uptime: process.uptime() }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Lumen IDE CRDT Sync Server\n");
});

// ── WebSocket server ─────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {
  let currentRoom = null;
  let peerId = null;
  let lastPong = Date.now();

  const ip = req.socket.remoteAddress || "unknown";

  ws.on("message", (message) => {
    if (!checkRateLimit(ip)) {
      ws.send(JSON.stringify({ type: "error", error: "Rate limit exceeded" }));
      ws.close(1008, "Rate limit exceeded");
      return;
    }

    try {
      const data = JSON.parse(message);

      if (data.type === "join") {
        // Leave previous room if switching
        if (currentRoom && rooms.has(currentRoom)) {
          rooms.get(currentRoom).delete(ws);
          if (rooms.get(currentRoom).size === 0) {
            rooms.delete(currentRoom);
          }
        }

        currentRoom = data.room;
        peerId = data.peerId || "anon";

        if (!rooms.has(currentRoom)) {
          rooms.set(currentRoom, new Set());
        }
        rooms.get(currentRoom).add(ws);
        log(`[${currentRoom}] Peer joined: ${peerId} (${ip})`);

        // Notify peer of room occupancy
        ws.send(JSON.stringify({
          type: "joined",
          room: currentRoom,
          peers: rooms.get(currentRoom).size,
        }));
        return;
      }

      // Relay: any message with a target room goes only to that room
      if (currentRoom) {
        const clients = rooms.get(currentRoom);
        if (clients) {
          const out = JSON.stringify(data);
          clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(out);
            }
          });
        }
      }
    } catch (e) {
      log("Parse error", e.message);
      ws.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
    }
  });

  ws.on("pong", () => {
    lastPong = Date.now();
  });

  ws.on("close", () => {
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(ws);
      if (rooms.get(currentRoom).size === 0) {
        rooms.delete(currentRoom);
        log(`[${currentRoom}] Room destroyed (empty)`);
      } else {
        log(`[${currentRoom}] Peer left: ${peerId}`);
      }
    }
  });

  // Send initial ping setup
  ws.isAlive = true;
});

// ── Heartbeat / cleanup ─────────────────────────────────────────────────────
const heartbeat = setInterval(() => {
  const now = Date.now();
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, PING_INTERVAL_MS);

// ── Startup ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  log(`CRDT Sync Relay running on ws://localhost:${PORT}`);
  log(`Health check: http://localhost:${PORT}/healthz`);
});

server.on("close", () => clearInterval(heartbeat));
