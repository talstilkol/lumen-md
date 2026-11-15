/**
 * Blind tests (plan W6.15, W10.D19): airplane mode and the network monitor.
 *
 * Written from the spec only: docs/src/content/docs/ai/airplane-mode.md and the
 * declarations tsc emits for src/privacy/airplane.ts, airplaneBoot.ts,
 * airplaneEmbeds.ts and airplaneCertificate.ts (signatures and doc comments,
 * no function bodies, no existing airplane tests). Lane X-BL, against
 * verify/train-5 (c3f055218e).
 *
 * Properties: from the moment it is on, fetch to another site is refused
 * before it runs; the app's own origin is GET-only from a cache; XHR,
 * WebSocket, EventSource and sendBeacon are refused; loopback, blob: and data:
 * stay; a request still waiting when the switch goes on is counted and
 * aborted; the monitor lists every attempt without its query; turning it off
 * reloads; frames lose allow-popups while it is on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AirplaneBlockedError,
  airplaneModeOn,
  airplaneSince,
  disableAirplaneMode,
  egressAttempts,
  egressTally,
  enableAirplaneMode,
  guardedSandbox,
  installAirplaneMode,
  subscribeEgress,
  verdict,
  __resetAirplane,
} from "../../privacy/airplane";
import { AIRPLANE_CSP, AIRPLANE_KEY } from "../../privacy/airplaneBoot";

const BASE = "https://app.example.test/notes";
type W = Window & typeof globalThis;

/** A fake window whose network primitives record calls; installAirplaneMode wraps it. */
function fakeWindow() {
  const calls: Array<{ url: string; init?: RequestInit; cache?: string; method: string }> = [];
  const pending: Array<{ reject: (e: unknown) => void; signal?: AbortSignal | null }> = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const req = typeof input === "object" && !(input instanceof URL) ? (input as Request) : null;
    calls.push({ url, init, cache: init?.cache ?? req?.cache, method: (init?.method ?? req?.method ?? "GET").toUpperCase() });
    if (url.includes("/slow")) {
      return new Promise<Response>((_res, reject) => {
        pending.push({ reject, signal: init?.signal });
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return Promise.resolve(new Response("ok", { status: 200 }));
  });
  const sockets: string[] = [];
  class FakeWS {
    constructor(public url: string) {
      sockets.push(url);
    }
    close() {}
  }
  const beacon = vi.fn(() => true);
  const win = window as unknown as W;
  const saved = { fetch: win.fetch, WebSocket: win.WebSocket, beacon: win.navigator.sendBeacon };
  win.fetch = fetchImpl as unknown as typeof fetch;
  (win as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
  try {
    Object.defineProperty(win.navigator, "sendBeacon", { value: beacon, configurable: true, writable: true });
  } catch {
    // why: a runner whose navigator can't take the property; the beacon case then checks the real one
  }
  const restore = () => {
    win.fetch = saved.fetch;
    (win as unknown as { WebSocket: unknown }).WebSocket = saved.WebSocket;
    try {
      Object.defineProperty(win.navigator, "sendBeacon", { value: saved.beacon, configurable: true, writable: true });
    } catch {
      // why: see above
    }
  };
  return { win, calls, fetchImpl, sockets, beacon, pending, restore };
}

let restoreFake: (() => void) | null = null;
beforeEach(() => {
  __resetAirplane();
  try {
    localStorage.removeItem(AIRPLANE_KEY);
  } catch {
    // why: no localStorage in this runner
  }
});
afterEach(() => {
  restoreFake?.();
  restoreFake = null;
  __resetAirplane();
  try {
    localStorage.removeItem(AIRPLANE_KEY);
  } catch {
    // why: no localStorage in this runner
  }
  document.head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach((m) => m.remove());
});

describe("blind: airplane verdicts (W10.D19)", () => {
  // `Verdict` ("network" | "local" | "self" | "blocked") is only typed, not documented: what
  // "self" covers isn't said (the app's own origin is "network" here, and is handled by
  // fetch as GET-from-cache, A8). So this checks only that another site is never local.
  it("A1 another site is never 'local'", () => {
    for (const u of ["https://example.com/x", "http://evil.test:8080/", "//cdn.example.org/a.js", "wss://collab.example.net/room"]) {
      expect(verdict(u, BASE)).not.toBe("local");
    }
  });

  it("A2 loopback, blob: and data: stay allowed (they don't leave the computer)", () => {
    for (const u of ["http://localhost:11434/api/generate", "http://127.0.0.1:8080/", "http://[::1]:11434/", "HTTP://LOCALHOST:11434/", "blob:https://app.example.test/1234", "data:text/plain,hi"]) {
      expect(verdict(u, BASE)).toBe("local");
    }
  });

  it("A3 names that only look like loopback are another site", () => {
    for (const u of ["http://localhost.evil.test/", "http://127.0.0.1.nip.io/", "http://evil.test/?u=localhost", "http://localhost@evil.test/", "http://127.0.0.1@evil.test/"]) {
      expect(verdict(u, BASE)).not.toBe("local");
    }
  });
});

describe("blind: the switch (W10.D19)", () => {
  it("A4 on from the moment it is turned on; off reloads the page", () => {
    expect(airplaneModeOn()).toBe(false);
    expect(airplaneSince()).toBeNull();
    const before = Date.now();
    enableAirplaneMode();
    expect(airplaneModeOn()).toBe(true);
    expect(airplaneSince()).toBeGreaterThanOrEqual(before - 1);
    const reload = vi.fn();
    disableAirplaneMode(reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("A5 the browser-enforced policy allows frames from blob: only, and no other site for images, fonts, media or connections", () => {
    const directives = new Map(
      AIRPLANE_CSP.split(";")
        .map((d) => d.trim().split(/\s+/))
        .map(([k, ...v]) => [k, v] as const),
    );
    expect(directives.get("frame-src")).toEqual(["blob:"]);
    for (const d of ["img-src", "font-src", "media-src", "connect-src", "default-src"]) {
      for (const src of directives.get(d) ?? []) {
        expect(src).not.toBe("*");
        expect(src).not.toMatch(/^https?:$/);
        if (/^(https?|wss?):\/\//.test(src)) expect(src).toMatch(/^(https?|wss?):\/\/(localhost|127\.0\.0\.1)(:\*)?$/);
      }
    }
  });

  it("A6 turning it on puts the policy into the page", () => {
    const f = fakeWindow();
    restoreFake = f.restore;
    installAirplaneMode(f.win);
    enableAirplaneMode();
    const metas = [...document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')].map((m) => m.getAttribute("content"));
    expect(metas).toContain(AIRPLANE_CSP);
  });
});

describe("blind: wrapped network calls (W10.D19)", () => {
  it("A7 fetch to another site is refused before it runs (AirplaneBlockedError); the monitor lists it without its query", async () => {
    const f = fakeWindow();
    restoreFake = f.restore;
    installAirplaneMode(f.win);
    enableAirplaneMode();
    const e = await f.win.fetch("https://example.com/track?user=dana&secret=1#frag").then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(AirplaneBlockedError);
    expect(f.calls.filter((c) => c.url.includes("example.com"))).toHaveLength(0);
    const a = egressAttempts().find((x) => x.target.includes("example.com"))!;
    expect(a).toBeTruthy();
    expect(a.decision).toBe("blocked");
    expect(a.kind).toBe("fetch");
    expect(a.target).not.toContain("secret");
    expect(a.target).not.toContain("?");
    expect(a.target).not.toContain("#");
    expect(a.target).toBe("https://example.com/track");
  });

  it("A8 fetch to the app's own origin: GET only, and only from a cache", async () => {
    const f = fakeWindow();
    restoreFake = f.restore;
    installAirplaneMode(f.win);
    enableAirplaneMode();
    const own = new URL("/api/notes", location.href).href;
    await f.win.fetch(own).catch(() => undefined);
    const got = f.calls.filter((c) => c.url.startsWith(own));
    for (const c of got) expect(c.cache).toBe("only-if-cached");
    const post = await f.win.fetch(own, { method: "POST", body: "x" }).then(
      () => null,
      (x: unknown) => x,
    );
    expect(post).toBeInstanceOf(AirplaneBlockedError);
    expect(f.calls.filter((c) => c.url.startsWith(own) && c.method === "POST")).toHaveLength(0);
  });

  it("A9 fetch to a local model on this machine still goes through", async () => {
    const f = fakeWindow();
    restoreFake = f.restore;
    installAirplaneMode(f.win);
    enableAirplaneMode();
    const r = await f.win.fetch("http://localhost:11434/api/tags");
    expect(r.status).toBe(200);
    expect(f.calls.some((c) => c.url.startsWith("http://localhost:11434"))).toBe(true);
    expect(egressAttempts().find((x) => x.target.startsWith("http://localhost:11434"))?.decision).toBe("local");
  });

  it("A10 a request still waiting for its answer when the switch goes on is counted (in-flight) and aborted", async () => {
    const f = fakeWindow();
    restoreFake = f.restore;
    installAirplaneMode(f.win);
    const p = f.win.fetch("https://example.com/slow").then(
      () => "resolved",
      () => "rejected",
    );
    await Promise.resolve();
    enableAirplaneMode();
    expect(await Promise.race([p, new Promise((r) => setTimeout(() => r("still waiting"), 500))])).toBe("rejected");
    expect(egressAttempts().some((x) => x.decision === "in-flight" && x.target.includes("example.com"))).toBe(true);
    expect(egressTally().inFlight).toBeGreaterThanOrEqual(1);
  });

  it("A11 WebSocket to another site and sendBeacon are refused while it is on", () => {
    const f = fakeWindow();
    restoreFake = f.restore;
    installAirplaneMode(f.win);
    enableAirplaneMode();
    let threw = false;
    try {
      new f.win.WebSocket("wss://collab.example.net/room");
    } catch {
      threw = true;
    }
    expect(threw || f.sockets.length === 0).toBe(true);
    expect(f.sockets).not.toContain("wss://collab.example.net/room");
    const sent = f.win.navigator.sendBeacon("https://metrics.example.com/b", "x");
    expect(sent).toBe(false);
    expect(f.beacon).not.toHaveBeenCalled();
  });

  it("A12 before the switch, requests are listed as allowed; subscribers hear each new attempt", async () => {
    const f = fakeWindow();
    restoreFake = f.restore;
    installAirplaneMode(f.win);
    const heard = vi.fn();
    const off = subscribeEgress(heard);
    await f.win.fetch("https://example.com/a");
    expect(egressAttempts().find((x) => x.target === "https://example.com/a")?.decision).toBe("allowed");
    expect(heard).toHaveBeenCalled();
    off();
    const n = heard.mock.calls.length;
    await f.win.fetch("https://example.com/b");
    expect(heard.mock.calls.length).toBe(n);
  });

  it("A13 every attempt in the time span is counted, however many: 2,000 blocked requests are all in the tally", async () => {
    const f = fakeWindow();
    restoreFake = f.restore;
    installAirplaneMode(f.win);
    enableAirplaneMode();
    for (let i = 0; i < 2000; i++) await f.win.fetch(`https://example.com/${i}`).catch(() => undefined);
    const t = egressTally();
    expect(t.blocked).toBeGreaterThanOrEqual(2000);
    expect(t.left).toBe(0);
  });
});

describe("blind: frames (W10.D19)", () => {
  it("A14 while the switch is on no frame gets allow-popups; another site's frame keeps allow-same-origin only for a known embed provider", () => {
    enableAirplaneMode();
    const yt = guardedSandbox("allow-scripts allow-same-origin allow-popups", "https://www.youtube-nocookie.com/embed/x", BASE);
    expect(yt.split(/\s+/)).not.toContain("allow-popups");
    const other = guardedSandbox("allow-scripts allow-same-origin allow-popups", "https://unknown-site.example/embed", BASE);
    expect(other.split(/\s+/)).not.toContain("allow-popups");
    expect(other.split(/\s+/)).not.toContain("allow-same-origin");
    expect(other.split(/\s+/)).toContain("allow-scripts");
  });
});
