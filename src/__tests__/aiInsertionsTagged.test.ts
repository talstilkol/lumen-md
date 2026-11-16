/**
 * Plan 5.9 / W10.E37 — static check: every place that puts a model's
 * output into a note says so at the insertion, so the AI-text marks cover
 * 100% of AI insertions, not just the paths a unit test drives.
 *
 * In every production file that calls the model (chat, runAgent,
 * summarizeMemo, meetingNotesFrom…), each write into the note is one of:
 *   • an editor transaction with changes that carries `aiAuthored`;
 *   • a store write through `writeAiContent` (ai/aiWrites.ts), which passes
 *     setContent by reference — never a bare `setContent(…)` call;
 *   • a bare write marked `// ai-authorship: <why>`, for text that is the
 *     user's own (dictated words, a rename the user asked for).
 * A new write of model output without one of those fails here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { aiSpansField } from "../editor/aiAuthorship";
import { authorshipKey } from "../ai/aiWrites";
import { clearAiOutputs, loadSpans, type Span } from "../ai/authorship";
import { writeVoiceMemo } from "../ai/voiceMemoWrite";

vi.mock("../ui/AiToast", () => ({ showAiToast: () => {} }));
vi.mock("../agents/defs/claimExtractor", async (orig) => ({
  ...(await orig<object>()),
  extractClaims: async () => ({ selected: [{ n: 1, text: "Dana met the board.", checkable: true }], claims: [{ text: "Dana met the board", provenance: { quote: "Dana met the board." } }], dropped: [] }),
}));

const ROOT = join(__dirname, "..");
/** What calls the model (the same callees aiCallsCarrySignal checks, and the helpers that wrap them). */
const AI_CALLEES = new Set(["chat", "chatStream", "runAgent", "runAgentOrThrow", "streamAgent", "summarizeMemo", "chatLocal", "chatLocalStream", "runLocalRequest", "meetingNotesFrom"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) && !/\.(test|eval)\./.test(f) ? [p] : [];
  });
}

const nameOf = (e: ts.Expression): string | null => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null);

/** The comment lines just above the statement that holds `n`. */
function leadingNote(n: ts.Node, src: string): string {
  let s: ts.Node = n;
  while (s.parent && !ts.isBlock(s.parent) && !ts.isSourceFile(s.parent) && !ts.isCaseClause(s.parent)) s = s.parent;
  return (ts.getLeadingCommentRanges(src, s.getFullStart()) ?? []).map((r) => src.slice(r.pos, r.end)).join("\n");
}

export function untaggedWrites(): string[] {
  const out: string[] = [];
  for (const file of files(ROOT)) {
    const src = readFileSync(file, "utf8");
    if (![...AI_CALLEES].some((c) => src.includes(`${c}(`))) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    let callsModel = false;
    const writes: ts.CallExpression[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const name = nameOf(n.expression);
        if (name && AI_CALLEES.has(name)) callsModel = true;
        if (name === "setContent") writes.push(n);
        if (name === "dispatch") {
          const arg = n.arguments[0];
          if (arg && ts.isObjectLiteralExpression(arg) && arg.properties.some((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "changes")) writes.push(n);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (!callsModel) continue;
    for (const w of writes) {
      if (/\baiAuthored\b/.test(w.getText(sf))) continue;
      if (/ai-authorship:\s*\S/.test(leadingNote(w, src))) continue;
      const { line } = sf.getLineAndCharacterOfPosition(w.getStart(sf));
      out.push(`${relative(ROOT, file)}:${line + 1} ${w.getText(sf).replace(/\s+/g, " ").slice(0, 80)}`);
    }
  }
  return out.sort();
}

describe("AI insertions are tagged where they happen (5.9, W10.E37)", () => {
  it("no file that calls the model writes into a note without saying whether the text is AI-written", () => {
    expect(untaggedWrites()).toEqual([]);
  });

  it("the check sees the files it should (it is not passing on an empty set)", () => {
    const seen = files(ROOT).filter((f) => {
      const src = readFileSync(f, "utf8");
      return [...AI_CALLEES].some((c) => src.includes(`${c}(`));
    });
    const rel = seen.map((f) => relative(ROOT, f));
    for (const f of ["commands/domains/claimsAction.ts", "commands/domains/voiceActions.ts", "ui/VoiceDictation.tsx", "editor/ghostText.ts", "editor/inlineSuggestion.ts"]) expect(rel).toContain(f);
  });
});

const texts = (doc: string, spans: readonly Span[]) => spans.map(([a, b]) => doc.slice(a, b));

describe("the writes the check found, now tagged", () => {
  beforeEach(() => {
    localStorage.clear();
    clearAiOutputs();
  });

  it("AI: Extract claims marks its callout as AI text in the editor", async () => {
    const { claimsFlow } = await import("../commands/domains/claimsAction");
    const content = "Dana met the board.";
    let state = EditorState.create({ doc: content, extensions: [aiSpansField], selection: { anchor: 3 } });
    const view = {
      get state() {
        return state;
      },
      dispatch: (spec: TransactionSpec) => void (state = state.update(spec).state),
    };
    await claimsFlow({ getEditorView: () => view as never, liveDoc: () => ({ name: "n.md", content }) as never });
    const doc = state.doc.toString();
    expect(doc).toContain("[!claims]");
    expect(texts(doc, state.field(aiSpansField)).join("")).toContain("[!claims] Candidate claims (1)");
    expect(texts(doc, state.field(aiSpansField)).join("")).not.toContain("Dana met the board.\n");
  });

  it("a voice memo marks only its summary; the transcript stays the user's", () => {
    let doc = { name: "memo.md", content: "# Notes\n" };
    const set = (s: string) => void (doc = { ...doc, content: s });
    writeVoiceMemo(() => doc, set, { transcript: "we agreed to ship on Sunday", summary: "Ship on Sunday.", backend: "local", date: new Date("2026-11-16T09:00:00Z") });
    expect(doc.content).toContain("Ship on Sunday.");
    expect(doc.content).toContain("we agreed to ship on Sunday");
    // Word-level spans (aiWrites.insertedSpans): exactly the summary's words, none of the transcript's.
    expect(texts(doc.content, loadSpans(authorshipKey(doc), doc.content)).join(" ")).toBe("Ship on Sunday.");
  });

  it("a voice memo without a summary marks nothing", () => {
    let doc = { name: "memo2.md", content: "" };
    writeVoiceMemo(() => doc, (s) => void (doc = { ...doc, content: s }), { transcript: "just words", summary: "", backend: "local" });
    expect(doc.content).toContain("just words");
    expect(loadSpans(authorshipKey(doc), doc.content)).toEqual([]);
  });
});
