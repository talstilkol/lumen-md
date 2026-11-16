/**
 * A voice memo into the note (plan 5.9, W10.E37): the transcript and the
 * memo's frame are the user's own words, the summary is the model's. The
 * memo is written in two steps so that only the summary is marked as AI
 * text: first the memo without a summary (a plain write), then the summary
 * in its place through `writeAiContent`, which tags exactly what it inserted.
 */
import { formatVoiceMemo } from "./transcribe";
import { writeAiContent } from "./aiWrites";

type Doc = { name: string; content: string; workspaceName?: string | null };

export function writeVoiceMemo(getDoc: () => Doc, setContent: (s: string) => void, memo: { transcript: string; summary: string; backend: "cloud" | "local"; date?: Date }): void {
  const date = memo.date ?? new Date();
  const current = getDoc().content;
  const at = current + (current.endsWith("\n") ? "" : "\n") + "\n";
  const plain = at + formatVoiceMemo({ ...memo, summary: "", date });
  // ai-authorship: the transcript and the frame are the user's own words; the summary follows as an AI write
  setContent(plain);
  if (memo.summary) writeAiContent(getDoc(), at + formatVoiceMemo({ ...memo, date }), setContent);
}
