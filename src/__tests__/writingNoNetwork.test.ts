/**
 * Plan W13.W1 — the writing agents use no network.
 *
 *  - Static: no file under src/agents/writing names a network API (fetch,
 *    XMLHttpRequest, WebSocket, EventSource, sendBeacon, a worker, an
 *    http(s) URL in a string) or imports the cloud chat module; the check
 *    fails on a file that does.
 *  - The model door: a writing agent's runtime definition offers no tools
 *    and only this device's executors (never the cloud "chat" executor).
 *  - Running: with fetch, XMLHttpRequest, WebSocket, EventSource and
 *    sendBeacon replaced by traps that throw, every registered writing
 *    agent runs on Hebrew and English text (with a fake local model) and
 *    returns valid suggestions — and no trap fired.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writingAgents } from "../agents/writing/agent";
import "../agents/writing/agents";
import { LOCAL_EXECUTORS, writingDefinition, type LocalModel } from "../agents/writing/model";
import { validateSuggestion } from "../agents/writing/suggestion";
import { networkUsesIn, writingSources } from "./helpers/writingStatic";

describe("static: no network from src/agents/writing (W13.W1)", () => {
  it("no file names a network API or a network module", () => {
    const sources = writingSources();
    expect(sources.size).toBeGreaterThan(5);
    expect(networkUsesIn(sources)).toEqual([]);
  });

  it("an import outside the allow-list is reported, a listed pure helper is not (review 13 H1)", () => {
    const agent = (spec: string) => new Map([["agents/writing/agents/x.ts", `import { f } from "${spec}";\nexport const run = (t: string) => f(t);`]]);
    expect(networkUsesIn(agent("../../../lib/leaky"))).toEqual(["agents/writing/agents/x.ts:1 imports ../../../lib/leaky (not in the allow-list)"]);
    expect(networkUsesIn(agent("../../../text/outlineCore"))).toEqual([]);
  });

  it("the check fails on an agent that fetches", () => {
    const bad = new Map([
      ["agents/writing/agents/leaky.ts", 'import { chat } from "../../../ai/llm";\nexport const run = async (t: string) => (await fetch("https://api.example.com/x", { method: "POST", body: t })).text();\nnavigator.sendBeacon("/log", t);'],
    ]);
    const found = networkUsesIn(bad);
    expect(found.some((f) => f.endsWith(" fetch"))).toBe(true);
    expect(found.some((f) => f.includes("URL https://api.example.com"))).toBe(true);
    expect(found.some((f) => f.includes("imports ../../../ai/llm"))).toBe(true);
    expect(found.some((f) => f.includes("navigator"))).toBe(true);
  });
});

describe("the model door: local executors, no tools (W13.W1)", () => {
  it("a writing agent's runtime definition offers no tools and never the cloud executor", () => {
    const def = writingDefinition("styleCoach", { system: "s", user: "u" });
    expect(def.tools).toEqual([]);
    expect(def.executorPreference).toEqual([...LOCAL_EXECUTORS]);
    expect(def.executorPreference).not.toContain("chat");
    expect(def.maxSteps).toBe(1);
  });
});

describe("running every writing agent with the network trapped (W13.W1)", () => {
  const fired: string[] = [];
  const trap = (name: string) =>
    function trapped() {
      fired.push(name);
      throw new Error(`network: ${name} called from a writing agent`);
    };
  beforeEach(() => {
    fired.length = 0;
    vi.stubGlobal("fetch", trap("fetch"));
    vi.stubGlobal("XMLHttpRequest", trap("XMLHttpRequest"));
    vi.stubGlobal("WebSocket", trap("WebSocket"));
    vi.stubGlobal("EventSource", trap("EventSource"));
    if (typeof navigator !== "undefined") vi.stubGlobal("navigator", { ...navigator, sendBeacon: trap("sendBeacon") });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** A local model stand-in: answers by the prompt's shape, keeps the text's facts. */
  const fake: LocalModel = async (req, signal) => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const text = req.user.split(/\n(?:Text|Bullets):\n/).pop() ?? "";
    if (/rank writing-style findings/.test(req.system)) return { text: JSON.stringify({ scores: Array(40).fill(0.9) }), model: "fake-local" };
    if (/"versions"/.test(req.system)) return { text: JSON.stringify({ versions: [text.replace(/\bvery\b/g, "truly"), `${text} `, text.toUpperCase()] }), model: "fake-local" };
    if (/Bullets/.test(req.user)) return { text: text.replace(/^- /gm, "").replace(/\n/g, ". "), model: "fake-local" };
    return { text: text.split(/\s+/).slice(0, Math.ceil(text.split(/\s+/).length * 0.7)).join(" "), model: "fake-local" };
  };
  const SAMPLES = {
    en: "Basically, the report was written by Dana in order to explain the end result of 12 tests. We made a decision to revert back. It is very good.",
    he: "ביצוע של הבדיקה נעשה על ידי הצוות באופן מיידי. הם חזרו שוב למשרד על מנת לבדוק 12 תיקים. כאילו, זה ממש טוב.",
  } as const;

  it("there are writing agents to run", () => {
    expect(writingAgents().map((a) => a.id)).toEqual(expect.arrayContaining(["styleCoach", "toneShifter", "concision"]));
  });

  for (const lang of ["en", "he"] as const) {
    it(`every agent on ${lang} text: valid suggestions, no network call`, async () => {
      for (const a of writingAgents()) {
        for (const options of a.id === "concision" ? [{ mode: "shorten" }, { mode: "expand" }] : [{ tone: "formal" }]) {
          const text = a.id === "concision" && options.mode === "expand" ? `- ${SAMPLES[lang].split(". ").join("\n- ")}` : SAMPLES[lang];
          const out = await a.run({ text, lang, level: "professional", signal: new AbortController().signal, model: fake, options });
          for (const s of out) expect(validateSuggestion(s, text)).toEqual([]);
          if (a.id === "styleCoach") expect(out.length).toBeGreaterThan(2);
        }
      }
      expect(fired).toEqual([]);
    });
  }

  it("an aborted run stops and still calls nothing", async () => {
    const c = new AbortController();
    c.abort();
    for (const a of writingAgents()) await expect(a.run({ text: SAMPLES.en, lang: "en", level: "everyday", signal: c.signal, model: fake })).rejects.toThrow();
    expect(fired).toEqual([]);
  });
});
