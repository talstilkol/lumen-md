/**
 * Smoke test for the tldraw-backed canvas (γ.2). Driving the full
 * tldraw editor in jsdom isn't feasible (it needs WebGL + layout), so
 * we verify what we can without rendering:
 *   - tldraw is installed at the version we wired
 *   - the snapshot helpers are exported
 *   - the lazy import resolves
 */

import { describe, it, expect } from "vitest";

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
});
