/**
 * Plan W11.I23 — what a hosted ACP agent is doing, as the user sees it:
 * the agent's `session/update` notifications folded into a short
 * transcript (its message, its thinking, its tool calls with their status,
 * its plan). Pure, so the panel (AcpSessionPanel.tsx) and the tests share it.
 *
 * Everything here is the agent's own text: untrusted. It is kept as plain
 * strings and rendered as text (never Markdown or HTML), capped in length
 * and count so a chatty or hostile agent cannot grow the panel without end.
 */

export type AcpToolStatus = "pending" | "in_progress" | "completed" | "failed";

export type TranscriptEntry =
  | { kind: "message"; text: string }
  | { kind: "thought"; text: string }
  | { kind: "tool"; id: string; title: string; toolKind: string; status: AcpToolStatus }
  | { kind: "plan"; items: Array<{ text: string; status: string }> };

export interface Transcript {
  entries: TranscriptEntry[];
  /** Updates of a kind Lumen does not show (counted, for the log). */
  ignored: number;
}

export const MAX_ENTRIES = 200;
export const MAX_TEXT = 20_000;

export const emptyTranscript = (): Transcript => ({ entries: [], ignored: 0 });

const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.slice(0, max) : "");
const STATUSES: readonly AcpToolStatus[] = ["pending", "in_progress", "completed", "failed"];
const status = (v: unknown, fallback: AcpToolStatus): AcpToolStatus => (STATUSES.includes(v as AcpToolStatus) ? (v as AcpToolStatus) : fallback);

/** The text of an ACP content block (`{ type: "text", text }`); other content types are named, not shown. */
function textOf(content: unknown): string {
  const c = content as { type?: unknown; text?: unknown } | null;
  if (!c || typeof c !== "object") return "";
  if (c.type === "text") return str(c.text, MAX_TEXT);
  return typeof c.type === "string" ? `[${c.type.slice(0, 20)}]` : "";
}

/** One `session/update` folded into the transcript (a new object; the old one is not changed). */
export function applyUpdate(t: Transcript, update: Record<string, unknown>): Transcript {
  const entries = t.entries.slice();
  const last = entries[entries.length - 1];
  const kind = update.sessionUpdate;
  if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
    const k = kind === "agent_message_chunk" ? "message" : "thought";
    const text = textOf(update.content);
    if (!text) return t;
    // Consecutive chunks of the same kind are one paragraph of the agent's reply.
    if (last && last.kind === k) entries[entries.length - 1] = { kind: k, text: (last.text + text).slice(0, MAX_TEXT) };
    else entries.push({ kind: k, text });
  } else if (kind === "tool_call" || kind === "tool_call_update") {
    const id = str(update.toolCallId, 120);
    const i = id ? entries.findIndex((e) => e.kind === "tool" && e.id === id) : -1;
    if (i >= 0) {
      const old = entries[i] as Extract<TranscriptEntry, { kind: "tool" }>;
      entries[i] = { ...old, title: str(update.title) || old.title, status: status(update.status, old.status), toolKind: str(update.kind, 20) || old.toolKind };
    } else entries.push({ kind: "tool", id, title: str(update.title) || "?", toolKind: str(update.kind, 20) || "other", status: status(update.status, "pending") });
  } else if (kind === "plan") {
    const items = (Array.isArray(update.entries) ? update.entries : []).slice(0, 30).map((e) => ({ text: str((e as { content?: unknown })?.content), status: str((e as { status?: unknown })?.status, 20) || "pending" }));
    const at = entries.findIndex((e) => e.kind === "plan");
    // The agent sends its whole plan each time: the newest replaces the old one in place.
    if (at >= 0) entries[at] = { kind: "plan", items };
    else entries.push({ kind: "plan", items });
  } else {
    return { entries: t.entries, ignored: t.ignored + 1 };
  }
  return { entries: entries.slice(-MAX_ENTRIES), ignored: t.ignored };
}

/** The agent's reply so far (its message chunks), for a summary line. */
export const replyText = (t: Transcript): string =>
  t.entries
    .filter((e): e is Extract<TranscriptEntry, { kind: "message" }> => e.kind === "message")
    .map((e) => e.text)
    .join("\n\n");
