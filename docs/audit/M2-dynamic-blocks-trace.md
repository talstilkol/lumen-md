# M2 — `dynamic-blocks-hardening` trace

## What it tests

Two tests in `e2e/dynamic-blocks-hardening.spec.ts`:

1. **Mixed safe-fence smoke** — pastes an HTML fence (with a `<script>`
   that must be sanitized), a live-js fence, and an svg fence. Asserts:
   - HTML preview shows the "sanitized" notice
   - live-js completes and logs `[log] js-ok`
   - SVG block renders with "Rendered" status

2. **LiveJS error state** — `throw new Error(...)` inside a live-js
   fence shows "JS run: Runtime error" in the UI.

## Current state

Isolated run (chromium, prod build):

```
$ PLAYWRIGHT_BASE_URL=http://localhost:5180 npx playwright test \
    --project=chromium e2e/dynamic-blocks-hardening.spec.ts \
    --reporter=line
[1/2] Live JS block surfaces error state on runtime exception
[2/2] security-critical dynamic blocks stay functional with safe status output
2 passed (1.5s)
```

✅ Both pass on the post-round-25 main.

## Why it now passes

Both tests depend on three subsystems that round-25 stabilized:

1. **`markupSanitizer` (`src/lib/markupSanitizer.ts`)** — drops
   `<script>` tags, fires the "sanitized" notice. Existed pre-round-25.

2. **LiveJsBlock worker isolation** — round-25 fixes:
   - `return (async function(){…})()` instead of discarding the IIFE's
     promise
   - `self.onerror` returns `true` to suppress propagation
   - `self.onunhandledrejection` calls `preventDefault()`
   - Parent-side `worker.addEventListener("error", ...)`

   Without round-25's `return`, the `throw new Error("security-workflow")`
   in test 2 would have leaked as a pageerror instead of triggering
   the "Runtime error" status — `expect(page.locator("text=JS run:
   Runtime error")).toBeVisible()` would still pass (the test only
   checks the UI status), but the underlying isolation would have
   been broken. **Confirmed by reading commit b6593b6d.**

3. **LiveSvgBlock wrap-before-sanitize** — round-25 swapped the order
   so DOMPurify's SVG profile sees a valid root.

## How to detect a regression

If any of those three subsystems regresses:

- HTML sanitizer regression → the "sanitized" notice doesn't appear
- LiveJS isolation regression → `throw` leaks to pageerror, but the UI
  status path still works → this test could pass while the bug ships.
  **The pageerror coverage lives in `e2e/error-paths.spec.ts` ("LiveJS
  with throw doesn't propagate up to pageerror") — that's the real
  guard.**
- SVG sanitize-order regression → "Rendered" status flips to "Blocked"

## Conclusion

The hardening spec is a UI-status smoke; the actual security/isolation
properties are pinned by:

- `src/__tests__/markupSanitizer.test.ts` (DOMPurify config)
- `src/__tests__/liveJsIsolation.test.ts` (worker source assertions)
- `e2e/error-paths.spec.ts` ("LiveJS with throw") (pageerror filter)

The hardening spec is necessary but **not sufficient** evidence of
correctness. Don't read it as a security proof.
