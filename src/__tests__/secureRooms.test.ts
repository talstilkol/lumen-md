/** T49 — secure rooms: 128-bit names, auto passwords, own signaling, server token. */
import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import { createRequire } from "node:module";
import { makeRoomName, makeRoomPassword, signalingUrls, PUBLIC_SIGNALING_KEY } from "../collab/yjs";
import { setRoomInHash, readRoomFromHash } from "../collab/roomUrl";

const require = createRequire(import.meta.url);
const { tokenOk } = require(path.resolve(__dirname, "../../sync-server/token.js")) as { tokenOk: (url: string, expected: string) => boolean };

describe("secure rooms", () => {
  beforeEach(() => localStorage.clear());

  it("room names carry 128 random bits and stay URL-safe", () => {
    const names = new Set(Array.from({ length: 50 }, makeRoomName));
    expect(names.size).toBe(50);
    for (const n of names) expect(n).toMatch(/^lumen-[0-9a-f]{32}$/);
  });

  it("room passwords are 128-bit and URL-safe", () => {
    const p = makeRoomPassword();
    expect(p).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(makeRoomPassword()).not.toBe(p);
  });

  it("the share link in the address bar carries the new room's password", () => {
    setRoomInHash("lumen-abc", "p_w-1");
    expect(location.hash).toBe("#room=lumen-abc&password=p_w-1");
    expect(readRoomFromHash()).toBe("lumen-abc");
    setRoomInHash(null);
    expect(location.hash).toBe("");
  });

  it("signals through Lumen's own server only, unless public servers are opted in", () => {
    expect(signalingUrls()).toHaveLength(1);
    expect(signalingUrls()[0]).not.toMatch(/yjs\.dev|herokuapp/);
    localStorage.setItem(PUBLIC_SIGNALING_KEY, "1");
    expect(signalingUrls().length).toBeGreaterThan(1);
  });

  it("the public fallback opt-in also applies behind a custom signaling server", () => {
    localStorage.setItem("lumen.collab.signaling", "wss://signal.example.org");
    try {
      expect(signalingUrls()).toEqual(["wss://signal.example.org"]);
      localStorage.setItem(PUBLIC_SIGNALING_KEY, "1");
      const urls = signalingUrls();
      expect(urls[0]).toBe("wss://signal.example.org");
      expect(urls.some((u) => /yjs\.dev/.test(u))).toBe(true);
    } finally {
      localStorage.removeItem("lumen.collab.signaling");
      localStorage.removeItem(PUBLIC_SIGNALING_KEY);
    }
  });

  it("the persistent server checks its access token in constant time", () => {
    expect(tokenOk("/room", "")).toBe(true);
    expect(tokenOk("/room?token=s3cret", "s3cret")).toBe(true);
    expect(tokenOk("/room?token=wrong!", "s3cret")).toBe(false);
    expect(tokenOk("/room", "s3cret")).toBe(false);
  });
});
