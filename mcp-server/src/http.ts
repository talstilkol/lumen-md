/**
 * Streamable HTTP for the vault server, per MCP 2026-07-28 (plan W11.I8;
 * https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http.md).
 * `lumen mcp serve --http [port]` listens on 127.0.0.1 only.
 *
 *   • One endpoint, `/mcp`, POST only. GET and DELETE (the old stream and
 *     sessions) answer 405; `Mcp-Session-Id` and `Last-Event-ID` are ignored.
 *   • `Origin`, when present, must be a loopback origin, else 403 (DNS rebinding).
 *   • Request metadata headers (SEP-2243), on every 2026-07-28 request:
 *     `MCP-Protocol-Version` = `_meta` protocolVersion, `Mcp-Method` = `method`,
 *     and for tools/call, resources/read and prompts/get `Mcp-Name` =
 *     `params.name` / `params.uri` (Base64 sentinel `=?base64?…?=` decoded
 *     first). Missing, mismatched or malformed → 400 with HeaderMismatch (-32020).
 *     A request with a legacy version (or no version header, read as
 *     2025-03-26) is the legacy era: the headers it predates are not required.
 *   • A notification answers 202. `subscriptions/listen` answers an SSE stream
 *     that stays open (keep-alive comments); closing it ends the subscription.
 *   • Errors that are about the request itself answer 400 (version, missing
 *     _meta, header mismatch, client capability), an unknown method 404,
 *     everything else 200 with the JSON-RPC body.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { ERR, LEGACY_VERSIONS, META, McpEndpoint, type JsonRpcId, type JsonRpcNotification, type JsonRpcResponse } from "./protocol.js";

export const MCP_PATH = "/mcp";
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** Methods whose `Mcp-Name` mirrors a body field. */
export const NAME_FIELD: Readonly<Record<string, "name" | "uri">> = { "tools/call": "name", "prompts/get": "name", "resources/read": "uri" };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A loopback origin (the app, an Inspector on localhost), or none at all. */
export function originAllowed(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const u = new URL(origin);
    return (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "tauri:") && ["127.0.0.1", "localhost", "[::1]", "tauri.localhost"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** A header value per the spec's Value Encoding: plain visible ASCII, or the Base64 sentinel. null = malformed. */
export function decodeHeaderValue(v: string): string | null {
  const m = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(v);
  if (m) {
    try {
      return Buffer.from(m[1], "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  return /^[\x20-\x7e\t]*$/.test(v) && v === v.trim() ? v : null;
}

const one = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h);

/**
 * The header check of one parsed POST body (SEP-2243). Returns null when it
 * passes, else the HeaderMismatch error text.
 */
export function headerProblem(headers: IncomingMessage["headers"], body: Record<string, unknown>): string | null {
  const params = isObj(body.params) ? body.params : {};
  const meta = isObj(params._meta) ? params._meta : {};
  const version = one(headers["mcp-protocol-version"]);
  const bodyVersion = meta[META.protocolVersion];
  // The legacy era (initialize-based): only the version header existed, and only from 2025-06-18.
  if (body.method === "initialize" || (version !== undefined && LEGACY_VERSIONS.includes(version))) {
    if (version !== undefined && bodyVersion !== undefined && bodyVersion !== version) return `Header mismatch: MCP-Protocol-Version header value '${version}' does not match body value '${String(bodyVersion)}'`;
    return null;
  }
  if (version === undefined) return bodyVersion === undefined || LEGACY_VERSIONS.includes(String(bodyVersion)) ? null : "Missing required header: MCP-Protocol-Version";
  if (bodyVersion !== undefined && bodyVersion !== version) return `Header mismatch: MCP-Protocol-Version header value '${version}' does not match body value '${String(bodyVersion)}'`;
  const method = one(headers["mcp-method"]);
  if (method === undefined) return "Missing required header: Mcp-Method";
  if (method !== body.method) return `Header mismatch: Mcp-Method header value '${method}' does not match body value '${String(body.method)}'`;
  const field = NAME_FIELD[String(body.method)];
  if (field) {
    const raw = one(headers["mcp-name"]);
    if (raw === undefined) return "Missing required header: Mcp-Name";
    const name = decodeHeaderValue(raw);
    if (name === null) return "Header mismatch: Mcp-Name header value is malformed";
    if (name !== params[field]) return `Header mismatch: Mcp-Name header value '${name}' does not match body value '${String(params[field])}'`;
  }
  return null;
}

/** HTTP status for a JSON-RPC response (spec: 400 for request-level errors, 404 for an unknown method). */
export function statusFor(res: JsonRpcResponse): number {
  if (!("error" in res)) return 200;
  const c = res.error.code;
  if (c === ERR.methodNotFound) return 404;
  if (c === ERR.headerMismatch || c === ERR.unsupportedVersion || c === ERR.missingClientCapability || c === ERR.invalidRequest || c === ERR.parse || c === ERR.invalidParams) return 400;
  return 200;
}

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
};
const rpcError = (id: JsonRpcId | null, code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > MAX_BODY_BYTES) return null;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface HttpOptions {
  /** Milliseconds between SSE keep-alive comments on a listen stream. */
  keepAliveMs?: number;
}

/** The request handler (for tests, and for `serveHttp`). */
export function httpHandler(endpoint: McpEndpoint, o: HttpOptions = {}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!originAllowed(one(req.headers.origin))) return sendJson(res, 403, rpcError(null, ERR.invalidRequest, "Forbidden origin."));
    if (url.pathname !== MCP_PATH) return sendJson(res, 404, rpcError(null, ERR.invalidRequest, `The MCP endpoint is ${MCP_PATH}.`));
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" });
      return void res.end();
    }
    const text = await readBody(req);
    if (text === null) return sendJson(res, 413, rpcError(null, ERR.invalidRequest, "Request too large."));
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return sendJson(res, 400, rpcError(null, ERR.parse, "Parse error."));
    }
    if (!isObj(body) || typeof body.method !== "string") return sendJson(res, 400, rpcError(null, ERR.invalidRequest, "The body must be one JSON-RPC request or notification."));
    const id = typeof body.id === "string" || typeof body.id === "number" ? (body.id as JsonRpcId) : null;
    const problem = headerProblem(req.headers, body);
    if (problem) return sendJson(res, 400, rpcError(id, ERR.headerMismatch, problem));
    if (body.id === undefined) {
      await endpoint.handle(body);
      res.writeHead(202);
      return void res.end();
    }
    if (body.method === "subscriptions/listen") {
      let open = true;
      const sink = {
        notify(msg: JsonRpcResponse | JsonRpcNotification) {
          if (!open) return;
          if (!res.headersSent) res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" });
          res.write(`data: ${JSON.stringify(msg)}\n\n`);
          if ("id" in msg) {
            open = false;
            res.end();
          }
        },
      };
      const early = await endpoint.handle(body, sink);
      if (early) return sendJson(res, statusFor(early), early);
      const timer = setInterval(() => open && res.write(":\n\n"), o.keepAliveMs ?? 15_000);
      (timer as { unref?: () => void }).unref?.();
      res.on("close", () => {
        clearInterval(timer);
        if (open && id !== null) endpoint.dropSubscription(id);
        open = false;
      });
      return;
    }
    const out = await endpoint.handle(body);
    if (!out) {
      res.writeHead(202);
      return void res.end();
    }
    return sendJson(res, statusFor(out), out);
  };
}

/** `lumen mcp serve --http [port]`: loopback only; polls the grants for tools/list changes. */
export async function serveHttp(vault: string, port: number, explicitClient?: string): Promise<Server> {
  const log = (l: string) => process.stderr.write(l.endsWith("\n") ? l : `${l}\n`);
  const endpoint = new McpEndpoint({ vault, explicitClient, log });
  const handler = httpHandler(endpoint);
  const server = createServer((req, res) => void handler(req, res).catch((e) => (log(`lumen-mcp http: ${String(e)}`), res.headersSent || sendJson(res, 500, rpcError(null, ERR.internal, "Internal error.")))));
  const poll = setInterval(() => void endpoint.pollChanges(), 1000);
  (poll as { unref?: () => void }).unref?.();
  server.on("close", () => (clearInterval(poll), endpoint.closeSubscriptions()));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  log(`lumen-mcp: Streamable HTTP on http://127.0.0.1:${port}${MCP_PATH} (MCP 2026-07-28; legacy initialize too)`);
  return server;
}
