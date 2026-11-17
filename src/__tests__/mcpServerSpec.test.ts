// @vitest-environment node
/**
 * Plan W11.I8 — the vault's MCP server against the published 2026-07-28
 * spec: the Streamable HTTP request headers (SEP-2243, a header that does not
 * match the body is refused), `subscriptions/listen` instead of the GET
 * stream, deterministic list order, and the legacy `initialize` still
 * working. A real HTTP server on 127.0.0.1 (mcp-server/src/http.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Buffer } from "node:buffer";
import { McpEndpoint, ERR, META } from "../../mcp-server/src/protocol";
import { decodeHeaderValue, httpHandler, originAllowed } from "../../mcp-server/src/http";
import { disableClient, enableClient } from "../../mcp-server/src/vault/config";
import { TOOLS } from "../../mcp-server/src/vault/tools";

let vault: string;
let server: Server;
let base: string;
let ep: McpEndpoint;
let seq = 0;

const meta = (version = "2026-07-28") => ({ [META.protocolVersion]: version, [META.clientInfo]: { name: "claude-code", version: "1" }, [META.clientCapabilities]: {} });
const body = (method: string, params: Record<string, unknown> = {}, version = "2026-07-28") => ({ jsonrpc: "2.0", id: ++seq, method, params: { ...params, _meta: meta(version) } });
const headersFor = (b: { method: string; params: Record<string, unknown> }) => {
  const h: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": b.method };
  if (b.method === "tools/call") h["mcp-name"] = String(b.params.name);
  return h;
};
const post = async (b: unknown, headers: Record<string, string>) => {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify(b) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null, type: r.headers.get("content-type") };
};

beforeEach(async () => {
  vault = mkdtempSync(path.join(tmpdir(), "lumen-mcp-i8-"));
  mkdirSync(path.join(vault, "ideas"), { recursive: true });
  writeFileSync(path.join(vault, "ideas/launch.md"), "# Launch\n\nThe launch plan.\n");
  await enableClient(vault, "claude-code", ["search", "read"]);
  ep = new McpEndpoint({ vault });
  const handler = httpHandler(ep, { keepAliveMs: 50 });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(vault, { recursive: true, force: true });
});

describe("Mcp-Method and Mcp-Name (SEP-2243)", () => {
  it("accepts a request whose headers mirror the body", async () => {
    const b = body("tools/list");
    const r = await post(b, headersFor(b));
    expect(r.status).toBe(200);
    expect(r.json.result.tools.length).toBeGreaterThan(0);
  });

  it("refuses a missing or mismatched Mcp-Method with 400 HeaderMismatch", async () => {
    const b = body("tools/list");
    const { "mcp-method": _drop, ...without } = headersFor(b);
    for (const h of [without, { ...headersFor(b), "mcp-method": "tools/call" }, { ...headersFor(b), "mcp-method": "Tools/List" }]) {
      const r = await post(b, h);
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(ERR.headerMismatch);
      expect(r.json.id).toBe(b.id);
    }
  });

  it("refuses an Mcp-Name that does not match the tool, accepts the Base64 sentinel of the right one", async () => {
    const b = body("tools/call", { name: "search_notes", arguments: { query: "launch" } });
    const wrong = await post(b, { ...headersFor(b), "mcp-name": "read_note" });
    expect([wrong.status, wrong.json.error.code]).toEqual([400, ERR.headerMismatch]);
    expect(wrong.json.error.message).toMatch(/Mcp-Name header value 'read_note' does not match body value 'search_notes'/);
    const { "mcp-name": _n, ...noName } = headersFor(b);
    expect((await post(b, noName)).status).toBe(400);
    const encoded = await post(b, { ...headersFor(b), "mcp-name": `=?base64?${Buffer.from("search_notes").toString("base64")}?=` });
    expect(encoded.status).toBe(200);
    expect(encoded.json.result.resultType).toBe("complete");
  });

  it("refuses a missing MCP-Protocol-Version on a 2026-07-28 body, and one that does not match _meta", async () => {
    const b = body("tools/list");
    const { "mcp-protocol-version": _v, ...noVersion } = headersFor(b);
    expect((await post(b, noVersion)).json.error.code).toBe(ERR.headerMismatch);
    const r = await post(b, { ...headersFor(b), "mcp-protocol-version": "2025-11-25" });
    expect([r.status, r.json.error.code]).toEqual([400, ERR.headerMismatch]);
  });

  it("GET and DELETE are 405, a foreign Origin 403, an unknown method 404, a notification 202", async () => {
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
    expect((await fetch(`${base}/mcp`, { method: "DELETE" })).status).toBe(405);
    const b = body("tools/list");
    expect((await post(b, { ...headersFor(b), origin: "https://evil.example" })).status).toBe(403);
    expect((await post(b, { ...headersFor(b), origin: "http://localhost:5173" })).status).toBe(200);
    const u = body("resources/list");
    const r = await post(u, headersFor(u));
    expect([r.status, r.json.error.code]).toEqual([404, ERR.methodNotFound]);
    const n = { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 99 } };
    expect((await post(n, { "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": "notifications/cancelled" })).status).toBe(202);
  });

  it("the legacy era still works: initialize, then a 2025-11-25 request without the 2026 headers", async () => {
    const init = { jsonrpc: "2.0", id: ++seq, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "claude-code", version: "1" } } };
    const r = await post(init, { "content-type": "application/json" });
    expect(r.status).toBe(200);
    expect(r.json.result.protocolVersion).toBe("2025-11-25");
    const list = { jsonrpc: "2.0", id: ++seq, method: "tools/list", params: {} };
    const l = await post(list, { "content-type": "application/json", "mcp-protocol-version": "2025-11-25" });
    expect(l.status).toBe(200);
    expect(l.json.result.tools.length).toBeGreaterThan(0);
  });

  it("header values follow the spec's encoding", () => {
    expect(decodeHeaderValue("search_notes")).toBe("search_notes");
    expect(decodeHeaderValue(`=?base64?${Buffer.from("Hello, 世界").toString("base64")}?=`)).toBe("Hello, 世界");
    expect(decodeHeaderValue(" padded ")).toBeNull();
    expect(decodeHeaderValue("שלום")).toBeNull();
    expect(originAllowed(undefined)).toBe(true);
    expect(originAllowed("http://127.0.0.1:1420")).toBe(true);
    expect(originAllowed("http://127.0.0.1.evil.example")).toBe(false);
  });
});

describe("subscriptions/listen instead of the GET stream", () => {
  type Msg = { method?: string; id?: number; params?: Record<string, any>; result?: Record<string, any> };
  const sink = () => {
    const got: Msg[] = [];
    return { got, notify: (m: unknown) => void got.push(m as Msg) };
  };

  it("acknowledges first, then tells only subscribers who asked when the tool list changes, then closes gracefully", async () => {
    const a = sink();
    const b = sink();
    const la = body("subscriptions/listen", { notifications: { toolsListChanged: true, resourceSubscriptions: ["file:///x"] } });
    const lb = body("subscriptions/listen", { notifications: { promptsListChanged: true } });
    expect(await ep.handle(la, a)).toBeNull();
    expect(await ep.handle(lb, b)).toBeNull();
    expect(a.got[0]).toEqual({ jsonrpc: "2.0", method: "notifications/subscriptions/acknowledged", params: { _meta: { [META.subscriptionId]: la.id }, notifications: { toolsListChanged: true } } });
    expect(b.got[0].params!.notifications).toEqual({});
    expect(await ep.pollChanges()).toBe(0);
    await disableClient(vault, "claude-code");
    expect(await ep.pollChanges()).toBe(1);
    expect(a.got[1]).toEqual({ jsonrpc: "2.0", method: "notifications/tools/list_changed", params: { _meta: { [META.subscriptionId]: la.id } } });
    expect(b.got).toHaveLength(1);
    ep.closeSubscriptions();
    expect(a.got[2]).toEqual({ jsonrpc: "2.0", id: la.id, result: { resultType: "complete", _meta: { [META.subscriptionId]: la.id } } });
    expect(ep.subscriptionCount).toBe(0);
  });

  it("stdio cancellation ends a subscription; a legacy session cannot listen", async () => {
    const a = sink();
    const l = body("subscriptions/listen", { notifications: { toolsListChanged: true } });
    await ep.handle(l, a);
    expect(ep.subscriptionCount).toBe(1);
    await ep.handle({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: l.id } });
    expect(ep.subscriptionCount).toBe(0);
    const legacy = await ep.handle(body("subscriptions/listen", {}, "2025-11-25"), a);
    expect((legacy as { error: { code: number } }).error.code).toBe(ERR.methodNotFound);
  });

  it("over HTTP the answer is an SSE stream that carries the acknowledgment and the change", async () => {
    const l = body("subscriptions/listen", { notifications: { toolsListChanged: true } });
    const ac = new AbortController();
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: headersFor(l), body: JSON.stringify(l), signal: ac.signal });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/event-stream");
    expect(r.headers.get("x-accel-buffering")).toBe("no");
    const reader = r.body!.getReader();
    let text = "";
    const until = async (re: RegExp) => {
      while (!re.test(text)) text += new TextDecoder().decode((await reader.read()).value);
    };
    await until(/subscriptions\/acknowledged/);
    await enableClient(vault, "claude-code", ["search", "read", "propose"]);
    await ep.pollChanges();
    await until(/tools\/list_changed/);
    const events = text.split("\n\n").filter((e) => e.startsWith("data: ")).map((e) => JSON.parse(e.slice(6)) as Msg);
    expect(events.map((e) => e.method)).toEqual(["notifications/subscriptions/acknowledged", "notifications/tools/list_changed"]);
    expect(events.every((e) => e.params!._meta[META.subscriptionId] === l.id)).toBe(true);
    ac.abort();
    await new Promise((res) => setTimeout(res, 50));
    expect(ep.subscriptionCount).toBe(0);
  });
});

describe("deterministic list order (SEP-2549)", () => {
  it("tools/list has the same order on every call, whatever order the grant lists its scopes in, on stdio and HTTP", async () => {
    const names = async () => {
      const res = await ep.handle(body("tools/list"));
      if (!res || !("result" in res)) throw new Error(`tools/list: ${JSON.stringify(res)}`);
      return (res.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    };
    await enableClient(vault, "claude-code", ["read", "propose", "search"]);
    const a = await names();
    await enableClient(vault, "claude-code", ["propose", "search", "read"]);
    const b = await names();
    expect(a).toEqual(b);
    expect(a).toEqual(TOOLS.map((t) => t.name));
    const h = body("tools/list");
    expect((await post(h, headersFor(h))).json.result.tools.map((t: { name: string }) => t.name)).toEqual(a);
  });
});
