/**
 * 1.4 / T55 — the cancel signal reaches the model calls that the static
 * check (aiCallsCarrySignal.test.ts) found without one on verify/train-7
 * (W10.Z3 re-review): the names finder behind cloud redaction, the law
 * answer and its critic, and relation extraction. The static check only
 * sees a `signal` in the call; this checks the caller's signal is the one
 * that arrives, and that an abort stops the work instead of degrading it.
 */
import { describe, expect, it } from "vitest";
import type { Executor, ExecutorRequest } from "../agents/types";
import { findPii, PiiVault, redactText, type NerFn } from "../ai/pii";
import { ollamaNamesFinder } from "../ai/piiNer";
import { answerLawQuestion, type LawChat } from "../sources/knesset/answer";
import type { LawAnswer } from "../sources/knesset/store";
import { entityId, type Entity } from "../entities/model";
import { extractRelations } from "../entities/relations";

describe("the names finder behind redaction", () => {
  it("findPii and redactText hand the caller's signal to the NER", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const ner: NerFn = async (_text, signal) => {
      seen.push(signal);
      return [];
    };
    const c = new AbortController();
    await findPii("Dana wrote this", { ner, signal: c.signal });
    await redactText("Dana wrote this", new PiiVault(), { ner, signal: c.signal });
    expect(seen).toEqual([c.signal, c.signal]);
  });

  it("an aborted request stops; a model that merely fails still falls back to patterns", async () => {
    const c = new AbortController();
    c.abort(new DOMException("Cancelled by the user", "AbortError"));
    const aborting: NerFn = async () => {
      throw new DOMException("Cancelled by the user", "AbortError");
    };
    await expect(findPii("mail me at dana@example.com", { ner: aborting, signal: c.signal })).rejects.toThrow(/Cancelled/);
    const broken: NerFn = async () => {
      throw new Error("model crashed");
    };
    const spans = await findPii("mail me at dana@example.com", { ner: broken, signal: new AbortController().signal });
    expect(spans.map((s) => s.type)).toContain("EMAIL");
  });

  it("the Ollama name finder passes the signal to its model call", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const finder = ollamaNamesFinder(async (_text, signal) => {
      seen.push(signal);
      return [];
    });
    const c = new AbortController();
    await finder("Dana", c.signal);
    expect(seen).toEqual([c.signal]);
  });
});

describe("the law answer and its critic", () => {
  const quote = { kind: "quote", law: { law: { name: "חוק לדוגמה" } }, section: { number: "3", text: "המועד הוא 30 ימים." }, score: 1, markdown: "", quoteInLaw: true } as unknown as LawAnswer;

  it("both model calls get the operation's signal", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const chat: LawChat = async (messages, signal) => {
      seen.push(signal);
      return messages[0]!.content.startsWith("You check") ? "SUPPORTED" : "המועד הוא 30 ימים.";
    };
    const c = new AbortController();
    const r = await answerLawQuestion("מה המועד?", quote, chat, c.signal);
    expect(r?.verified).toBe(true);
    expect(seen).toEqual([c.signal, c.signal]);
  });
});

describe("relation extraction", () => {
  it("the executor's request carries opts.signal", async () => {
    const calls: ExecutorRequest[] = [];
    const ex = {
      id: "ollama",
      label: "ollama",
      available: async () => ({ available: true }),
      chat: async (req: ExecutorRequest) => {
        calls.push(req);
        return { content: '{"relations":[]}', toolCalls: [], model: "scripted-1" };
      },
      supportsTools: () => false,
      supportsSchema: () => true,
      modelFor: () => "scripted-1",
    } as unknown as Executor;
    const E = (type: Entity["type"], name: string): Entity => ({ id: entityId(type, name), type, name, aliases: [] });
    const c = new AbortController();
    await extractRelations({ note: "a.md", anchor: "a1", text: "דוד כהן נולד בחיפה.", entities: [E("person", "דוד כהן"), E("place", "חיפה")] }, ex, { signal: c.signal });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.signal).toBe(c.signal);
  });
});
