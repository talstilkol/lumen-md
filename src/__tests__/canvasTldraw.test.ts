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

  describe("startNewCanvas (review: #206)", () => {
    type Start = typeof import("../ui/CanvasTldraw").startNewCanvas;
    function harness(startNewCanvas: Start, exists: boolean, confirm: boolean) {
      const calls: string[] = [];
      let page = "drawing";
      const files = new Map<string, unknown>();
      const run = () =>
        startNewCanvas({
          name: "plan",
          exists,
          confirmReplace: async (n) => {
            calls.push(`confirm:${n}`);
            return confirm;
          },
          detach: () => calls.push("detach"),
          clear: () => {
            calls.push("clear");
            page = "blank";
          },
          snapshot: () => page,
          save: async (n, snap) => {
            calls.push(`save:${n}`);
            files.set(n, snap);
          },
        });
      return { calls, files, run };
    }

    it("writes the blank page under the new name right away, after saving the old canvas", async () => {
      const { startNewCanvas } = await import("../ui/CanvasTldraw");
      const h = harness(startNewCanvas, false, true);
      expect(await h.run()).toBe(true);
      expect(h.calls).toEqual(["detach", "clear", "save:plan"]);
      expect(h.files.get("plan")).toBe("blank"); // closing now reopens the blank canvas, not the old drawing
    });

    it("asks before replacing a canvas with that name, and changes nothing when declined", async () => {
      const { startNewCanvas } = await import("../ui/CanvasTldraw");
      const declined = harness(startNewCanvas, true, false);
      expect(await declined.run()).toBe(false);
      expect(declined.calls).toEqual(["confirm:plan"]);
      expect(declined.files.size).toBe(0);
      const accepted = harness(startNewCanvas, true, true);
      expect(await accepted.run()).toBe(true);
      expect(accepted.calls).toEqual(["confirm:plan", "detach", "clear", "save:plan"]);
    });
  });
});
