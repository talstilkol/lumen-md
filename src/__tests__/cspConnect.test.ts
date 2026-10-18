import { describe, it, expect } from "vitest";
import { connectAllowedByCsp } from "../lib/cspConnect";

const SRC = ["'self'", "blob:", "wss:", "https://api.openai.com", "http://localhost:11434", "https://*.supabase.co"];

describe("connectAllowedByCsp", () => {
  it("allows listed origins, scheme sources, wildcards and self", () => {
    expect(connectAllowedByCsp("https://api.openai.com/v1/chat", SRC)).toBe(true);
    expect(connectAllowedByCsp("http://localhost:11434/api/tags", SRC)).toBe(true);
    expect(connectAllowedByCsp("wss://anything.example/ws", SRC)).toBe(true);
    expect(connectAllowedByCsp("https://abc.supabase.co/rest", SRC)).toBe(true);
    expect(connectAllowedByCsp(`${location.origin}/x`, SRC)).toBe(true);
  });

  it("rejects origins the policy would block (runtime overrides)", () => {
    expect(connectAllowedByCsp("https://market.evil.test/items", SRC)).toBe(false);
    expect(connectAllowedByCsp("http://192.168.1.20:11434", SRC)).toBe(false);
    expect(connectAllowedByCsp("http://localhost:9999", SRC)).toBe(false);
    expect(connectAllowedByCsp("https://supabase.co", SRC)).toBe(false);
  });

  it("'self' covers the page host's WebSocket and secure schemes (CSP3), nothing else", () => {
    const self = ["'self'"];
    const host = location.host;
    expect(connectAllowedByCsp(`ws://${host}/hmr`, self)).toBe(location.protocol === "http:");
    expect(connectAllowedByCsp(`wss://${host}/hmr`, self)).toBe(true);
    expect(connectAllowedByCsp(`wss://other.example/hmr`, self)).toBe(false);
  });

  it("explicit WebSocket hosts (plan 2.2: the policies carry no bare wss:)", () => {
    const list = ["'self'", "wss://signal.lumen.md", "ws://*:5173"];
    expect(connectAllowedByCsp("wss://signal.lumen.md", list)).toBe(true);
    expect(connectAllowedByCsp("wss://signal.lumen.md:8443", list)).toBe(false);
    expect(connectAllowedByCsp("ws://signal.lumen.md", list)).toBe(false);
    expect(connectAllowedByCsp("wss://my-signal.example.org", list)).toBe(false);
  });

  it("allows everything when no policy is present", () => {
    expect(connectAllowedByCsp("https://anything.test", null)).toBe(true);
  });
});
