/**
 * Plan W7.14, acceptance 3 — in a real browser without Chrome's built-in
 * model, structured output falls through to the next engine with 0 errors.
 *
 * Runs in headless Chromium (the offline runner's browser mode): a real
 * `globalThis` and `navigator`, and no `LanguageModel` on the page (headless
 * Chromium ships without the Prompt API, as Firefox, Safari and mobile do).
 * The built-in engine is the app's own `builtinEngine()` with its default
 * page lookup; only the local engine after it is a stand-in (no Ollama here,
 * and no network). In Node (no `window`) the file skips itself.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { builtinEngine, generateStructured, StructuredOutputError, type StructuredEngine } from "../ai/structured";
import { builtinAvailability, languageModelApi } from "../ai/structured/chromeBuiltin";
import { conformanceInputs, runConformance, SCHEMAS } from "../ai/structured/conformance";

// A real engine's user agent names its version (HeadlessChrome/…, Firefox/…); the Node DOM stand-ins (happy-dom, the shim) do not.
const inBrowser = typeof window !== "undefined" && typeof navigator !== "undefined" && /(?:Chrome|Firefox|Version)\/\d+/.test(navigator.userAgent) && !/happy-?dom|jsdom|HeadlessShim/i.test(navigator.userAgent);
const hasBuiltin = typeof globalThis !== "undefined" && "LanguageModel" in globalThis;

/** A local engine that answers the first enum value / a fixed shape (what a constrained decoder returns). */
function localEngine(): StructuredEngine {
  const fill = (s: Record<string, unknown>): unknown => {
    if (Array.isArray(s.enum)) return s.enum[0];
    const t = Array.isArray(s.type) ? s.type[0] : s.type;
    if (t === "object") return Object.fromEntries(Object.entries((s.properties ?? {}) as Record<string, Record<string, unknown>>).map(([k, v]) => [k, fill(v)]));
    if (t === "array") return [fill((s.items ?? { type: "string" }) as Record<string, unknown>)];
    if (t === "integer" || t === "number") return (s.minimum as number) ?? 1;
    if (t === "boolean") return true;
    if (t === "null") return null;
    return s.pattern ? "2026-03-03" : "מילה";
  };
  return { id: "ollama", onDevice: false, available: async () => true, generate: async (req) => JSON.stringify(fill(req.schema as Record<string, unknown>)) };
}

// skip-reason: needs a real browser page (headless Chromium in the runner's browser mode); Node has no window or navigator to probe | task: W7.14 | until: 2027-05-16
describe.skipIf(!inBrowser || hasBuiltin)("no built-in model in a real browser (W7.14)", () => {
  const errors: unknown[] = [];
  const orig = console.error;
  beforeEach(() => {
    errors.length = 0;
    console.error = (...a: unknown[]) => {
      errors.push(a);
      orig(...a);
    };
  });
  afterEach(() => {
    console.error = orig;
  });

  it("the page has no LanguageModel: the probe says unavailable without throwing", async () => {
    expect(languageModelApi()).toBeNull();
    expect(await builtinAvailability()).toBe("unavailable");
    expect(await builtinEngine().available()).toBe(false);
  });

  it("a short task skips the built-in engine as unavailable and the local engine answers, 0 console errors", async () => {
    const r = await generateStructured<{ category: string }>(
      { prompt: "פגישה עם המנהלת ביום שלישי", schema: SCHEMAS[0]!.schema },
      { engines: [builtinEngine(), localEngine()], task: "short", builtinAllowed: () => true },
    );
    expect(r.engine).toBe("ollama");
    expect(r.skipped).toEqual([{ engine: "builtin", reason: "unavailable" }]);
    expect(typeof r.value.category).toBe("string");
    expect(errors).toEqual([]);
  });

  it("5 schemas × 50 inputs with the built-in engine first: every answer from the next engine, valid, 0 errors", async () => {
    const inputs = conformanceInputs();
    expect(inputs.length).toBe(50);
    const engines = [builtinEngine(), localEngine()];
    let fromLocal = 0;
    for (const s of SCHEMAS)
      for (const input of inputs) {
        const r = await generateStructured({ prompt: `${s.instruction}\n\n${input.text}`, schema: s.schema }, { engines, task: "short", builtinAllowed: () => true });
        if (r.engine === "ollama" && r.skipped[0]?.reason === "unavailable") fromLocal++;
      }
    expect(fromLocal).toBe(SCHEMAS.length * 50);
    const c = await runConformance(localEngine());
    expect(c.total).toBe(SCHEMAS.length * 50);
    expect(c.rate).toBeGreaterThanOrEqual(0.98);
    expect(errors).toEqual([]);
  });

  it("only the built-in engine and nothing else: one StructuredOutputError naming it, not a crash", async () => {
    const e = await generateStructured({ prompt: "p", schema: SCHEMAS[0]!.schema }, { engines: [builtinEngine()], task: "short", builtinAllowed: () => true }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(StructuredOutputError);
    expect((e as StructuredOutputError).skipped).toEqual([{ engine: "builtin", reason: "unavailable" }]);
  });
});
