/**
 * W11.I23 — the hosted agent's session/update notifications folded into the
 * transcript the live panel shows (agents/acp/transcript.ts).
 */
import { describe, expect, it } from "vitest";
import { applyUpdate, emptyTranscript, MAX_ENTRIES, MAX_TEXT, replyText, type Transcript } from "../agents/acp/transcript";

const fold = (updates: Record<string, unknown>[]): Transcript => updates.reduce(applyUpdate, emptyTranscript());
const chunk = (text: string, kind = "agent_message_chunk") => ({ sessionUpdate: kind, content: { type: "text", text } });

describe("ACP transcript", () => {
  it("consecutive message chunks are one paragraph; a thought between them starts a new one", () => {
    const t = fold([chunk("של"), chunk("ום"), chunk("checking", "agent_thought_chunk"), chunk("done")]);
    expect(t.entries).toEqual([
      { kind: "message", text: "שלום" },
      { kind: "thought", text: "checking" },
      { kind: "message", text: "done" },
    ]);
    expect(replyText(t)).toBe("שלום\n\ndone");
  });

  it("a tool call is one entry whose status and title follow its updates", () => {
    const t = fold([
      { sessionUpdate: "tool_call", toolCallId: "c1", title: "Read todo.md", kind: "read", status: "pending" },
      { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "in_progress" },
      { sessionUpdate: "tool_call", toolCallId: "c2", title: "Edit a.md", kind: "edit" },
      { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed", title: "Read todo.md (3 lines)" },
      { sessionUpdate: "tool_call_update", toolCallId: "c2", status: "bogus" },
    ]);
    expect(t.entries).toEqual([
      { kind: "tool", id: "c1", title: "Read todo.md (3 lines)", toolKind: "read", status: "completed" },
      { kind: "tool", id: "c2", title: "Edit a.md", toolKind: "edit", status: "pending" },
    ]);
  });

  it("the newest plan replaces the old one in place", () => {
    const t = fold([
      { sessionUpdate: "plan", entries: [{ content: "read", status: "pending" }] },
      chunk("x"),
      { sessionUpdate: "plan", entries: [{ content: "read", status: "completed" }, { content: "write", status: "in_progress" }] },
    ]);
    expect(t.entries[0]).toEqual({ kind: "plan", items: [{ text: "read", status: "completed" }, { text: "write", status: "in_progress" }] });
    expect(t.entries).toHaveLength(2);
  });

  it("unknown updates are counted, not shown; non-text content is named, not rendered", () => {
    const t = fold([{ sessionUpdate: "available_commands_update" }, { sessionUpdate: "agent_message_chunk", content: { type: "image", data: "AAAA" } }, { foo: 1 }]);
    expect(t.ignored).toBe(2);
    expect(t.entries).toEqual([{ kind: "message", text: "[image]" }]);
  });

  it("a flood is capped: text length and number of entries", () => {
    let t = fold([chunk("a".repeat(MAX_TEXT)), chunk("b".repeat(100))]);
    expect((t.entries[0] as { text: string }).text.length).toBe(MAX_TEXT);
    t = emptyTranscript();
    for (let i = 0; i < MAX_ENTRIES + 50; i++) t = applyUpdate(t, { sessionUpdate: "tool_call", toolCallId: `t${i}`, title: `t${i}` });
    expect(t.entries).toHaveLength(MAX_ENTRIES);
    expect((t.entries[0] as { id: string }).id).toBe("t50");
  });

  it("does not change the transcript it was given", () => {
    const a = fold([chunk("x")]);
    const b = applyUpdate(a, chunk("y"));
    expect(a.entries).toEqual([{ kind: "message", text: "x" }]);
    expect(b.entries).toEqual([{ kind: "message", text: "xy" }]);
  });
});
