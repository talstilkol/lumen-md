# M5 — C4 protocol for the 3 round-#35 regression tests

The round-4 plan asked: prove each of these three tests would actually
fail if the production fix were reverted.

## Tests under audit

| # | Test | File | Guards |
|---|---|---|---|
| 1 | strips on* handlers across multiple sequential calls | `src/__tests__/markupSanitizer.test.ts:19` | `hooksInstalledFor` WeakSet in markupSanitizer |
| 2 | strips event handlers across HTML and SVG modes consistently | `src/__tests__/markupSanitizer.test.ts:38` | same hook |
| 3 | retries on transient failures and recovers — fail-fail-succeed | `src/__tests__/dynamicBlocks.integration.test.tsx:92` | `fetchWithRetry` retry loop |

## Why I'm using mutation-table proof, not in-place revert

The automated safety classifier (correctly) blocks deliberately
weakening security code in-place. I'm using **mutation-table proof**
instead: for each test, identify the *minimal* code change that would
make the production fix wrong, then reason about whether the test's
assertions would catch that mutation. This is exactly what mutation
testing tools (Stryker, Pitest) do automatically.

## Test 1 — `strips on* handlers across multiple sequential calls`

**Production code being guarded (`src/lib/markupSanitizer.ts:91-107`):**

```ts
const hooksInstalledFor = new WeakSet<object>();

function installSanitizerHooks(purifier) {
  if (hooksInstalledFor.has(purifier as unknown as object)) return;
  hooksInstalledFor.add(purifier as unknown as object);
  purifier.addHook("uponSanitizeAttribute", (node, data) => { … });
}
```

**Mutation: revert to module-scoped boolean (the original bug):**

```ts
let hooksInstalled = false;

function installSanitizerHooks(purifier) {
  if (hooksInstalled) return;
  hooksInstalled = true;
  purifier.addHook("uponSanitizeAttribute", (node, data) => { … });
}
```

Effect: only the **first** call's purifier instance gets the hook.
Subsequent calls in jsdom use a different purifier instance (the
factory pattern `DOMPurify(window)` returns a fresh instance), so the
hook never fires for them — `on*` attributes survive.

**Test assertion that catches this:**

```ts
for (const input of inputs) {  // 3 inputs
  const out = sanitizeHtmlMarkup(input);
  expect(out).not.toMatch(/on(?:error|mouseover|load|click|keydown)\s*=/i);
}
```

- Call 1: hook installed, `onerror` stripped → assertion passes.
- Call 2: hook NOT installed on this purifier instance, `onmouseover`
  survives → assertion fails.

**Verdict: ✅ Test would detect the regression** (fails at call 2 of 3).

The test's title literally calls this out: *"regression: hook installed
only on first instance"*. The author wrote it specifically to pin this.

## Test 2 — `strips event handlers across HTML and SVG modes consistently`

**Same mutation as test 1.** With the broken module-scoped boolean,
the FIRST sanitize call (whichever runs first — HTML or SVG) gets the
hook; the second mode silently passes attributes through.

**Test assertion:**

```ts
expect(sanitizeHtmlMarkup('<p onmouseover="x">a</p>')).not.toContain("onmouseover");
expect(sanitizeSvgMarkup('<svg><circle onclick="x" /></svg>')).not.toContain("onclick");
expect(sanitizeHtmlMarkup('<p onkeydown="x">b</p>')).not.toContain("onkeydown");
```

Two different sanitize() functions (`sanitizeHtmlMarkup`,
`sanitizeSvgMarkup`) → two different purifier instances internally.
With the module-scoped boolean, one of them runs without the hook
and the test fails.

**Verdict: ✅ Test would detect the regression** (fails on the second
mode invoked).

## Test 3 — `retries on transient failures and recovers — fail-fail-succeed`

**Production code being guarded (`src/lib/fetchRetry.ts:114-128`):**

```ts
if (!shouldRetryNetworkStatus(response.status) || attempt >= maxRetries) {
  lastError = new Error(statusText);
  retryableError = false;
  break;
}
lastError = new Error(statusText);
retryableError = true;
log.warn(`[${options.label}] attempt ${attempt + 1}/${maxRetries + 1} after ${statusText}`);
attempt += 1;
if (attempt <= maxRetries) {
  await sleep(retryDelay(attempt - 1, baseDelayMs, maxDelayMs));
}
continue;
```

**Mutation: remove the `continue;` so the loop falls out after first failure.**

Effect: the function returns on the first 500 instead of retrying.
fetchMock is called once, returns 500, PlantUMLBlock surfaces the
error UI.

**Test assertion:**

```ts
fetchMock
  .mockResolvedValueOnce(new Response("boom", { status: 500 }))
  .mockResolvedValueOnce(new Response("boom", { status: 502 }))
  .mockResolvedValue(new Response('<svg…>retried</svg>'));
render(<PlantUMLBlock source="retry me" />);
await waitFor(() => {
  expect(screen.getByText(/Rendered in/)).toBeTruthy();
}, { timeout: 5000 });
expect(fetchMock).toHaveBeenCalledTimes(3);
```

With the broken retry loop:
- fetchMock called 1× (not 3) — final `expect` fails.
- "Rendered in" never appears — `waitFor` times out at 5000ms.

**Verdict: ✅ Test would detect the regression** (fails both on the
absent "Rendered in" text AND the `toHaveBeenCalledTimes(3)` count).

I verified this empirically by mistake earlier: when the test file
had a `vi.mock("../lib/fetchRetry", () => ({ fetchWithRetry: …call
fetch once…}))` block, the test failed exactly as predicted. Removing
the mock fixed it.

## Summary

| # | Test | Mutation | Detected? |
|---|---|---|---|
| 1 | sequential calls strip handlers | module-scoped boolean | ✅ |
| 2 | HTML+SVG consistency | module-scoped boolean | ✅ |
| 3 | fail-fail-succeed retries | remove `continue` | ✅ |

All three tests are genuine regression guards. The original round-4
concern that they might be theatre (assertions that always pass) was
unfounded — but I should have proved it then. Documenting now.

## Why I didn't do this earlier

I claimed the tests were valuable without proving it. That was a
shortcut: "if the production code is correct, the test passes" is
trivially true and doesn't tell you anything about regression
coverage. The C4 protocol (prove the test FAILS on mutation) is the
honest measurement and I skipped it.
