/**
 * Plan W10.C21: structured output (W7.14) wired into tag suggestions, date
 * detection and inbox triage. The engines are stand-ins (the plan's "fake
 * engine"): what is under test is the request, the schema check, the
 * fallback order and what the features do with the answer. The inbox lines
 * are synthetic.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { StructuredOutputError, type StructuredEngine, type StructuredRequest } from "../ai/structured";
import { GATE_KEY } from "../ai/structured/gate";
import { suggestTagsLocal, TAGS_SCHEMA } from "../tags/suggest";
import { checkDue, inboxEntries, triagedEntry, triageEntry, triageInbox, type TriageResult } from "../capture/triage";
import { suggestTags } from "../agents/commands";

/** An engine that answers with `answer(req)`; records the requests it got. */
function fake(id: StructuredEngine["id"], answer: (req: StructuredRequest) => string, available = true): StructuredEngine & { seen: StructuredRequest[] } {
  const seen: StructuredRequest[] = [];
  return { id, onDevice: true, seen, available: async () => available, generate: async (req) => (seen.push(req), answer(req)) };
}

const open = () => true;

describe("tag suggestions through generateStructured", () => {
  it("asks with the tags schema and the workspace's vocabulary, and normalises the answer", async () => {
    const e = fake("ollama", () => '{"tags": ["#Machine Learning", "מחקר", "מחקר"]}');
    const r = await suggestTagsLocal("# הערות על למידת מכונה", ["מחקר", "ml"], { engines: [e], builtinAllowed: open });
    expect(r).toEqual({ tags: ["machine-learning", "מחקר"], engine: "ollama" });
    expect(e.seen[0].schema).toBe(TAGS_SCHEMA);
    expect(e.seen[0].prompt).toContain("Tags already in use: מחקר, ml");
    expect(e.seen[0].system).toContain("(Hebrew)");
  });

  it("a short task: the built-in model first when its gate is open, then the next engine when it fails the schema", async () => {
    const builtin = fake("builtin", () => "not json");
    const ollama = fake("ollama", () => '{"tags": ["notes"]}');
    const r = await suggestTagsLocal("text", [], { engines: [ollama, builtin], builtinAllowed: open });
    expect(r.engine).toBe("ollama");
    expect(builtin.seen).toHaveLength(2); // the answer and one retry with the errors
    const closed = fake("builtin", () => '{"tags": ["x1"]}');
    expect((await suggestTagsLocal("text", [], { engines: [closed, ollama], builtinAllowed: () => false })).engine).toBe("ollama");
    expect(closed.seen).toHaveLength(0);
  });

  it("no local engine: StructuredOutputError, so the caller falls back to the agent", async () => {
    await expect(suggestTagsLocal("text", [], { engines: [fake("ollama", () => "", false)], builtinAllowed: open })).rejects.toBeInstanceOf(StructuredOutputError);
  });

  describe("suggestTags (the auto-tag command) takes the local answer first", () => {
    const g = globalThis as { LanguageModel?: unknown };
    afterEach(() => {
      delete g.LanguageModel;
      localStorage.removeItem(GATE_KEY);
    });

    it("with Chrome's built-in model on the device and its gate passed, no agent run is needed", async () => {
      const prompts: Array<{ input: string; constraint: unknown }> = [];
      g.LanguageModel = {
        availability: async () => "available",
        create: async () => ({ prompt: async (input: string, o?: { responseConstraint?: unknown }) => (prompts.push({ input, constraint: o?.responseConstraint }), '{"tags": ["garden", "spring"]}') }),
      };
      localStorage.setItem(GATE_KEY, JSON.stringify({ builtinScore: 0.95, localScore: 1, localModel: "test", chromeVersion: "", at: "2026-11-15" }));
      expect(await suggestTags("Notes on the spring garden")).toEqual(["garden", "spring"]);
      expect(prompts).toHaveLength(1);
      expect(prompts[0].constraint).toEqual(TAGS_SCHEMA);
    });
  });
});

describe("date detection", () => {
  it("keeps a real day near today, drops an invented or malformed one", () => {
    expect(checkDue("2026-11-17", "2026-11-15")).toBe("2026-11-17");
    expect(checkDue("2026-02-30", "2026-11-15")).toBeNull();
    expect(checkDue("2031-01-01", "2026-11-15")).toBeNull();
    expect(checkDue("17/11/2026", "2026-11-15")).toBeNull();
    expect(checkDue(null, "2026-11-15")).toBeNull();
  });

  it("the prompt carries today's weekday so relative days resolve; the answer's date is checked", async () => {
    const e = fake("builtin", () => '{"kind":"task","due":"2026-02-30","tags":["משפחה"]}');
    const r = await triageEntry("להתקשר לסבתא מחר", "2026-11-15", { engines: [e], builtinAllowed: open });
    expect(e.seen[0].prompt).toContain("Today is Sunday, 2026-11-15.");
    expect(r).toEqual({ kind: "task", due: null, tags: ["משפחה"], engine: "builtin" });
  });
});

const INBOX = [
  "# תיבת הנכנסים",
  "",
  "- [[Daily/2026-11-15]] 09:30 להתקשר לסבתא מחר",
  "- [[Daily/2026-11-15]] 09:41 https://example.org/article קריאה לסוף השבוע",
  "  שורת המשך נשארת",
  "- [[Daily/2026-11-15]] 10:02 [ ] משימה שכבר ממוינת 📅 2026-11-20",
  "- [[Daily/2026-11-15]] 10:05 רעיון לפרויקט #רעיונות",
  "",
  "פסקה חופשית שאינה רשומה",
  "",
].join("\n");

describe("inbox triage", () => {
  it("reads the capture entries with their continuation lines", () => {
    const es = inboxEntries(INBOX);
    expect(es.map((e) => [e.start, e.end, e.text])).toEqual([
      [2, 3, "להתקשר לסבתא מחר"],
      [3, 5, "https://example.org/article קריאה לסוף השבוע"],
      [5, 6, "[ ] משימה שכבר ממוינת 📅 2026-11-20"],
      [6, 7, "רעיון לפרויקט #רעיונות"],
    ]);
  });

  it("a task gets a checkbox and its due date; tags go at the end", () => {
    const [e] = inboxEntries(INBOX);
    const r: TriageResult = { kind: "task", due: "2026-11-16", tags: ["משפחה"] };
    expect(triagedEntry(e, r)).toBe("- [[Daily/2026-11-15]] 09:30 [ ] להתקשר לסבתא מחר 📅 2026-11-16 #משפחה");
    const ref = inboxEntries(INBOX)[1];
    expect(triagedEntry(ref, { kind: "reference", due: null, tags: ["קריאה"] })).toBe("- [[Daily/2026-11-15]] 09:41 https://example.org/article קריאה לסוף השבוע #קריאה\n  שורת המשך נשארת");
  });

  it("rewrites only the untriaged entries; everything else stays byte for byte", async () => {
    const answers: Record<string, string> = {
      "להתקשר לסבתא מחר": '{"kind":"task","due":"2026-11-16","tags":["משפחה"]}',
      "https://example.org/article קריאה לסוף השבוע": '{"kind":"reference","due":null,"tags":["קריאה"]}',
    };
    const e = fake("ollama", (req) => answers[/Line: (.*)$/.exec(req.prompt)![1]] ?? "{}");
    const r = await triageInbox(INBOX, "2026-11-15", { engines: [e], builtinAllowed: open });
    expect(r).toMatchObject({ changed: 2, skipped: 2, failed: 0, engines: ["ollama"] });
    const lines = r.after.split("\n");
    expect(lines[2]).toBe("- [[Daily/2026-11-15]] 09:30 [ ] להתקשר לסבתא מחר 📅 2026-11-16 #משפחה");
    expect(lines.slice(4)).toEqual(INBOX.split("\n").slice(4));
    expect(e.seen).toHaveLength(2);
  });

  it("with no local model at all it says so instead of failing entry by entry", async () => {
    await expect(triageInbox(INBOX, "2026-11-15", { engines: [fake("ollama", () => "", false), fake("webllm", () => "", false)], builtinAllowed: open })).rejects.toBeInstanceOf(StructuredOutputError);
  });
});

describe("acceptance: src/ai/structured is imported outside its folder", () => {
  it("by the tag suggestions and the inbox triage (not only by tests)", () => {
    const src = join(__dirname, "..");
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) {
          if (n !== "__tests__" && n !== "structured") walk(p);
        } else if (/\.tsx?$/.test(n) && /from "[./]*\/?ai\/structured"|from "\.\.\/ai\/structured"/.test(readFileSync(p, "utf8"))) users.push(relative(src, p));
      }
    };
    walk(src);
    expect(users.sort()).toEqual(expect.arrayContaining(["capture/triage.ts", "capture/triageActions.ts", "tags/suggest.ts"]));
  });
});
