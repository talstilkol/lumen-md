/**
 * W13.T5: safe mode after a failed start. A start that never reached
 * markBootOk (a plugin that crashes the page while it starts) makes the next
 * start open in safe mode: no plugin starts, no vault snippet, no agent; the
 * person leaves it without a restart and chooses what comes back.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BOOT_OK_AFTER_MS,
  SENTINEL_KEY,
  SafeModeError,
  armBootOk,
  assertNotSafeMode,
  beginBoot,
  bootDecision,
  exitSafeMode,
  isSafeMode,
  markBootOk,
  noteBootCrash,
  onSafeModeChange,
  requestSafeModeNextStart,
  resetBootForTests,
  safeModeBlocks,
} from "../boot/bootSentinel";

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

let local: MemStore;
let session: MemStore;
let clock: number;
const boot = (version = "1.4.0", search = "") => {
  resetBootForTests();
  clock += 60_000;
  return beginBoot(version, { storage: local, session, now: clock, search });
};
/** A start whose page dies on a plugin before it is up: markBootOk never runs. */
const crashingStart = (version = "1.4.0") => {
  const d = boot(version);
  const pluginThatCrashesAtBoot = () => {
    throw new Error("plugin top-level code threw");
  };
  expect(pluginThatCrashesAtBoot).toThrow();
  return d;
};

beforeEach(() => {
  local = new MemStore();
  session = new MemStore();
  clock = 1_700_000_000_000;
});
afterEach(() => resetBootForTests());

describe("crash loop → safe mode", () => {
  it("a first start, and a start after a clean one, are normal", () => {
    expect(boot().safeMode).toBe(false);
    markBootOk({ storage: local });
    const d = boot();
    expect(d).toMatchObject({ safeMode: false, failures: 0, reason: null });
    expect(isSafeMode()).toBe(false);
  });

  it("a plugin that crashes at start → the next start is in safe mode", () => {
    markBootOk({ storage: local, version: "1.4.0" });
    crashingStart();
    const next = boot();
    expect(next).toMatchObject({ safeMode: true, reason: "crash-loop", failures: 1 });
    expect(isSafeMode()).toBe(true);
    expect(bootDecision()?.reason).toBe("crash-loop");
  });

  it("in safe mode no plugin, snippet or agent starts", () => {
    crashingStart();
    boot();
    expect(() => assertNotSafeMode("plugin")).toThrow(SafeModeError);
    expect(() => assertNotSafeMode("agent")).toThrow(/safe mode: agent/);
    expect(safeModeBlocks("snippets")).toBe(true);
  });

  it("the root error screen means the start failed, even if the page stayed open", () => {
    boot();
    noteBootCrash();
    let fire: (() => void) | null = null;
    armBootOk({ storage: local, setTimer: (f) => (fire = f) });
    fire!();
    expect(boot().safeMode).toBe(true);
  });

  it("a start that stays up for BOOT_OK_AFTER_MS clears the marker", () => {
    boot();
    let delay = 0;
    let fire: (() => void) | null = null;
    armBootOk({ storage: local, setTimer: (f, ms) => ((fire = f), (delay = ms)) });
    expect(delay).toBe(BOOT_OK_AFTER_MS);
    fire!();
    expect(JSON.parse(local.getItem(SENTINEL_KEY)!)).toMatchObject({ pending: false, failures: 0, good: "1.4.0" });
    expect(boot().safeMode).toBe(false);
  });

  it("a reload in the first second is the same start, not a failure", () => {
    resetBootForTests();
    beginBoot("1.4.0", { storage: local, session, now: clock });
    resetBootForTests();
    expect(beginBoot("1.4.0", { storage: local, session, now: clock + 300 }).safeMode).toBe(false);
  });

  it("safe mode holds across starts until the person leaves it", () => {
    crashingStart();
    boot();
    markBootOk({ storage: local }); // safe mode itself starts fine
    expect(boot()).toMatchObject({ safeMode: true, reason: "crash-loop" });
    exitSafeMode({}, session, local);
    markBootOk({ storage: local });
    expect(boot().safeMode).toBe(false);
  });

  it("a new version after a failure starts normally (the old version's failures are not its own)", () => {
    crashingStart("1.4.0");
    expect(boot("1.4.1").safeMode).toBe(false);
  });
});

describe("leaving safe mode without a restart", () => {
  it("turns the flag off, tells listeners, and keeps agents off when unticked", () => {
    crashingStart();
    boot();
    const seen: boolean[] = [];
    onSafeModeChange((on) => seen.push(on));
    exitSafeMode({ agents: false }, session, local);
    expect(isSafeMode()).toBe(false);
    expect(seen).toEqual([false]);
    expect(() => assertNotSafeMode("plugin")).not.toThrow();
    expect(safeModeBlocks("snippets")).toBe(false);
    expect(safeModeBlocks("agent")).toBe(true);
  });

  it("with agents ticked, everything is allowed again", () => {
    crashingStart();
    boot();
    exitSafeMode({ agents: true }, session, local);
    expect(safeModeBlocks("agent")).toBe(false);
  });
});

describe("safe mode by choice", () => {
  it("?safe-mode in the address", () => {
    expect(boot("1.4.0", "?safe-mode")).toMatchObject({ safeMode: true, reason: "manual" });
    markBootOk({ storage: local });
    expect(boot("1.4.0", "?x=1&safe-mode=1")).toMatchObject({ safeMode: true, reason: "manual" });
    markBootOk({ storage: local });
    expect(boot("1.4.0", "?safe-modes").safeMode).toBe(false);
  });

  it("the palette command asks for it for the next start of this session, and leaving it ends it", () => {
    requestSafeModeNextStart(session);
    expect(boot()).toMatchObject({ safeMode: true, reason: "manual" });
    markBootOk({ storage: local });
    exitSafeMode({}, session, local);
    expect(boot().safeMode).toBe(false);
  });
});

describe("storage it cannot use", () => {
  const broken = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceeded");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };

  it("blocked storage: a normal start, never a loop of its own making", () => {
    resetBootForTests();
    expect(beginBoot("1.4.0", { storage: broken, session: broken, now: clock, search: "" }).safeMode).toBe(false);
    expect(() => markBootOk({ storage: broken })).not.toThrow();
  });

  it("a damaged record is ignored", () => {
    local.setItem(SENTINEL_KEY, "{not json");
    expect(boot().safeMode).toBe(false);
    local.setItem(SENTINEL_KEY, JSON.stringify({ v: 2, version: "1.4.0", pending: true }));
    expect(boot().safeMode).toBe(false);
  });
});

describe("the guards where things start", () => {
  it("the plugin manager refuses to start a plugin in safe mode", async () => {
    crashingStart();
    boot();
    const { startPlugin } = await import("../plugins/runtime/manager");
    const manifest = { id: "crashy", name: "Crashy", version: "1.0.0", capabilities: [] } as never;
    await expect(startPlugin({ manifest, code: "throw new Error('boom')", grants: new Set() as never })).rejects.toBeInstanceOf(SafeModeError);
  });

  it("an agent run ends with errorCode safe-mode and never reaches a model", async () => {
    crashingStart();
    boot();
    const { runAgent } = await import("../agents/runtime");
    let called = false;
    const def = { id: "t.safe", commandId: "t.safe", instructions: "x", executorPreference: ["fake"], build: () => { called = true; return { system: "", user: "" }; } } as never;
    const run = await runAgent(def, { text: "hi" } as never);
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("safe-mode");
    expect(called).toBe(false);
  });
});
