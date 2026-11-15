/**
 * Plan 5.9 / W10.E37 — AI text that an AI command writes through the store
 * is tagged at the write (writeAiContent), not found by matching recent
 * answers: the source editor marks what the write inserted (100% of it, by
 * a random walk with no answer in the registry to match), the note's saved
 * spans carry it when no source editor is open, and the export footer
 * keeps it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { clearAiOutputs, loadSpans, readAuthorshipFooter, recentAiTexts, withAuthorshipFooter, type Span } from "../ai/authorship";
import { __clearAiWrite, authorshipKey, carrySpans, insertedSpans, noteAiWrite, writeAiContent } from "../ai/aiWrites";
import { aiAuthored, aiSpansField } from "../editor/aiAuthorship";

beforeEach(() => {
  clearAiOutputs();
  __clearAiWrite();
  localStorage.clear();
});

const texts = (doc: string, spans: readonly Span[]) => spans.map(([a, b]) => doc.slice(a, b));

/** The store's sync into the source editor: one change over the whole document. */
const sync = (s: EditorState, next: string) => s.update({ changes: { from: 0, to: s.doc.length, insert: next } }).state;

describe("what a write inserted", () => {
  it("an appended block, links put inside sentences, a whole rewrite", () => {
    const before = "# הערות\n\nפגישה עם דנה על התקציב.";
    const after = `${before}\n\n\`\`\`mermaid\ngraph TD; A-->B\n\`\`\`\n`;
    expect(texts(after, insertedSpans(before, after))).toEqual(["```mermaid\ngraph TD; A-->B\n```"]);
    const linked = "# הערות\n\nפגישה עם [[דנה]] על [[התקציב]].";
    expect(texts(linked, insertedSpans(before, linked))).toEqual(["[[דנה]]", "[[התקציב]]"]);
    const translated = "# Notes\n\nA meeting with Dana about the budget.";
    // Every letter of the rewrite is new (the shared "# ", line breaks and final "." are not).
    const spans = insertedSpans(before, translated);
    const letters = [...translated].map((c, i) => (/\p{L}/u.test(c) ? i : -1)).filter((i) => i >= 0);
    expect(letters.every((i) => spans.some(([a, b]) => a <= i && i < b))).toBe(true);
    expect(insertedSpans(before, before)).toEqual([]);
  });

  it("spans outside the change are carried, spans inside it are dropped", () => {
    expect(carrySpans("aaaXbbb", "aaaYYbbb", [[0, 2], [3, 4], [5, 7]])).toEqual([[0, 2], [6, 8]]);
  });
});

describe("the source editor marks a tagged store write, with no answer to match", () => {
  it("fails without the tag: the same change from the store is not AI text", () => {
    expect(recentAiTexts()).toEqual([]);
    let s = EditorState.create({ doc: "פתיחה.", extensions: [aiSpansField] });
    s = sync(s, "פתיחה.\n\n## Action Items\n\n- לשלוח את הדוח\n");
    expect(s.field(aiSpansField)).toEqual([]);
  });

  it("tagged: exactly what the write inserted; the user's typing inside it cuts that part out", () => {
    let s = EditorState.create({ doc: "פתיחה.", extensions: [aiSpansField] });
    const next = "פתיחה.\n\n## Action Items\n\n- לשלוח את הדוח\n";
    noteAiWrite(next);
    s = sync(s, next);
    expect(texts(s.doc.toString(), s.field(aiSpansField))).toEqual(["## Action Items\n\n- לשלוח את הדוח"]);
    const at = s.doc.toString().indexOf("הדוח");
    s = s.update({ changes: { from: at, insert: "את " }, userEvent: "input.type" }).state;
    expect(texts(s.doc.toString(), s.field(aiSpansField))).toEqual(["## Action Items\n\n- לשלוח את ", "הדוח"]);
  });

  it("a tag is for one text only: a different change is not taken for it", () => {
    let s = EditorState.create({ doc: "a", extensions: [aiSpansField] });
    noteAiWrite("a b");
    s = sync(s, "a c");
    expect(s.field(aiSpansField)).toEqual([]);
  });

  it("100% in a random walk: AI writes through the store, agent edits, user typing and deletions (Hebrew with niqqud, English)", () => {
    // The source editor's tag is the store-write path; the ghost text and agent edits use the annotation.
    // A seeded walk (mulberry32); the words are made up for the test.
    let seed = 0x5eed;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const words = ["שָׁלוֹם", "תקציב", "budget", "meeting", "דוח", "action", "ירושלים", "notes"];
    const pick = () => words[Math.floor(rnd() * words.length)];
    let s = EditorState.create({ doc: "start", extensions: [aiSpansField] });
    let owner: boolean[] = [...s.doc.toString()].map(() => false); // per UTF-16 unit: written by the AI and untouched
    for (let step = 0; step < 300; step++) {
      const doc = s.doc.toString();
      const at = Math.floor(rnd() * (doc.length + 1));
      const r = rnd();
      if (r < 0.35) {
        // An AI command through the store: the agent's text put somewhere in the note.
        const ins = ` ${pick()} ${pick()}`;
        const next = doc.slice(0, at) + ins + doc.slice(at);
        writeAiContent({ name: "walk.md", content: doc }, next, (v) => (s = sync(s, v)));
        // The diff may place an insertion between equal neighbours differently: the truth is what it says was inserted.
        const marked = new Set<number>();
        for (const [a, b] of insertedSpans(doc, next)) for (let i = a; i < b; i++) marked.add(i);
        const shifted = carrySpans(doc, next, owner.flatMap((v, i): Span[] => (v ? [[i, i + 1]] : [])));
        owner = [...next].map(() => false);
        for (const [a] of shifted) owner[a] = true;
        for (const i of marked) owner[i] = true;
      } else if (r < 0.5) {
        // An agent's edit applied in the editor (reviewBridge): the annotation.
        const ins = pick();
        s = s.update({ changes: { from: at, insert: ins }, annotations: aiAuthored.of(true) }).state;
        owner.splice(at, 0, ...[...ins].map(() => true));
      } else if (r < 0.8) {
        const ins = pick();
        s = s.update({ changes: { from: at, insert: ins }, userEvent: "input.type" }).state;
        owner.splice(at, 0, ...[...ins].map(() => false));
      } else if (doc.length > 2) {
        const to = Math.min(doc.length, at + 1 + Math.floor(rnd() * 3));
        s = s.update({ changes: { from: at, to }, userEvent: "delete.backward" }).state;
        owner.splice(at, to - at);
      }
      const want: Span[] = [];
      owner.forEach((v, i) => {
        if (!v) return;
        const last = want[want.length - 1];
        if (last && last[1] === i) want[want.length - 1] = [last[0], i + 1];
        else want.push([i, i + 1]);
      });
      // Whitespace-only runs between AI words may go either way; every AI letter must be marked, nothing else.
      const got = s.field(aiSpansField);
      const inGot = (i: number) => got.some(([a, b]) => a <= i && i < b);
      const docNow = s.doc.toString();
      for (let i = 0; i < docNow.length; i++) if (/\S/.test(docNow[i])) expect(inGot(i), `step ${step}, offset ${i}`).toBe(owner[i]);
    }
  });
});

describe("no source editor open: the saved spans and the export", () => {
  it("writeAiContent records the insertion under the note's key; the export footer carries it", () => {
    const doc = { name: "n.md", workspaceName: "notes/n.md", content: "Intro." };
    let content = doc.content;
    writeAiContent(doc, "Intro.\n\nAI summary of the meeting.\n", (v) => (content = v));
    const spans = loadSpans(authorshipKey(doc), content);
    expect(texts(content, spans)).toEqual(["AI summary of the meeting."]);
    const back = readAuthorshipFooter(withAuthorshipFooter(content, spans));
    expect(back.body).toBe(content);
    expect(texts(back.body, back.spans)).toEqual(["AI summary of the meeting."]);
  });

  it("a second write keeps the first one's marks where the text is unchanged", () => {
    const doc = { name: "n.md", content: "A." };
    let content = doc.content;
    writeAiContent(doc, "A.\n\nfirst answer", (v) => (content = v));
    writeAiContent({ ...doc, content }, `${content}\n\nsecond answer`, (v) => (content = v));
    expect(texts(content, loadSpans(authorshipKey(doc), content))).toEqual(["first answer", "second answer"]);
  });
});
