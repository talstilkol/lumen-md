import { describe, it, expect, vi } from "vitest";

const log: string[] = [];
vi.mock("webr", () => {
  class Shelter {
    async captureR(code: string) {
      log.push(`start ${code}`);
      await new Promise((r) => setTimeout(r, code === "slow" ? 30 : 1));
      log.push(`end ${code}`);
      return { output: [{ type: "stdout", data: code }] };
    }
    async purge() {}
  }
  class WebR {
    Shelter = Shelter;
    async init() {}
    async flush() {
      return [];
    }
    async evalRVoid(c: string) {
      log.push(c.startsWith("webr::canvas") ? "open device" : "close devices");
    }
    close() {}
  }
  return { WebR, ChannelType: { PostMessage: 1 } };
});

describe("runR", () => {
  it("serialises runs on the shared webR instance", async () => {
    const { runR } = await import("../plugins/r/rRuntime");
    const started: string[] = [];
    const [a, b] = await Promise.all([
      runR("slow", undefined, { onStart: () => started.push("slow") }),
      runR("fast", undefined, { onStart: () => started.push("fast") }),
    ]);
    expect(a?.lines[0].text).toBe("slow");
    expect(b?.lines[0].text).toBe("fast");
    expect(started).toEqual(["slow", "fast"]);
    // The second run's device opens only after the first closed its own.
    expect(log).toEqual([
      "open device", "start slow", "end slow", "close devices",
      "open device", "start fast", "end fast", "close devices",
    ]);
  });

  it("skips a run cancelled while queued", async () => {
    const { runR } = await import("../plugins/r/rRuntime");
    let cancelled = false;
    const first = runR("slow");
    const second = runR("never", undefined, { isCancelled: () => cancelled });
    cancelled = true;
    await first;
    expect(await second).toBeNull();
    expect(log).not.toContain("start never");
  });
});
