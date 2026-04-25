const WebSocket = require("ws");
const http = require("http");

console.log("Starting CRDT Sync Server boundary...");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Lumen IDE CRDT Sync Server");
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

wss.on("connection", (ws) => {
  let currentRoom = null;
  let peerId = null;

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "join") {
        currentRoom = data.room;
        peerId = data.peerId;

        if (!rooms.has(currentRoom)) {
          rooms.set(currentRoom, new Set());
        }
        rooms.get(currentRoom).add(ws);
        console.log(`[${currentRoom}] Peer joined: ${peerId}`);
      } else if (data.type === "sync" && currentRoom) {
        // Broadcast CRDT operations to other peers in the room
        const clients = rooms.get(currentRoom);
        if (clients) {
          clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({
                  type: "sync",
                  ops: data.ops,
                }),
              );
            }
          });
        }
      }
    } catch (e) {
      console.error("Parse error", e);
    }
  });

  ws.on("close", () => {
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(ws);
      if (rooms.get(currentRoom).size === 0) {
        rooms.delete(currentRoom);
        console.log(`[${currentRoom}] Room destroyed (empty)`);
      }
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`CRDT Sync Relay running on ws://localhost:${PORT}`);
});
