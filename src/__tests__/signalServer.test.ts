// @vitest-environment node
/**
 * Integration tests for sync-server/server.js (y-webrtc signaling protocol).
 * Starts the server on an ephemeral port and talks to it with real `ws`
 * clients.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WebSocket: any = require("ws");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { createServer } = require(path.resolve(__dirname, "../../sync-server/server.js")) as any;

process.env.SIGNAL_QUIET = "1";

type Msg = Record<string, unknown>;

interface Client {
  ws: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  messages: Msg[];
  next: (pred?: (m: Msg) => boolean, timeoutMs?: number) => Promise<Msg>;
  send: (m: Msg) => void;
}

function connect(port: number, opts: Record<string, unknown> = {}): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, opts);
    const messages: Msg[] = [];
    const waiters: Array<{ pred: (m: Msg) => boolean; resolve: (m: Msg) => void }> = [];
    ws.on("message", (raw: Buffer) => {
      const m = JSON.parse(raw.toString()) as Msg;
      const idx = waiters.findIndex((w) => w.pred(m));
      if (idx >= 0) {
        const [w] = waiters.splice(idx, 1);
        w.resolve(m);
      } else {
        messages.push(m);
      }
    });
    ws.on("error", reject);
    ws.on("open", () =>
      resolve({
        ws,
        messages,
        send: (m) => ws.send(JSON.stringify(m)),
        next: (pred = () => true, timeoutMs = 2000) => {
          const queued = messages.findIndex(pred);
          if (queued >= 0) return Promise.resolve(messages.splice(queued, 1)[0]);
          return new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error("timed out waiting for message")), timeoutMs);
            waiters.push({
              pred,
              resolve: (m) => {
                clearTimeout(t);
                res(m);
              },
            });
          });
        },
      }),
    );
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("signaling server (y-webrtc protocol)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let srv: any;
  const clients: Client[] = [];

  beforeEach(async () => {
    srv = await createServer({ port: 0, heartbeatMs: 100 });
  });

  afterEach(async () => {
    clients.splice(0).forEach((c) => c.ws.terminate());
    await srv.close();
  });

  const open = async (opts: Record<string, unknown> = {}) => {
    const c = await connect(srv.port, opts);
    clients.push(c);
    return c;
  };

  it("answers ping with pong", async () => {
    const a = await open();
    a.send({ type: "ping" });
    expect(await a.next()).toEqual({ type: "pong" });
  });

  it("fans out publish to all subscribers of the topic (including sender) with clients count", async () => {
    const a = await open();
    const b = await open();
    const c = await open();
    a.send({ type: "subscribe", topics: ["room-1"] });
    b.send({ type: "subscribe", topics: ["room-1"] });
    c.send({ type: "subscribe", topics: ["other-room"] });
    // Round-trip a ping so we know the subscribes were processed.
    a.send({ type: "ping" });
    b.send({ type: "ping" });
    await a.next((m) => m.type === "pong");
    await b.next((m) => m.type === "pong");

    a.send({ type: "publish", topic: "room-1", data: { hello: "world" } });
    const gotB = await b.next((m) => m.type === "publish");
    const gotA = await a.next((m) => m.type === "publish");
    expect(gotB).toEqual({ type: "publish", topic: "room-1", data: { hello: "world" }, clients: 2 });
    expect(gotA).toEqual(gotB);

    // c is subscribed to a different topic and must not receive it.
    c.send({ type: "ping" });
    await c.next((m) => m.type === "pong");
    expect(c.messages.filter((m) => m.type === "publish")).toHaveLength(0);
  });

  it("stops delivering after unsubscribe and cleans up on close", async () => {
    const a = await open();
    const b = await open();
    a.send({ type: "subscribe", topics: ["t"] });
    b.send({ type: "subscribe", topics: ["t"] });
    b.send({ type: "unsubscribe", topics: ["t"] });
    b.send({ type: "ping" });
    await b.next((m) => m.type === "pong");

    a.send({ type: "publish", topic: "t", n: 1 });
    const gotA = await a.next((m) => m.type === "publish");
    expect(gotA.clients).toBe(1);
    b.send({ type: "ping" });
    await b.next((m) => m.type === "pong");
    expect(b.messages.filter((m) => m.type === "publish")).toHaveLength(0);

    a.ws.close();
    await sleep(50);
    expect(srv.topics.has("t")).toBe(false);
  });

  it("does not terminate a responsive client across several heartbeat intervals", async () => {
    const a = await open();
    let closed = false;
    a.ws.on("close", () => {
      closed = true;
    });
    // ws clients auto-reply to server pings with pongs.
    await sleep(450); // > 4 ticks at 100 ms
    expect(closed).toBe(false);
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
    a.send({ type: "ping" });
    expect(await a.next()).toEqual({ type: "pong" });
  });

  it("terminates a client that never answers pings", async () => {
    // Disable the automatic pong reply to server pings.
    const a = await open({ autoPong: false });
    const closed = new Promise<void>((r) => a.ws.on("close", () => r()));
    await expect(Promise.race([closed.then(() => "closed"), sleep(1000).then(() => "open")])).resolves.toBe(
      "closed",
    );
  });

  it("supports the legacy join + relay protocol", async () => {
    const a = await open();
    const b = await open();
    a.send({ type: "join", room: "legacy", peerId: "a" });
    expect(await a.next((m) => m.type === "joined")).toMatchObject({ room: "legacy", peers: 1 });
    b.send({ type: "join", room: "legacy", peerId: "b" });
    expect(await b.next((m) => m.type === "joined")).toMatchObject({ room: "legacy", peers: 2 });
    a.send({ type: "signal", payload: 42 });
    expect(await b.next((m) => m.type === "signal")).toEqual({ type: "signal", payload: 42 });
  });

  it.each(["/healthz", "/health", "/"])("serves JSON health on %s", async (p) => {
    const res = await fetch(`http://127.0.0.1:${srv.port}${p}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe("signaling server resource caps", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let srv: any;
  const socks: Client[] = [];
  afterEach(async () => {
    socks.splice(0).forEach((c) => c.ws.terminate());
    await srv.close();
  });
  const start = async (opts: Record<string, unknown>) => {
    srv = await createServer({ port: 0, heartbeatMs: 10_000, ...opts });
  };
  const open = async () => {
    const c = await connect(srv.port);
    socks.push(c);
    return c;
  };

  it("bounds topics per connection: one huge subscribe retains at most the cap", async () => {
    await start({ maxTopicsPerConn: 5 });
    const a = await open();
    a.send({ type: "subscribe", topics: Array.from({ length: 10_000 }, (_, i) => `t${i}`) });
    expect(await a.next((m) => m.type === "error")).toEqual({ type: "error", error: "Topic limit exceeded" });
    expect(srv.topics.size).toBe(5);
    // Further subscribes on the same socket are refused too.
    a.send({ type: "subscribe", topics: ["another"] });
    await a.next((m) => m.type === "error");
    expect(srv.topics.has("another")).toBe(false);
  });

  it("rejects over-long and empty topic names", async () => {
    await start({ maxTopicLength: 16 });
    const a = await open();
    a.send({ type: "subscribe", topics: ["x".repeat(17), "", "ok"] });
    await a.next((m) => m.type === "error");
    expect([...srv.topics.keys()]).toEqual(["ok"]);
  });

  it("closes connections that send a payload larger than maxPayload", async () => {
    await start({ maxPayload: 1024 });
    const a = await open();
    const closed = new Promise<number>((r) => a.ws.on("close", (code: number) => r(code)));
    a.send({ type: "publish", topic: "t", data: "x".repeat(4096) });
    expect(await closed).toBe(1009); // "message too big"
  });

  it("limits concurrent connections per IP", async () => {
    await start({ maxConnsPerIp: 2 });
    await open();
    await open();
    const third = await connect(srv.port);
    socks.push(third);
    const code = await new Promise<number>((r) => third.ws.on("close", (c: number) => r(c)));
    expect(code).toBe(1008);
  });
});

describe("signaling server client IP behind a proxy", () => {
  it("uses Fly-Client-IP / X-Forwarded-For only when trustProxy is on", async () => {
    const srv = await createServer({ port: 0, heartbeatMs: 10_000, maxConnsPerIp: 1, trustProxy: true });
    const a = await connect(srv.port, { headers: { "Fly-Client-IP": "203.0.113.1" } });
    const b = await connect(srv.port, { headers: { "Fly-Client-IP": "203.0.113.2" } });
    // Different forwarded IPs → both allowed despite the same socket address.
    await new Promise((r) => setTimeout(r, 50));
    expect(a.ws.readyState).toBe(1);
    expect(b.ws.readyState).toBe(1);
    const c = await connect(srv.port, { headers: { "Fly-Client-IP": "203.0.113.1" } });
    const code = await new Promise<number>((r) => c.ws.on("close", (x: number) => r(x)));
    expect(code).toBe(1008);
    [a, b].forEach((x) => x.ws.terminate());
    await srv.close();
  });

  it("ignores forwarding headers by default (they are client-controlled)", async () => {
    const srv = await createServer({ port: 0, heartbeatMs: 10_000, maxConnsPerIp: 1 });
    const a = await connect(srv.port, { headers: { "X-Forwarded-For": "198.51.100.1" } });
    const b = await connect(srv.port, { headers: { "X-Forwarded-For": "198.51.100.2" } });
    const code = await new Promise<number>((r) => b.ws.on("close", (x: number) => r(x)));
    expect(code).toBe(1008);
    a.ws.terminate();
    await srv.close();
  });
});
