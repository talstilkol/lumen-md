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

  it("allows everything when no policy is present", () => {
    expect(connectAllowedByCsp("https://anything.test", null)).toBe(true);
  });
});
