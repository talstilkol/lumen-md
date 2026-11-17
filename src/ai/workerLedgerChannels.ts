/**
 * W10.D22 (plan 2.4): a worker's other ways out, through the same ledger and
 * airplane check as its `fetch` (workerLedger.ts). Without these, a library
 * in a worker that used XMLHttpRequest, a WebSocket, an EventSource or
 * `importScripts` of a remote script would have reached the network out of
 * the panel's sight, and past airplane mode.
 *
 *   • XMLHttpRequest: `open` notes the address; `send` asks airplane mode
 *     first (it waits for the window's answer, as fetch does), reports the
 *     start, and the end with its status when the request settles (0 when it
 *     failed or was blocked).
 *   • WebSocket and EventSource: constructors cannot wait, so until the window
 *     has said airplane mode is off, one to another host is refused (fail
 *     closed); otherwise reported, and settled on open (101 / 200) or error (0).
 *   • importScripts: synchronous, the same rule as a WebSocket.
 * blob:, data: and loopback never leave the device, and are never blocked.
 */
import type { AirplaneMessage, WorkerLedgerMessage } from "./workerLedger";

type Ctor<T> = new (...args: never[]) => T;

export interface ChannelScope {
  location?: { href?: string };
  XMLHttpRequest?: Ctor<XMLHttpRequest>;
  WebSocket?: Ctor<WebSocket>;
  EventSource?: Ctor<EventSource>;
  importScripts?: (...urls: string[]) => void;
}

export interface ChannelDeps {
  worker: string;
  post: (m: WorkerLedgerMessage) => void;
  next: () => string;
  /** null: no answer from the window yet; true / false: airplane mode is on / off. */
  airplane: () => boolean | null;
  /** Resolves once the window has answered (or its wait ran out). */
  heard: () => Promise<void>;
  /** Whether the airplane check runs at all (an injected ledger channel without one: no check). */
  checks: boolean;
  air: Pick<BroadcastChannel, "postMessage"> | null;
  stays: (url: string) => boolean;
}

const abs = (url: string | URL, base?: string): string => {
  try {
    return new URL(String(url), base).href;
  } catch {
    return String(url);
  }
};

const progress = (type: string): Event => (typeof ProgressEvent === "function" ? new ProgressEvent(type) : new Event(type));

const bodyBytes = (body: unknown): number => {
  if (body == null) return 0;
  if (typeof body === "string") return new TextEncoder().encode(body).length;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return 0;
};

/** Wraps every channel `scope` has. Returns the names of those it wrapped. */
export function wrapWorkerChannels(scope: ChannelScope, d: ChannelDeps): string[] {
  const base = scope.location?.href;
  const wrapped: string[] = [];

  const attempt = (url: string, method: string, blocked: boolean) => {
    try {
      d.air?.postMessage({ kind: "attempt", url, method, worker: d.worker, blocked } satisfies AirplaneMessage);
    } catch {
      /* why: a closed channel: the request is still decided here */
    }
  };
  /** Synchronous decision (constructors, importScripts): fail closed until the window says off. */
  const blockedNow = (url: string, method: string): boolean => {
    if (!d.checks) return false;
    const blocked = d.airplane() !== false && !d.stays(url);
    attempt(url, method, blocked);
    return blocked;
  };
  const why = (url: string) => `Blocked: airplane mode is ${d.airplane() === null ? "not confirmed off" : "on"} (${(() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })()})`;
  const report = (url: string, method: string, bytesOut = 0) => {
    const id = d.next();
    d.post({ kind: "start", id, url, method, bytesOut, worker: d.worker });
    let done = false;
    return (status: number, bytesIn: number | null = null) => {
      if (done) return;
      done = true;
      d.post({ kind: "end", id, status, bytesIn });
    };
  };

  const Xhr = scope.XMLHttpRequest;
  if (typeof Xhr === "function") {
    const proto = Xhr.prototype as XMLHttpRequest & { __lumenUrl?: string; __lumenMethod?: string; __lumenSync?: boolean };
    const open = proto.open;
    const send = proto.send;
    proto.open = function (this: typeof proto, method: string, url: string | URL, ...rest: unknown[]) {
      this.__lumenUrl = abs(url, base);
      this.__lumenMethod = String(method || "GET").toUpperCase();
      this.__lumenSync = rest.length > 0 && rest[0] === false;
      return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof proto.open;
    proto.send = function (this: typeof proto, body?: Document | XMLHttpRequestBodyInit | null) {
      const url = this.__lumenUrl ?? "";
      const method = this.__lumenMethod ?? "GET";
      const go = () => {
        if (d.checks) {
          const blocked = d.airplane() !== false && !d.stays(url);
          attempt(url, method, blocked);
          if (blocked) {
            // As a network error: readyState 4, status 0, then error and loadend.
            try {
              this.abort();
            } catch {
              /* why: not opened: nothing to abort */
            }
            this.dispatchEvent(progress("error"));
            this.dispatchEvent(progress("loadend"));
            return;
          }
        }
        const end = report(url, method, bodyBytes(body));
        this.addEventListener("loadend", () => {
          const len = Number(this.getResponseHeader?.("content-length"));
          end(this.status || 0, Number.isFinite(len) && this.getResponseHeader?.("content-length") != null ? len : null);
        });
        send.call(this, body ?? null);
      };
      // A synchronous request cannot wait for the window's answer: it is decided now (fail closed).
      if (d.checks && d.airplane() === null && !this.__lumenSync) void d.heard().then(go);
      else go();
    };
    wrapped.push("XMLHttpRequest");
  }

  const wrapCtor = <T extends EventTarget>(name: "WebSocket" | "EventSource", Real: Ctor<T>, method: string, okStatus: number) => {
    const Wrapped = function (this: unknown, url: string | URL, ...rest: unknown[]) {
      const href = abs(url, base);
      if (blockedNow(href, method)) throw new DOMException(why(href), "SecurityError");
      const sock = new (Real as unknown as new (...a: unknown[]) => T)(url, ...rest);
      const end = report(href, method);
      sock.addEventListener("open", () => end(okStatus));
      sock.addEventListener("error", () => end(0));
      return sock;
    } as unknown as Ctor<T>;
    // Statics (CONNECTING, OPEN, …) and instanceof keep working.
    Object.setPrototypeOf(Wrapped, Real);
    (Wrapped as unknown as { prototype: unknown }).prototype = Real.prototype;
    (scope as Record<string, unknown>)[name] = Wrapped;
    wrapped.push(name);
  };
  if (typeof scope.WebSocket === "function") wrapCtor("WebSocket", scope.WebSocket, "GET", 101);
  if (typeof scope.EventSource === "function") wrapCtor("EventSource", scope.EventSource, "GET", 200);

  const imp = scope.importScripts;
  if (typeof imp === "function") {
    scope.importScripts = function (...urls: string[]) {
      const ends: Array<(s: number) => void> = [];
      for (const u of urls) {
        const href = abs(u, base);
        if (d.stays(href)) continue;
        if (blockedNow(href, "GET")) throw new DOMException(why(href), "NetworkError");
        ends.push(report(href, "GET"));
      }
      try {
        imp.apply(scope, urls);
        for (const e of ends) e(200);
      } catch (e) {
        for (const x of ends) x(0);
        throw e;
      }
    };
    wrapped.push("importScripts");
  }
  return wrapped;
}
