/**
 * Plan W13.W1 — the shared writing-suggestion engine.
 *
 *  - The contract: a suggestion is checked against the text it was made on
 *    (range, original, kind, confidence, the AI flag).
 *  - Hunks: a suggestion's word-level changes can be accepted one by one.
 *  - Acceptance: 10 accepted suggestions are ONE transaction in either
 *    editor, so one Ctrl+Z restores all of them (proved here by the
 *    transaction count and its inverse; with @codemirror/commands' real
 *    history where the package is installed).
 *  - The static check: no writing agent changes a document or a file —
 *    only the two editor bridges do, on the user's accept — and the check
 *    fails on an agent that writes directly.
 */
import { describe, expect, it } from "vitest";
import { EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Schema } from "@milkdown/prose/model";
import { EditorState as PmState } from "@milkdown/prose/state";
import { hunksOf, makeSuggestion, replacementWith, suggestionDiff, validateSuggestion, type WritingSuggestion } from "../agents/writing/suggestion";
import { applyPlan, planChanges, SuggestionSession } from "../agents/writing/engine";
import { acceptInView, showSuggestions, suggestionsIn } from "../agents/writing/cmBridge";
import { acceptInPm, pmRange, pmSuggestions, pmTextIndex, showPmSuggestions } from "../agents/writing/pmBridge";
import { aiAuthored } from "../editor/aiAuthorship";
import { suggestionsFromIssues } from "../agents/writing/adapters";
import { diskModules, directWritesIn, writingSources, type ModuleLoader } from "./helpers/writingStatic";

const sug = (text: string, from: number, to: number, replacement: string | null, o: Partial<WritingSuggestion> = {}) =>
  makeSuggestion(text, { range: { from, to }, kind: "concision", message: "m", rationale: "r", confidence: 0.7, replacement, agentId: "test", model: "rules", ...o });

/** Ten one-word fixes across a Hebrew and English text. */
function tenFixes(text: string): WritingSuggestion[] {
  const out: WritingSuggestion[] = [];
  const re = /\bvery\b|ממש/g;
  for (const m of text.matchAll(re)) out.push(sug(text, m.index!, m.index! + m[0].length, m[0] === "ממש" ? "מאוד" : "truly", { id: `s${out.length}` }));
  return out;
}
const TEN = "It was very good. זה היה ממש טוב. A very long day. יום ממש ארוך. The very end. סוף ממש. very nice? very! ממש ממש.";

describe("the Suggestion contract (W13.W1)", () => {
  it("a suggestion is checked against its text", () => {
    const text = "Dana wrote the report.";
    const s = sug(text, 5, 10, "drafted");
    expect(s.original).toBe("wrote");
    expect(s.aiAuthored).toBe(false);
    expect(validateSuggestion(s, text)).toEqual([]);
    expect(validateSuggestion({ ...s, original: "write" }, text)).toContain("original: is not the text at the range");
    expect(validateSuggestion({ ...s, range: { from: 5, to: 99 } }, text)).toContain("range: outside the text");
    expect(validateSuggestion({ ...s, confidence: 1.5 }, text)).toContain("confidence: must be 0..1");
    expect(validateSuggestion({ ...s, kind: "nonsense" as never }, text)[0]).toMatch(/kind/);
    // A model's text is AI text, a rule's is not: the flag cannot lie.
    expect(validateSuggestion({ ...s, model: "gemma3:1b" }, text)).toContain("aiAuthored: must be true exactly when a model wrote the replacement");
    expect(() => sug(text, 0, 4, "Dana")).toThrow(/same as the original/);
    expect(sug(text, 0, 4, "Dana R.", { model: "gemma3:1b" }).aiAuthored).toBe(true);
  });

  it("word-level hunks: Hebrew words keep their prefixes, and each hunk can be taken alone", () => {
    const s = { original: "ביצוע של הבדיקה נעשה על ידי הצוות", replacement: "הצוות בדק" };
    expect(hunksOf(suggestionDiff(s)).length).toBeGreaterThan(0);
    const t = { original: "The report was very long and was written by Dana.", replacement: "The report was long and Dana wrote it." };
    const hunks = hunksOf(suggestionDiff(t));
    expect(hunks.length).toBe(2);
    expect(replacementWith(t, new Set([0, 1]))).toBe(t.replacement);
    expect(replacementWith(t, new Set())).toBe(t.original);
    expect(replacementWith(t, new Set([0]))).toBe("The report was long and was written by Dana.");
  });

  it("the plan: a surer overlapping suggestion wins, stale and advice-only ones are skipped, the user's edit is not AI text", () => {
    const text = "one two three four";
    const a = sug(text, 0, 7, "1 2", { id: "a", confidence: 0.5 });
    const b = sug(text, 4, 13, "2 3", { id: "b", confidence: 0.9 });
    const c = sug(text, 14, 18, null, { id: "c" });
    const d = sug(text, 14, 18, "4", { id: "d", model: "m1" });
    const p = planChanges(text, [a, b, c, d], [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d", text: "FOUR" }]);
    expect(p.changes.map((x) => x.id)).toEqual(["b", "d"]);
    expect(p.skipped).toEqual([{ id: "c", reason: "advice" }, { id: "a", reason: "overlap" }]);
    expect(p.changes.find((x) => x.id === "d")!.ai).toBe(false);
    expect(applyPlan(text, p)).toBe("one 2 3 FOUR");
    expect(planChanges("ONE two three four", [a], [{ id: "a" }]).skipped).toEqual([{ id: "a", reason: "stale" }]);
    expect(planChanges(text, [{ ...d, blocked: "numbers added: 4" }], [{ id: "d" }]).skipped[0].reason).toBe("blocked");
    expect(planChanges(text, [d], [{ id: "d" }]).changes[0].ai).toBe(true);
  });

  it("the session keeps one agent's run from wiping another's and counts what the user decided", () => {
    const text = "one two three";
    const s = new SuggestionSession("doc");
    s.setFor("x", [sug(text, 0, 3, "1", { id: "x1", agentId: "x" })]);
    s.setFor("y", [sug(text, 4, 7, "2", { id: "y1", agentId: "y" })]);
    s.setFor("x", [sug(text, 8, 13, "3", { id: "x2", agentId: "x" })]);
    expect(s.all().map((x) => x.id)).toEqual(["y1", "x2"]);
    s.reject(["y1"]);
    s.accepted(["x2"]);
    expect(s.decided).toEqual({ accepted: 1, rejected: 1 });
  });

  it("adapters: the proofreader's and the grammar checker's issues are suggestions too", () => {
    const text = "I has a cat.";
    const out = suggestionsFromIssues(text, [{ offset: 2, length: 3, message: "Agreement", replacements: [{ value: "have" }], rule: { id: "HE_AGREE", category: "GRAMMAR" } }, { offset: 50, length: 2, message: "x", replacements: [] }], { agentId: "proofreader", model: "rules" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "grammar", replacement: "have", original: "has" });
  });
});

describe("accept in the source editor: one transaction, one undo (W13.W1)", () => {
  function setup(doc: string) {
    const trs: Transaction[] = [];
    const view = new EditorView({ state: EditorState.create({ doc, extensions: [EditorView.updateListener.of((u) => trs.push(...u.transactions.filter((t) => t.docChanged)))] }) });
    return { view, trs };
  }

  it("10 accepted suggestions are ONE document transaction; its inverse restores the text", () => {
    const list = tenFixes(TEN);
    expect(list).toHaveLength(10);
    const { view, trs } = setup(TEN);
    showSuggestions(view, list);
    expect(suggestionsIn(view.state)).toHaveLength(10);
    const plan = acceptInView(view, list.map((s) => ({ id: s.id })));
    expect(plan.changes).toHaveLength(10);
    expect(trs).toHaveLength(1);
    const after = view.state.doc.toString();
    expect(after).not.toMatch(/\bvery\b|ממש/);
    expect(trs[0].isUserEvent("input.writing")).toBe(true);
    // What one undo does: the inverse of that one transaction.
    expect(trs[0].changes.invert(trs[0].startState.doc).apply(view.state.doc).toString()).toBe(TEN);
    expect(suggestionsIn(view.state)).toHaveLength(0);
    // Rule fixes are not AI text; a model's are tagged at the insertion.
    expect(trs[0].annotation(aiAuthored)).toBeUndefined();
    view.destroy();
  });

  it("a model's replacements carry the canonical aiAuthored tag", () => {
    const text = "short text here";
    const { view, trs } = setup(text);
    const s = sug(text, 0, 5, "brief", { model: "qwen3:1.7b" });
    showSuggestions(view, [s]);
    acceptInView(view, [{ id: s.id }]);
    expect(trs[0].annotation(aiAuthored)).toBe(true);
    view.destroy();
  });

  it("an edit maps the other suggestions and drops the one whose words changed", () => {
    const text = "alpha beta gamma";
    const { view } = setup(text);
    showSuggestions(view, [sug(text, 0, 5, "A", { id: "a" }), sug(text, 11, 16, "G", { id: "g" })]);
    view.dispatch({ changes: { from: 6, insert: "NEW " } });
    expect(suggestionsIn(view.state).map((s) => [s.id, s.range.from])).toEqual([["a", 0], ["g", 15]]);
    view.dispatch({ changes: { from: 1, to: 2, insert: "L" } });
    expect(suggestionsIn(view.state).map((s) => s.id)).toEqual(["g"]);
    acceptInView(view, [{ id: "g" }]);
    expect(view.state.doc.toString()).toBe("aLpha NEW beta G");
    view.destroy();
  });

  it("per-hunk accept and the user's edit", () => {
    const text = "The report was very long and was written by Dana.";
    const { view } = setup(text);
    const s = sug(text, 0, text.length, "The report was long and Dana wrote it.", { model: "m" });
    showSuggestions(view, [s]);
    acceptInView(view, [{ id: s.id, hunks: new Set([0]) }]);
    expect(view.state.doc.toString()).toBe("The report was long and was written by Dana.");
    view.destroy();
  });

  // skip-reason: @codemirror/commands (history, undo) is not installed in the offline overlay; the real vitest run (Mac / CI) has it | task: W13.W1 | until: 2027-05-17
  it("with the real history: one undo restores all ten (where @codemirror/commands is installed)", async () => {
    let cmds: typeof import("@codemirror/commands") | null = null;
    try {
      cmds = await import("@codemirror/commands");
      if (typeof cmds.history !== "function") cmds = null;
    } catch {
      cmds = null;
    }
    if (!cmds) return void console.log("skip: @codemirror/commands not installed here; the transaction-count proof above stands");
    const { loadHistoryIsolation } = await import("../agents/writing/cmBridge");
    await loadHistoryIsolation();
    const view = new EditorView({ state: EditorState.create({ doc: TEN, extensions: [cmds.history()] }) });
    view.dispatch({ changes: { from: 0, insert: "X" }, userEvent: "input.type" });
    const list = tenFixes(view.state.doc.toString());
    showSuggestions(view, list);
    acceptInView(view, list.map((s) => ({ id: s.id })));
    expect(view.state.doc.toString()).not.toMatch(/\bvery\b|ממש/);
    cmds.undo(view);
    expect(view.state.doc.toString()).toBe(`X${TEN}`);
    view.destroy();
  });
});

describe("accept in the WYSIWYG editor: one transaction (W13.W1)", () => {
  const schema = new Schema({ nodes: { doc: { content: "block+" }, paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] }, text: { group: "inline" } } });
  const docOf = (paras: string[]) => schema.node("doc", null, paras.map((p) => schema.node("paragraph", null, p ? [schema.text(p)] : [])));

  function fakeView(state: PmState) {
    const v = {
      state,
      trs: [] as import("@milkdown/prose/state").Transaction[],
      dispatch(tr: import("@milkdown/prose/state").Transaction) {
        v.trs.push(tr);
        v.state = v.state.apply(tr);
      },
      updateState(s: PmState) {
        v.state = s;
      },
    };
    return v;
  }

  it("the text index maps offsets to positions, and refuses a range across blocks", () => {
    const ix = pmTextIndex(docOf(["שלום עולם", "second"]));
    expect(ix.text).toBe("שלום עולם\n\nsecond");
    expect(pmRange(ix, 0, 4)).toEqual({ from: 1, to: 5 });
    expect(pmRange(ix, 11, 17)).toEqual({ from: 12, to: 18 });
    expect(pmRange(ix, 5, 13)).toBeNull();
  });

  it("10 accepted suggestions are one transaction; inverting its steps restores the document", () => {
    const paras = TEN.split(". ");
    const view = fakeView(PmState.create({ doc: docOf(paras) }));
    const ix = pmTextIndex(view.state.doc);
    const list = tenFixes(ix.text);
    expect(list).toHaveLength(10);
    showPmSuggestions(view as never, list);
    expect(pmSuggestions(view.state)).toHaveLength(10);
    const start = view.state.doc;
    view.trs.length = 0;
    const plan = acceptInPm(view as never, list.map((s) => ({ id: s.id })));
    expect(plan.changes).toHaveLength(10);
    expect(view.trs.filter((t) => t.docChanged)).toHaveLength(1);
    expect(pmTextIndex(view.state.doc).text).not.toMatch(/\bvery\b|ממש/);
    const tr = view.trs[0];
    let doc = tr.doc;
    for (let i = tr.steps.length - 1; i >= 0; i--) doc = tr.steps[i].invert(tr.docs[i]).apply(doc).doc!;
    expect(doc.eq(start)).toBe(true);
    expect(pmSuggestions(view.state)).toHaveLength(0);
  });

  it("a model's replacement is marked with markAiInsert; an edit elsewhere keeps the other suggestions", () => {
    const view = fakeView(PmState.create({ doc: docOf(["alpha beta", "gamma"]) }));
    const text = pmTextIndex(view.state.doc).text;
    showPmSuggestions(view as never, [sug(text, 0, 5, "A", { id: "a", model: "m" }), sug(text, 12, 17, "G", { id: "g" })]);
    view.dispatch(view.state.tr.insertText("Z", 8));
    expect(pmSuggestions(view.state).map((s) => s.id)).toEqual(["a", "g"]);
    acceptInPm(view as never, [{ id: "a" }]);
    expect(view.trs.at(-1)!.getMeta("lumenAiAuthored")).toBe(true);
    expect(pmTextIndex(view.state.doc).text).toBe("A bZeta\n\ngamma");
    expect(pmSuggestions(view.state).map((s) => s.id)).toEqual(["g"]);
  });
});

/* ── The static check: writing agents propose, they never write ────────── */

describe("static: no writing agent writes to a document or a file (W13.W1)", () => {
  const sources = writingSources();

  it("src/agents/writing has the base and at least one agent", () => {
    expect([...sources.keys()].some((f) => f.endsWith("suggestion.ts"))).toBe(true);
  });

  it("every file under src/agents/writing (except the two editor bridges) only proposes", () => {
    expect(directWritesIn(sources, diskModules)).toEqual([]);
  });

  it("an import outside the allow-list passes only when it and all it imports only compute (INT7: one check for W13.W1–W15)", () => {
    const files: Record<string, string> = {
      "lib/pure.ts": 'import { twice } from "./pureToo";\nexport const f = (s: string) => twice(s);',
      "lib/pureToo.ts": "export const twice = (s: string) => s + s;",
      "lib/sneaky.ts": 'import { save } from "./deeper";\nexport const g = (s: string) => save(s);',
      "lib/deeper.ts": 'import { writeWorkspaceFile } from "../storage/workspace";\nexport const save = (s: string) => writeWorkspaceFile("x.md", s);',
      "storage/workspace.ts": "export const writeWorkspaceFile = async (p: string, c: string) => { localStorage.setItem(p, c); };",
      "lib/pkg.ts": 'import { parse } from "yaml";\nexport const h = (s: string) => parse(s);',
    };
    const load: ModuleLoader = (m) => (files[`${m}.ts`] !== undefined ? { file: `${m}.ts`, text: files[`${m}.ts`] } : null);
    const agent = (spec: string) => new Map([["agents/writing/agents/x.ts", `import { f } from "${spec}";\nexport const run = (t: string) => f(t);`]]);
    expect(directWritesIn(agent("../../../lib/pure"), load)).toEqual([]);
    const deep = directWritesIn(agent("../../../lib/sneaky"), load);
    expect(deep).toHaveLength(1);
    expect(deep[0]).toMatch(/imports \.\.\/\.\.\/\.\.\/lib\/sneaky \(lib\/sneaky → lib\/deeper → storage\/workspace\.ts:1 uses localStorage\)/);
    expect(directWritesIn(agent("../../../lib/pkg"), load)[0]).toMatch(/lib\/pkg\.ts:1 imports the package yaml/);
    expect(directWritesIn(agent("../../../lib/missing"), load)[0]).toMatch(/not found/);
    // Without a loader nothing outside the allow-list is accepted (W13.W1's rule).
    expect(directWritesIn(agent("../../../lib/pure"))[0]).toMatch(/not in the allow-list/);
  });

  it("the check fails on an agent that writes directly", () => {
    const bad = new Map([
      [
        "agents/writing/agents/badAgent.ts",
        [
          'import { useAppStore } from "../../../store/useStore";',
          'import { acceptInView } from "../cmBridge";',
          'import { writeTextFile } from "@tauri-apps/plugin-fs";',
          "export async function run(view: any, text: string) {",
          "  view.dispatch({ changes: { from: 0, insert: text } });",
          "  useAppStore.getState().setContent(text);",
          '  await writeTextFile("note.md", text);',
          "}",
        ].join("\n"),
      ],
    ]);
    const found = directWritesIn(bad);
    expect(found.some((f) => f.includes("dispatch"))).toBe(true);
    expect(found.some((f) => f.includes("setContent"))).toBe(true);
    expect(found.some((f) => f.includes("writeTextFile"))).toBe(true);
    expect(found.some((f) => f.includes("store/useStore"))).toBe(true);
    expect(found.some((f) => f.includes("editor bridge"))).toBe(true);
    expect(found.some((f) => f.includes("@tauri-apps/plugin-fs"))).toBe(true);
  });
});
