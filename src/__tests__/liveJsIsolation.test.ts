/**
 * Regression: LiveJS user-thrown errors must be contained inside the
 * worker — they must NEVER reach window.onerror / pageerror.
 *
 * Round 25 found that a `throw` in user fence content leaked all the way
 * up to the parent page. Three defects compounded:
 *
 *   1. The async IIFE inside the `new Function(...)` body had no `return`,
 *      so the runner discarded its promise; the rejection became
 *      unhandled in the worker.
 *   2. `self.onerror` did NOT return `true`, so the default action
 *      (propagate to parent) still fired.
 *   3. `self.onunhandledrejection` did NOT call `preventDefault()`, same
 *      problem.
 *
 * jsdom can't run real Web Workers, so this test reads the worker source
 * string and asserts the three properties textually. The end-to-end
 * containment check lives in `e2e/error-paths.spec.ts` ("LiveJS with
 * throw doesn't propagate up to pageerror").
 */

import { describe, it, expect } from "vitest";
import { WORKER_SOURCE } from "../plugins/LiveJsBlock";

describe("LiveJS worker isolation (regression for round-25 throw leak)", () => {
  it("returns the async IIFE so its rejection flows into the outer .then chain", () => {
    expect(WORKER_SOURCE).toMatch(/return \(async function\(\)/);
  });

  it("onerror returns true to suppress default propagation to the parent", () => {
    // The handler body must contain "return true" so the worker swallows
    // the error instead of letting it bubble up as a pageerror.
    expect(WORKER_SOURCE).toMatch(/self\.onerror[\s\S]+?return true/);
  });

  it("onunhandledrejection calls preventDefault to keep the rejection from escaping", () => {
    expect(WORKER_SOURCE).toMatch(
      /self\.onunhandledrejection[\s\S]+?preventDefault/,
    );
  });
});
