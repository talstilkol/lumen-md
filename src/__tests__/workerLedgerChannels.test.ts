/**
 * W10.D22 (plan 2.4): a worker's ways out besides `fetch` — XMLHttpRequest,
 * WebSocket, EventSource, importScripts — reach the privacy ledger and obey
 * airplane mode, like its fetch; and a fetch that fails is settled (status 0)
 * instead of staying open in the ledger.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { __resetLedger, ledgerEntries, listenToWorkerLedger } from "../ai/privacyLedger";
import { installWorkerLedger, __resetWorkerLedger, type AirplaneMessage, type WorkerLedgerMessage } from "../ai/workerLedger";
import { setAiPolicy } from "../ai/policy";

function pipe() {
  const target = new EventTarget();
  const sent: WorkerLedgerMessage[] = [];
  return {
    sent,
    postMessage: (m: WorkerLedgerMessage) => (sent.push(m), target.dispatchEvent(new MessageEvent("message", { data: m }))),
    addEventListener: target.addEventListener.bind(target) as BroadcastChannel["addEventListener"],
  };
}

/** The window's airplane answer: on, off, or (null) none until `answer` is called. */
function airChannel(on: boolean | null) {
  const posted: AirplaneMessage[] = [];
  let listener: ((e: MessageEvent<AirplaneMessage>) => void) | null = null;
  return {
    posted,
    answer: (v: boolean) => listener?.({ data: { kind: "state", on: v } } as MessageEvent<AirplaneMessage>),
    ch: {
      postMessage(m: AirplaneMessage) {
        posted.push(m);
        if (m.kind === "hello" && on !== null) queueMicrotask(() => listener?.({ data: { kind: "state", on } } as MessageEvent<AirplaneMessage>));
      },
      addEventListener(_t: string, fn: EventListenerOrEventListenerObject) {
        listener = fn as unknown as (e: MessageEvent<AirplaneMessage>) => void;
      },
    } as unknown as BroadcastChannel,
  };
}

/** A stand-in XMLHttpRequest: `send` records the request and settles it with 200 on the next tick. */
function fakeXhr(sent: string[]) {
  return class FakeXhr extends EventTarget {
    status = 0;
    url = "";
    open(_m: string, url: string) {
      this.url = url;
    }
    send() {
      sent.push(this.url);
      setTimeout(() => {
        this.status = 200;
        this.dispatchEvent(new Event("load"));
        this.dispatchEvent(new Event("loadend"));
      }, 0);
    }
    abort() {}
    getResponseHeader(h: string) {
      return h === "content-length" ? "12" : null;
    }
  };
}

/** A stand-in socket (WebSocket / EventSource): opens on the next tick. */
function fakeSocket(made: string[]) {
  return class FakeSocket extends EventTarget {
    static OPEN = 1;
    constructor(public url: string) {
      super();
      made.push(url);
      setTimeout(() => this.dispatchEvent(new Event("open")), 0);
    }
  };
}

const tick = () => new Promise((r) => setTimeout(r, 25));
const W = "https://lumen-md.vercel.app/assets/w.js";
const MODEL = "https://huggingface.co/onnx-community/x/resolve/main/model.onnx";

beforeEach(() => {
  localStorage.clear();
  __resetLedger();
  __resetWorkerLedger();
  setAiPolicy("local-first");
});

describe("XMLHttpRequest in a worker", () => {
  it("is recorded in the ledger, with its status and size, under the worker's name", async () => {
    const ch = pipe();
    listenToWorkerLedger(ch);
    const sent: string[] = [];
    const scope = { fetch: (async () => new Response("")) as unknown as typeof fetch, name: "pyodide", location: { href: W }, XMLHttpRequest: fakeXhr(sent) as unknown as typeof XMLHttpRequest };
    installWorkerLedger(scope, ch, airChannel(false).ch);
    const x = new scope.XMLHttpRequest();
    x.open("GET", MODEL);
    x.send();
    await tick();
    expect(sent).toEqual([MODEL]);
    expect(ledgerEntries()).toEqual([expect.objectContaining({ host: "huggingface.co", category: "model-download", status: 200, bytesIn: 12, reason: expect.stringContaining("worker: pyodide") })]);
  });

  it("airplane mode on: never sent, an error event instead, reported as blocked", async () => {
    const sent: string[] = [];
    const air = airChannel(true);
    const scope = { fetch: (async () => new Response("")) as unknown as typeof fetch, name: "w", location: { href: W }, XMLHttpRequest: fakeXhr(sent) as unknown as typeof XMLHttpRequest };
    installWorkerLedger(scope, pipe(), air.ch);
    await tick(); // the window has answered: on
    const x = new scope.XMLHttpRequest();
    const onError = vi.fn();
    x.addEventListener("error", onError);
    x.open("GET", MODEL);
    x.send();
    await tick();
    expect(sent).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(air.posted).toContainEqual({ kind: "attempt", url: MODEL, method: "GET", worker: "w", blocked: true });
  });

  it("waits for the window's answer before it sends (an async request)", async () => {
    const sent: string[] = [];
    const air = airChannel(null);
    const scope = { fetch: (async () => new Response("")) as unknown as typeof fetch, name: "w", location: { href: W }, XMLHttpRequest: fakeXhr(sent) as unknown as typeof XMLHttpRequest };
    installWorkerLedger(scope, pipe(), air.ch);
    const x = new scope.XMLHttpRequest();
    x.open("GET", MODEL);
    x.send();
    await tick();
    expect(sent).toEqual([]); // no answer yet
    air.answer(false);
    await tick();
    expect(sent).toEqual([MODEL]);
  });
});

describe("WebSocket and EventSource in a worker", () => {
  it("before the window has said airplane mode is off, one to another host is refused (fail closed); loopback is not", async () => {
    const made: string[] = [];
    const Sock = fakeSocket(made);
    const scope = { fetch: (async () => new Response("")) as unknown as typeof fetch, name: "w", location: { href: W }, WebSocket: Sock as unknown as typeof WebSocket, EventSource: Sock as unknown as typeof EventSource };
    installWorkerLedger(scope, pipe(), airChannel(null).ch);
    expect(() => new scope.WebSocket("wss://relay.example.org/socket")).toThrow(/airplane mode is not confirmed off/);
    expect(() => new scope.EventSource("https://events.example.org/stream")).toThrow(/airplane mode/);
    expect(made).toEqual([]);
    new scope.WebSocket("ws://127.0.0.1:9000/");
    expect(made).toEqual(["ws://127.0.0.1:9000/"]);
  });

  it("airplane off: made, recorded, and settled when it opens; instanceof and statics still work", async () => {
    const ch = pipe();
    listenToWorkerLedger(ch);
    const made: string[] = [];
    const Sock = fakeSocket(made);
    const scope = { fetch: (async () => new Response("")) as unknown as typeof fetch, name: "relay", location: { href: W }, WebSocket: Sock as unknown as typeof WebSocket };
    installWorkerLedger(scope, ch, airChannel(false).ch);
    await tick();
    const s = new scope.WebSocket("wss://huggingface.co/socket");
    expect(s).toBeInstanceOf(Sock);
    expect((scope.WebSocket as unknown as { OPEN: number }).OPEN).toBe(1);
    await tick();
    expect(made).toEqual(["wss://huggingface.co/socket"]);
    expect(ch.sent.map((m) => m.kind)).toEqual(["start", "end"]);
    expect(ch.sent[1]).toMatchObject({ kind: "end", status: 101 });
  });
});

describe("importScripts in a worker", () => {
  it("a remote script is refused in airplane mode and reported otherwise; blob: and data: always load", async () => {
    const loaded: string[] = [];
    const imp = (...u: string[]) => void loaded.push(...u);
    const on = { fetch: (async () => new Response("")) as unknown as typeof fetch, name: "w", location: { href: W }, importScripts: imp };
    installWorkerLedger(on, pipe(), airChannel(true).ch);
    await tick();
    expect(() => on.importScripts("https://cdn.example.org/lib.js")).toThrow(/airplane mode is on/);
    on.importScripts("blob:https://lumen-md.vercel.app/1234", "data:text/javascript,1");
    expect(loaded).toEqual(["blob:https://lumen-md.vercel.app/1234", "data:text/javascript,1"]);

    __resetWorkerLedger();
    const ch = pipe();
    const off = { fetch: (async () => new Response("")) as unknown as typeof fetch, name: "w2", location: { href: W }, importScripts: imp };
    installWorkerLedger(off, ch, airChannel(false).ch);
    await tick();
    off.importScripts("https://cdn.example.org/lib.js");
    expect(loaded).toContain("https://cdn.example.org/lib.js");
    expect(ch.sent).toEqual([expect.objectContaining({ kind: "start", url: "https://cdn.example.org/lib.js", worker: "w2" }), expect.objectContaining({ kind: "end", status: 200 })]);
  });
});

describe("a fetch that fails", () => {
  it("is settled with status 0 in the ledger, and the error still reaches the caller", async () => {
    const ch = pipe();
    listenToWorkerLedger(ch);
    const scope = { fetch: (async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch, name: "transformers" };
    installWorkerLedger(scope, ch);
    await expect(scope.fetch(MODEL)).rejects.toThrow("Failed to fetch");
    expect(ch.sent.map((m) => m.kind)).toEqual(["start", "end"]);
    expect(ledgerEntries()).toEqual([expect.objectContaining({ host: "huggingface.co", status: 0 })]);
  });
});
