/**
 * Plan 5.9 / W10.E37 — static check: every place that puts a model's
 * output into a note says so at the insertion, so the AI-text marks cover
 * 100% of AI insertions, not just the paths a unit test drives.
 *
 * In every production file that calls the model (chat, runAgent,
 * summarizeMemo, meetingNotesFrom…), each write into the note is one of:
 *   • an editor transaction that carries `aiAuthored.of(true)` (CodeMirror)
 *     or goes through `markAiInsert(tr)` (ProseMirror);
 *   • a store write through `writeAiContent` (ai/aiWrites.ts), which passes
 *     setContent by reference — never a bare `setContent(…)` call;
 *   • a bare write marked `// ai-authorship: <why>`, for text that is the
 *     user's own (dictated words, a rename the user asked for).
 * A new write of model output without one of those fails here.
 *
 * Review 10, L7: a write is any `dispatch(…)` of something that may change the
 * document: an object with `changes` or a spread, a transaction held in a
 * variable (its initializer is read), `state.update(…)`, a ProseMirror `tr`,
 * or anything the check cannot see into. A function imported from another
 * module whose body writes into a note untagged is a write where it is called.
 * Not followed: dynamic imports, and a writer reached through another file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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

/**
 * The canonical tags that mark a transaction as AI text (review 10, L7: any
 * `aiAuthored` word used to count): `aiAuthored.of(true)` on a CodeMirror
 * transaction (editor/aiAuthorship.ts) and `markAiInsert(tr)` on a ProseMirror
 * one (editor/wysiwygAiAuthorship.ts).
 */
const AI_TAG = /\baiAuthored\.of\(\s*true\s*\)|\bmarkAiInsert\(/;

/** The statement that holds `n` (its leading comments are the note). */
function statementOf(n: ts.Node): ts.Node {
  let s: ts.Node = n;
  while (s.parent && !ts.isBlock(s.parent) && !ts.isSourceFile(s.parent) && !ts.isCaseClause(s.parent)) s = s.parent;
  return s;
}

/** The comment lines just above the statement that holds `n`. */
function leadingNote(n: ts.Node, src: string): string {
  return (ts.getLeadingCommentRanges(src, statementOf(n).getFullStart()) ?? []).map((r) => src.slice(r.pos, r.end)).join("\n");
}

/** The initializer of the nearest `const|let|var name = …` declared before `at` in an enclosing block, or null. */
function initializerOf(name: string, at: ts.Node): ts.Expression | null {
  for (let p: ts.Node | undefined = at.parent; p; p = p.parent) {
    if (!(ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseClause(p))) continue;
    let found: ts.Expression | null = null;
    for (const st of p.statements) {
      if (st.getStart() > at.getStart()) break;
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) found = d.initializer;
    }
    if (found) return found;
  }
  return null;
}

/**
 * The expressions a `dispatch(…)` argument stands for, and whether any of them
 * may change the document (review 10, L7): an object with `changes` or a
 * spread, a transaction held in a variable (its initializer is read), a
 * `state.update(…)`, or anything this check cannot see into.
 */
function changesDoc(e: ts.Expression, seen: ts.Node[] = []): boolean {
  if (seen.length > 8) return true;
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) return changesDoc(e.expression, seen);
  if (ts.isObjectLiteralExpression(e)) return e.properties.some((p) => ts.isSpreadAssignment(p) || (p.name !== undefined && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === "changes"));
  if (ts.isArrayLiteralExpression(e)) return e.elements.some((x) => ts.isSpreadElement(x) || changesDoc(x, seen));
  if (ts.isConditionalExpression(e)) return changesDoc(e.whenTrue, seen) || changesDoc(e.whenFalse, seen);
  if (ts.isIdentifier(e)) {
    const init = initializerOf(e.text, e);
    return init ? changesDoc(init, [...seen, e]) : true;
  }
  if (ts.isCallExpression(e) && nameOf(e.expression) === "update") return e.arguments.some((a) => changesDoc(a, seen));
  return true;
}

/** The text a write's tag may be in: the call, and the initializer of a transaction it dispatches. */
function tagged(w: ts.CallExpression, sf: ts.SourceFile, src: string): boolean {
  if (AI_TAG.test(w.getText(sf)) || /ai-authorship:\s*\S/.test(leadingNote(w, src))) return true;
  const arg = w.arguments[0];
  if (arg && ts.isIdentifier(arg)) {
    const init = initializerOf(arg.text, arg);
    if (init && (AI_TAG.test(init.getText(sf)) || /ai-authorship:\s*\S/.test(leadingNote(init, src)))) return true;
  }
  return false;
}

/** The writes into a note in `sf`: `dispatch(…)` of something that may change the document, and `setContent(…)`. */
function writesIn(sf: ts.SourceFile, extra: ReadonlySet<string> = new Set()): ts.CallExpression[] {
  const writes: ts.CallExpression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const name = nameOf(n.expression);
      if (name === "setContent") writes.push(n);
      else if (name === "dispatch" && n.arguments.length && n.arguments.some((a) => ts.isSpreadElement(a) || changesDoc(a))) writes.push(n);
      else if (ts.isIdentifier(n.expression) && extra.has(n.expression.text)) writes.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return writes;
}

const parse = (file: string, src: string) => ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** Exported functions of a file that write into a note without a tag (a write another module can hand AI text to). */
function exportedWriters(sf: ts.SourceFile, src: string): Set<string> {
  const out = new Set<string>();
  const exported = (n: ts.Node) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const check = (name: string, body: ts.Node) => {
    const found: ts.CallExpression[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const k = nameOf(n.expression);
        if (k === "setContent" || (k === "dispatch" && n.arguments.length && n.arguments.some((a) => ts.isSpreadElement(a) || changesDoc(a)))) found.push(n);
      }
      ts.forEachChild(n, visit);
    };
    visit(body);
    if (found.some((w) => !tagged(w, sf, src))) out.add(name);
  };
  for (const st of sf.statements) {
    if (!exported(st)) continue;
    if (ts.isFunctionDeclaration(st) && st.name && st.body) check(st.name.text, st.body);
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) check(d.name.text, d.initializer);
  }
  return out;
}

/** The file of `sources` an import specifier names, or null (packages and other files). */
function resolveImport(from: string, spec: string, sources: ReadonlyMap<string, string>): string | null {
  if (!spec.startsWith(".")) return null;
  const base = join(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) if (sources.has(c)) return c;
  return null;
}

export function untaggedWrites(): string[] {
  return untaggedWritesIn(new Map(files(ROOT).map((f) => [f, readFileSync(f, "utf8")])));
}

/** The untagged writes in these sources (file path → text), as `file:line call`. */
export function untaggedWritesIn(sources: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  const all = [...sources.keys()];
  const parsed = new Map<string, ts.SourceFile>();
  const sfOf = (f: string) => parsed.get(f) ?? (parsed.set(f, parse(f, sources.get(f)!)), parsed.get(f)!);
  const writersCache = new Map<string, Set<string>>();
  const writersOf = (f: string) => writersCache.get(f) ?? (writersCache.set(f, exportedWriters(sfOf(f), sources.get(f)!)), writersCache.get(f)!);
  for (const file of all) {
    const src = sources.get(file)!;
    if (![...AI_CALLEES].some((c) => src.includes(`${c}(`))) continue;
    const sf = sfOf(file);
    let callsModel = false;
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const name = nameOf(n.expression);
        if (name && AI_CALLEES.has(name)) callsModel = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (!callsModel) continue;
    // Review 10, L7: a function imported from another module that writes into a note is a write here.
    const imported = new Set<string>();
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.importClause?.isTypeOnly) continue;
      const target = resolveImport(file, st.moduleSpecifier.text, sources);
      const named = st.importClause?.namedBindings;
      if (!target || !named || !ts.isNamedImports(named)) continue;
      const w = writersOf(target);
      for (const el of named.elements) if (w.has((el.propertyName ?? el.name).text)) imported.add(el.name.text);
    }
    for (const w of writesIn(sf, imported)) {
      if (tagged(w, sf, src)) continue;
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

  it("sees dispatch(tr), a transaction in a variable, a spread and a write in another module; only the canonical tag counts (review 10, L7)", () => {
    const at = (f: string) => join(ROOT, "zz", f);
    const run = (files: Record<string, string>) => untaggedWritesIn(new Map(Object.entries(files).map(([f, t]) => [at(f), t]))).map((l) => l.replace(/^zz\//, ""));
    const head = 'import { chat } from "../ai/client";\nexport async function go(view: any, state: any) {\n  const text = await chat("x");\n';
    expect(run({ "a.ts": `${head}  const tr = state.update({ changes: { from: 0, insert: text } });\n  view.dispatch(tr);\n}\n` })).toEqual(["a.ts:5 view.dispatch(tr)"]);
    expect(run({ "a.ts": `${head}  const spec = { changes: { from: 0, insert: text } };\n  view.dispatch(spec);\n}\n` })).toEqual(["a.ts:5 view.dispatch(spec)"]);
    expect(run({ "a.ts": `${head}  const spec = { from: 0 };\n  view.dispatch({ ...spec });\n}\n` })).toEqual(["a.ts:5 view.dispatch({ ...spec })"]);
    expect(run({ "a.ts": `${head}  view.dispatch(view.state.tr.insertText(text));\n}\n` })).toEqual(["a.ts:4 view.dispatch(view.state.tr.insertText(text))"]);
    // Not the canonical tag: `aiAuthored.of(false)`, or the word in a comment.
    expect(run({ "a.ts": `${head}  view.dispatch({ changes: { from: 0, insert: text }, annotations: aiAuthored.of(false) });\n}\n` })).toHaveLength(1);
    expect(run({ "a.ts": `${head}  view.dispatch({ changes: { from: 0, insert: text } /* aiAuthored */ });\n}\n` })).toHaveLength(1);
    // Tagged where the transaction is built, or with the ProseMirror tag: fine. Effects only: not a write.
    expect(run({ "a.ts": `${head}  const spec = { changes: { from: 0, insert: text }, annotations: aiAuthored.of(true) };\n  view.dispatch(spec);\n}\n` })).toEqual([]);
    expect(run({ "a.ts": `${head}  view.dispatch(markAiInsert(view.state.tr.insertText(text)));\n}\n` })).toEqual([]);
    expect(run({ "a.ts": `${head}  view.dispatch({ effects: [] });\n}\n` })).toEqual([]);
    // Another module's writer, called with the model's text.
    const writer = "export function put(view: any, s: string) {\n  view.dispatch({ changes: { from: 0, insert: s } });\n}\n";
    expect(run({ "b.ts": writer, "a.ts": `import { put as write } from "./b";\n${head}  write(view, text);\n}\n` })).toEqual(["a.ts:5 write(view, text)"]);
    expect(run({ "b.ts": writer, "a.ts": `import { put } from "./b";\n${head}  // ai-authorship: the user's own words\n  put(view, text);\n}\n` })).toEqual([]);
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
