/**
 * Plan 5.9 / W10.E37 — AI text in the WYSIWYG editor is tagged when it is
 * inserted, not found by matching answers: every range a marked
 * transaction inserts is AI text (100% of them, by a random walk), the
 * user's edits cut theirs out, and the editor's two agent insertions mark
 * their transactions.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorState, TextSelection } from "prosemirror-state";
import { Schema } from "prosemirror-model";
import { EditorView } from "prosemirror-view";
import { aiRanges, aiTexts, markAiInsert, markdownAiSpans, wysiwygAiAuthorshipPlugin } from "../editor/wysiwygAiAuthorship";
import { spansForEmission } from "../editor/wysiwygAiSave";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: {},
  },
});

function stateWith(text: string): EditorState {
  return EditorState.create({ doc: schema.node("doc", null, [schema.node("paragraph", null, text ? [schema.text(text)] : [])]), plugins: [wysiwygAiAuthorshipPlugin()] });
}

describe("marked at insertion", () => {
  it("an agent's insertion is AI text; the same text typed is not", () => {
    let s = stateWith("פתיחה ");
    s = s.apply(markAiInsert(s.tr.insertText("טקסט מהסוכן", 7)));
    expect(aiTexts(s)).toEqual(["טקסט מהסוכן"]);
    let u = stateWith("פתיחה ");
    u = u.apply(u.tr.insertText("טקסט מהסוכן", 7));
    expect(aiTexts(u)).toEqual([]);
  });

  it("streamed chunks join into one range; a rewrite replaces a selection with AI text", () => {
    let s = stateWith("Hello world");
    let at = 7;
    for (const chunk of ["The ", "agent ", "wrote ", "this. "]) {
      s = s.apply(markAiInsert(s.tr.insertText(chunk, at)));
      at += chunk.length;
    }
    expect(aiTexts(s)).toEqual(["The agent wrote this. "]);
    let r = stateWith("rewrite me please");
    r = r.apply(markAiInsert(r.tr.replaceWith(1, 11, schema.text("שוכתב"))));
    expect(aiTexts(r)).toEqual(["שוכתב"]);
    expect(r.doc.textContent).toBe("שוכתב please");
  });

  it("typing inside AI text makes that part the user's; text around it stays AI", () => {
    let s = stateWith("");
    s = s.apply(markAiInsert(s.tr.insertText("abcdefgh", 1)));
    s = s.apply(s.tr.insertText("XY", 5));
    expect(s.doc.textContent).toBe("abcdXYefgh");
    expect(aiTexts(s)).toEqual(["abcd", "efgh"]);
    // Typing over AI text (a replacement) takes the replaced part out too.
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 3)).insertText("Q"));
    expect(aiTexts(s)).toEqual(["cd", "efgh"]);
    // A deletion inside keeps what is left.
    s = s.apply(s.tr.delete(8, 9));
    expect(s.doc.textContent).toBe("QcdXYefh");
    expect(aiTexts(s)).toEqual(["cd", "efh"]);
  });

  it("every AI insertion is marked: a random walk of agent inserts and user edits (seeded)", () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let s = stateWith("start");
    // Ground truth, kept in parallel: which characters of the text are the AI's.
    const owner: boolean[] = Array.from("start", () => false);
    for (let step = 0; step < 400; step++) {
      const len = s.doc.textContent.length;
      const pos = Math.floor(rnd() * (len + 1));
      const word = ["שלום ", "word ", "x", "סוכן", "אָ"][Math.floor(rnd() * 5)];
      const r = rnd();
      if (r < 0.45) {
        s = s.apply(markAiInsert(s.tr.insertText(word, 1 + pos)));
        owner.splice(pos, 0, ...Array.from(word, () => true));
      } else if (r < 0.8) {
        s = s.apply(s.tr.insertText(word, 1 + pos));
        owner.splice(pos, 0, ...Array.from(word, () => false));
      } else if (len > 0) {
        const to = Math.min(len, pos + 1 + Math.floor(rnd() * 3));
        if (to > pos) {
          s = s.apply(s.tr.delete(1 + pos, 1 + to));
          owner.splice(pos, to - pos);
        }
      }
      const marked = Array.from(s.doc.textContent, () => false);
      for (const [a, b] of aiRanges(s)) for (let i = a; i < b; i++) marked[i - 1] = true;
      // Every character an agent inserted and nobody touched is marked; nothing else is.
      expect(marked, `step ${step}`).toEqual(owner);
    }
  });
});

describe("the editor's agent insertions", () => {
  const src = (f: string) => readFileSync(join(__dirname, "..", "editor", f), "utf8");

  it("the plugin is in the WYSIWYG editor, and both agent paths mark their transactions", () => {
    expect(src("WysiwygEditor.tsx")).toMatch(/wysiwygAiAuthorshipPlugin\(\),/);
    // The ghostwriter streams the writer agent's chunks.
    expect(src("wysiwygSlashMenu.ts")).toMatch(/streamAgent\(writerAgent[\s\S]*tr\.insertText\(chunk, endOfText\);[\s\S]*v\.dispatch\(markAiInsert\(tr\)\)/);
    // The tooltip's rewrite.
    expect(src("wysiwygTooltip.ts")).toMatch(/runAgentOrThrow\(rewriterAgent[\s\S]*dispatch\(markAiInsert\(state\.tr\.replaceWith\(from, to, state\.schema\.text\(rewritten\)\)\)\)/);
  });

  it("draws .ai-authored, hidden with the marks toggle", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let s = stateWith("a ");
    s = s.apply(markAiInsert(s.tr.insertText("סוכן", 3)));
    const view = new EditorView(host, { state: s });
    expect(view.dom.querySelector(".ai-authored")?.textContent).toBe("סוכן");
    view.destroy();
    host.remove();
    const css = readFileSync(join(__dirname, "..", "index.css"), "utf8");
    expect(css).toMatch(/html\[data-ai-marks-hidden\] \.milkdown \.ai-authored \{\s*color: inherit;/);
  });
});

describe("the AI ranges as Markdown offsets (saved spans, source view, export)", () => {
  // A test serializer for the test schema (paragraphs as Markdown paragraphs); the app uses Milkdown's.
  const serialize = (doc: EditorState["doc"]) => {
    const out: string[] = [];
    doc.forEach((p) => out.push(p.textContent));
    return out.join("\n\n");
  };

  it("bracketed in a copy, serialized, read back: the spans point at the AI text in the Markdown", () => {
    let s = EditorState.create({ doc: schema.node("doc", null, [schema.node("paragraph", null, [schema.text("כותרת")]), schema.node("paragraph", null, [schema.text("גוף ")])]), plugins: [wysiwygAiAuthorshipPlugin()] });
    const end = s.doc.content.size - 1;
    s = s.apply(markAiInsert(s.tr.insertText("מה שהסוכן כתב", end)));
    const { markdown, spans } = markdownAiSpans(s, serialize);
    expect(markdown).toBe(serialize(s.doc));
    expect(spans.map(([a, b]) => markdown.slice(a, b))).toEqual(["מה שהסוכן כתב"]);
    // The real document is untouched.
    expect(s.doc.textContent).not.toMatch(/[]/);
  });

  it("a serializer that changes the brackets: nothing is claimed", () => {
    let s = stateWith("abc ");
    s = s.apply(markAiInsert(s.tr.insertText("xyz", s.doc.content.size - 1)));
    const lossy = (doc: EditorState["doc"]) => serialize(doc).replace(//g, "");
    expect(markdownAiSpans(s, lossy).spans).toEqual([]);
  });

  it("an emission: the saved spans of the unchanged parts stay, the editor's own are added after the frontmatter", () => {
    const fm = "---\ntitle: x\n---\n";
    const prev = `${fm}old AI text. user`;
    const md = "old AI text. user and new AI";
    const full = fm + md;
    const out = spansForEmission(prev, full, [[fm.length, fm.length + 11]], fm, md, md, [[md.length - 6, md.length]]);
    expect(out.map(([a, b]) => full.slice(a, b))).toEqual(["old AI text", "new AI"]);
  });
});
