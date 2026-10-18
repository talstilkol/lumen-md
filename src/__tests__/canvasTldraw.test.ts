/**
 * Smoke test for the tldraw-backed canvas (γ.2). Driving the full
 * tldraw editor in jsdom isn't feasible (it needs WebGL + layout), so
 * we verify what we can without rendering:
 *   - tldraw is installed at the version we wired
 *   - the snapshot helpers are exported
 *   - the lazy import resolves
 */

import { describe, it, expect, vi } from "vitest";

describe("tldraw integration (γ.2)", () => {
  it("tldraw module exports the expected helpers", async () => {
    const tldraw = await import("tldraw");
    expect(typeof tldraw.Tldraw).toBe("function");
    expect(typeof tldraw.getSnapshot).toBe("function");
    expect(typeof tldraw.loadSnapshot).toBe("function");
  });

  it("CanvasTldraw module exports the React component", async () => {
    const mod = await import("../ui/CanvasTldraw");
    expect(typeof mod.CanvasTldraw).toBe("function");
  });

  it("closing within the debounce flushes the pending save instead of dropping it", async () => {
    vi.useFakeTimers();
    try {
      const { debouncedSave } = await import("../ui/CanvasTldraw");
      const save = vi.fn();
      const s = debouncedSave(save, 500);
      s.schedule();
      s.schedule();
      vi.advanceTimersByTime(200);
      s.flush(); // unmount 200 ms after the last stroke
      expect(save).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      expect(save).toHaveBeenCalledTimes(1);
      s.flush(); // nothing pending: no extra write
      expect(save).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("New saves the old canvas, then clearing the editor writes nothing to it (review: #194)", async () => {
    vi.useFakeTimers();
    try {
      const { bindCanvasSaver } = await import("../ui/CanvasTldraw");
      let onChange: (() => void) | null = null;
      const listen = (f: () => void) => {
        onChange = f;
        return () => {
          onChange = null;
        };
      };
      const saves: string[] = [];
      let page = "drawing";
      const b = bindCanvasSaver(listen, () => saves.push(page), 500);
      (onChange as (() => void) | null)!(); // a stroke, still inside the debounce
      b.detach(); // New: flush the old canvas first
      expect(saves).toEqual(["drawing"]);
      page = "empty";
      (onChange as (() => void) | null)?.(); // the clear — no longer listened to
      vi.advanceTimersByTime(1000);
      b.detach(); // the effect cleanup later: no second write
      expect(saves).toEqual(["drawing"]);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("New canvas, in an order that loses nothing (review: #206)", () => {
    it("asks before replacing a canvas with that name; declining changes nothing", async () => {
      const { startNewCanvas } = await import("../ui/CanvasTldraw");
      const calls: string[] = [];
      const run = (exists: boolean, ok: boolean) =>
        startNewCanvas({
          name: "plan",
          exists,
          confirmReplace: async (n) => (calls.push(`confirm:${n}`), ok),
          detach: () => calls.push("detach"),
          clear: () => calls.push("clear"),
        });
      expect(await run(true, false)).toBe(false);
      expect(calls).toEqual(["confirm:plan"]);
      calls.length = 0;
      expect(await run(true, true)).toBe(true);
      expect(calls).toEqual(["confirm:plan", "detach", "clear"]);
      calls.length = 0;
      expect(await run(false, true)).toBe(true);
      expect(calls).toEqual(["detach", "clear"]); // nothing awaited between the clear and the re-bind
    });

    it("a fresh binding saves the cleared page at once, so closing right away keeps it blank", async () => {
      const { bindCanvasSaver } = await import("../ui/CanvasTldraw");
      const saves: string[] = [];
      let onChange: (() => void) | null = null;
      const b = bindCanvasSaver(
        (f) => ((onChange = f), () => (onChange = null)),
        () => saves.push("blank"),
        500,
        { fresh: true },
      );
      expect(saves).toEqual(["blank"]);
      b.detach(); // nothing pending: no second write
      expect(saves).toEqual(["blank"]);
      expect(onChange).toBeNull();
    });

    it("writes to one canvas file land in the order they were asked for, even when the first is slower", async () => {
      const { queueCanvasWrite } = await import("../ui/CanvasTldraw");
      const landed: string[] = [];
      let releaseOld!: () => void;
      const old = queueCanvasWrite("plan", () => new Promise<void>((r) => (releaseOld = () => (landed.push("old drawing"), r()))));
      const blank = queueCanvasWrite("plan", async () => void landed.push("blank"));
      const other = queueCanvasWrite("other", async () => void landed.push("other"));
      await other;
      expect(landed).toEqual(["other"]); // another file is not held up
      releaseOld();
      await Promise.all([old, blank]);
      expect(landed).toEqual(["other", "old drawing", "blank"]);
      // a failed write does not block the next one
      await expect(queueCanvasWrite("plan", async () => Promise.reject(new Error("quota")))).rejects.toThrow("quota");
      await queueCanvasWrite("plan", async () => void landed.push("after failure"));
      expect(landed.at(-1)).toBe("after failure");
    });
  });

  it("a load waits for writes already queued to the same canvas (review: #206)", async () => {
    const { queueCanvasWrite, afterCanvasWrites } = await import("../ui/CanvasTldraw");
    const order: string[] = [];
    let release!: () => void;
    void queueCanvasWrite("a", () => new Promise<void>((r) => (release = () => (order.push("blank written"), r()))));
    const read = afterCanvasWrites("a").then(() => order.push("read"));
    await afterCanvasWrites("b"); // nothing queued for b: immediate
    expect(order).toEqual([]);
    release();
    await read;
    expect(order).toEqual(["blank written", "read"]);
    // a failed write does not block the read
    void queueCanvasWrite("a", async () => Promise.reject(new Error("quota"))).catch(() => undefined);
    await expect(afterCanvasWrites("a")).resolves.toBeUndefined();
  });

  it("switching canvases clears the fresh mark (source check: the component is not mountable in jsdom)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "../ui/CanvasTldraw.tsx"), "utf8");
    const pick = src.slice(src.indexOf("const handlePick"), src.indexOf("const handleConvertLegacy"));
    expect(pick).toMatch(/freshCanvas\.current = null;[\s\S]*setCanvasName\(name\)/);
    const convert = src.slice(src.indexOf("const handleConvertLegacy"));
    expect(convert).toMatch(/freshCanvas\.current = null;\s*setCanvasName\(legacyName\)/);
  });

  describe("restore and New against the disk (review: #206)", () => {
    it("does not restore over a stroke drawn while the file was loading", async () => {
      const { restoreUnlessEdited } = await import("../ui/CanvasTldraw");
      let edit: (() => void) | null = null;
      let release!: (v: unknown) => void;
      const applied: unknown[] = [];
      const p = restoreUnlessEdited({
        listenUserEdits: (f) => ((edit = f), () => (edit = null)),
        load: () => new Promise((r) => (release = r)),
        apply: (s) => applied.push(s),
        cancelled: () => false,
      });
      edit!(); // the user draws before the read finishes
      release({ old: true });
      expect(await p).toBe("edited");
      expect(applied).toEqual([]);
      expect(edit).toBeNull(); // unsubscribed
      // without an edit the snapshot is applied
      const q = await restoreUnlessEdited({ listenUserEdits: () => () => {}, load: async () => ({ s: 1 }), apply: (s) => applied.push(s), cancelled: () => false });
      expect(q).toBe("applied");
      expect(applied).toEqual([{ s: 1 }]);
    });

    it("New asks the disk whether the name is taken, not only the picker's list", async () => {
      const { installFakeOpfs } = await import("./helpers/fakeOpfs");
      installFakeOpfs();
      const { canvasFileExists } = await import("../ui/CanvasTldraw");
      expect(await canvasFileExists("plan")).toBe(false);
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("canvases", { create: true });
      const fh = await dir.getFileHandle("plan.tldr", { create: true });
      const w = await fh.createWritable();
      await w.write("{}");
      await w.close();
      expect(await canvasFileExists("plan")).toBe(true);
    });
  });

  describe("switching canvases (review: #206)", () => {
    async function run(result: "applied" | "edited" | "empty" | "cancelled" | Error, cancelledAfter = false) {
      const { switchCanvas } = await import("../ui/CanvasTldraw");
      const log: string[] = [];
      const lock = { current: null as string | null };
      let cancelled = false;
      const out = await switchCanvas({
        name: "B",
        lock,
        setReadonly: (r) => log.push(`readonly:${r}`),
        restore: async () => {
          log.push(`locked:${lock.current}`);
          if (cancelledAfter) cancelled = true;
          if (result instanceof Error) throw result;
          return result;
        },
        clear: () => log.push("clear"),
        cancelled: () => cancelled,
        onUnreadable: () => log.push("unreadable"),
      });
      return { out, log, lock };
    }

    it("is read-only with the saver held until the snapshot is in", async () => {
      const r = await run("applied");
      expect(r.log).toEqual(["readonly:true", "locked:B", "readonly:false"]);
      expect(r.lock.current).toBeNull();
    });

    it("a canvas with no saved file starts blank instead of keeping the previous drawing", async () => {
      const r = await run("empty");
      expect(r.log).toEqual(["readonly:true", "locked:B", "readonly:false", "clear"]);
    });

    it("an unreadable file stays read-only with the saver held, so it is not overwritten", async () => {
      const r = await run(new SyntaxError("bad json"));
      expect(r.out).toBe("unreadable");
      expect(r.log).toEqual(["readonly:true", "locked:B", "unreadable"]);
      expect(r.lock.current).toBe("B");
    });

    it("a newer switch keeps the lock and read-only state", async () => {
      const r = await run("applied", true);
      expect(r.out).toBe("cancelled");
      expect(r.log).toEqual(["readonly:true", "locked:B"]);
      expect(r.lock.current).toBe("B");
    });

    it("the saver writes nothing for a canvas that is still restoring (source check)", async () => {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const src = readFileSync(join(__dirname, "../ui/CanvasTldraw.tsx"), "utf8");
      const saver = src.slice(src.indexOf("const binding = bindCanvasSaver"));
      expect(saver).toMatch(/if \(restoring\.current === canvasName\) return;[\s\S]*getSnapshot\(editor\.store\)/);
    });
  });
});
