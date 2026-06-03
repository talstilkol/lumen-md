/**
 * Lumen headless conversion API — a thin HTTP wrapper over the (tested) CLI
 * converters in src/cli/convert.ts. No browser/jsdom required.
 *
 *   GET  /healthz
 *   GET  /formats                     supported import/export formats
 *   POST /convert  { name, text, to } → { name, text }   (400 on bad input)
 *
 *   start:  npx tsx api-server/server.ts      (PORT env overrides)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handleConvert, listFormats } from "../src/cli/convert";

const PORT = Number(process.env.PORT) || 8091;

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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
  const url = new URL(req.url || "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/formats") return send(res, 200, listFormats());
    if (req.method === "POST" && url.pathname === "/convert") {
      return send(res, 200, handleConvert(await readBody(req)));
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 400, { error: String((e as Error).message || e) });
  }
});

server.listen(PORT, () => console.log(`lumen convert API listening on :${PORT}`));
