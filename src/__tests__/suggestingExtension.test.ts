/**
 * Suggesting mode — EditorState integration: the transaction filter,
 * the skip rules (undo/redo, programmatic, remote collab), decorations and
 * accept / reject / navigation commands.
 */
import { describe, it, expect } from "vitest";
import { Annotation, EditorSelection, EditorState } from "@codemirror/state";
import type { TransactionSpec } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import {
  acceptAllSuggestions,
  acceptSuggestionAtCursor,
  buildSuggestionDecorations,
  countSuggestions,
  nextSuggestionCommand,
  prevSuggestionCommand,
  rejectAllSuggestions,
  rejectSuggestionAtCursor,
  setSuggesting,
  suggestingExtension,
  suggestingField,
  suggestingSkip,
} from "../editor/suggestingExtension";
import { parseSuggestions } from "../editor/suggesting";

const remote = Annotation.define<boolean>();

/** Minimal view stand-in: commands only need `state` + `dispatch`. */
class FakeView {
  constructor(public state: EditorState) {}
  dispatch = (...specs: TransactionSpec[]) => {
    this.state = this.state.update(...specs).state;
  };
  /** Type text at the cursor like the DOM input handler would. */
  type(text: string) {
    const { from, to } = this.state.selection.main;
    this.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: "input.type",
    });
  }
  backspace() {
    const { from, to } = this.state.selection.main;
    const a = from === to ? from - 1 : from;
    this.dispatch({
      changes: { from: a, to },
      selection: { anchor: a },
      userEvent: from === to ? "delete.backward" : "delete.selection",
    });
  }
  get doc() {
    return this.state.doc.toString();
  }
  /** Doc with `|` at the main cursor. */
  get shown() {
    const h = this.state.selection.main.head;
    return this.doc.slice(0, h) + "|" + this.doc.slice(h);
  }
}

function make(doc: string, cursor: number, on = true) {
  return new FakeView(
    EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [
        history(),
        EditorState.allowMultipleSelections.of(true),
        suggestingExtension(on),
        suggestingSkip.of((tr) => tr.annotation(remote) === true),
      ],
    }),
  );
}

describe("suggesting filter on EditorState", () => {
  it("wraps typed text and keeps the cursor inside the insertion", () => {
    const v = make("hello world", 5);
    v.type(" big");
    expect(v.shown).toBe("hello{++ big|++} world");
    v.type("!");
    expect(v.shown).toBe("hello{++ big!|++} world");
  });

  it("Backspace marks text deleted instead of removing it", () => {
    const v = make("hello world", 11);
    v.backspace();
    v.backspace();
    expect(v.shown).toBe("hello wor|{--ld--}");
  });

  it("replacing a selection produces a substitution", () => {
    const v = make("hello world", 0);
    v.dispatch({ selection: EditorSelection.single(6, 11) });
    v.type("there");
    expect(v.shown).toBe("hello {~~world~>there|~~}");
  });

  it("does nothing while suggesting mode is off", () => {
    const v = make("hello", 5, false);
    v.type("!");
    expect(v.doc).toBe("hello!");
  });

  it("can be toggled with the setSuggesting effect", () => {
    const v = make("ab", 2, false);
    v.dispatch({ effects: setSuggesting.of(true) });
    expect(v.state.field(suggestingField)).toBe(true);
    v.type("c");
    expect(v.doc).toBe("ab{++c++}");
    v.dispatch({ effects: setSuggesting.of(false), selection: { anchor: v.doc.length } });
    v.type("d");
    expect(v.doc).toBe("ab{++c++}d");
  });

  it("ignores programmatic changes without a user event", () => {
    const v = make("hello", 0);
    v.dispatch({ changes: { from: 0, to: 5, insert: "replaced" } });
    expect(v.doc).toBe("replaced");
  });

  it("ignores remote (collab) transactions", () => {
    const v = make("hello", 0);
    v.dispatch({ changes: { from: 0, insert: "X" }, userEvent: "input.type", annotations: remote.of(true) });
    expect(v.doc).toBe("Xhello");
  });

  it("undo reverts the whole suggestion edit and redo restores it, both untransformed", () => {
    const v = make("hello", 5);
    v.type("!");
    expect(v.doc).toBe("hello{++!++}");
    undo(v);
    expect(v.doc).toBe("hello");
    redo(v);
    expect(v.doc).toBe("hello{++!++}");
  });

  it("edits inside a code block are not tracked", () => {
    const v = make("```\ncode\n```", 6);
    v.type("X");
    expect(v.doc).toBe("```\ncoXde\n```");
  });

  it("handles multiple cursors", () => {
    const v = make("aa bb", 0);
    v.dispatch({
      selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(5)]),
    });
    v.dispatch(
      v.state.changeByRange((r) => ({
        changes: { from: r.from, insert: "!" },
        range: EditorSelection.cursor(r.from + 1),
      })),
      { userEvent: "input.type" },
    );
    expect(v.doc).toBe("aa{++!++} bb{++!++}");
    expect(v.state.selection.ranges.map((r) => r.head)).toEqual([6, 16]);
  });
});

describe("suggestion commands", () => {
  const DOC = "a{++b++}c{--d--}e{~~f~>g~~}h";

  it("accept / reject at cursor", () => {
    const v = make(DOC, 3);
    expect(acceptSuggestionAtCursor(v)).toBe(true);
    expect(v.doc).toBe("abc{--d--}e{~~f~>g~~}h");
    v.dispatch({ selection: { anchor: 5 } });
    expect(rejectSuggestionAtCursor(v)).toBe(true);
    expect(v.doc).toBe("abcde{~~f~>g~~}h");
  });

  it("accept / reject at cursor return false away from suggestions", () => {
    const v = make("plain", 2);
    expect(acceptSuggestionAtCursor(v)).toBe(false);
    expect(rejectSuggestionAtCursor(v)).toBe(false);
  });

  it("accept all / reject all", () => {
    const a = make(DOC, 0);
    acceptAllSuggestions(a);
    expect(a.doc).toBe("abcegh");
    const r = make(DOC, 0);
    rejectAllSuggestions(r);
    expect(r.doc).toBe("acdefh");
  });

  it("accept / reject are not themselves tracked as suggestions", () => {
    const v = make(DOC, 0, true);
    acceptAllSuggestions(v);
    expect(countSuggestions(v.state)).toBe(0);
  });

  it("next / previous select the whole suggestion and wrap", () => {
    const v = make(DOC, 0);
    nextSuggestionCommand(v);
    expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe("{++b++}");
    nextSuggestionCommand(v);
    expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe("{--d--}");
    prevSuggestionCommand(v);
    expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe("{++b++}");
    prevSuggestionCommand(v);
    expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe("{~~f~>g~~}");
  });
});

describe("suggestion decorations", () => {
  it("marks content and dims delimiters", () => {
    const doc = "{++a++}{--b--}{~~c~>d~~}{>>e<<}";
    const set = buildSuggestionDecorations(parseSuggestions(doc));
    const out: Array<[string, string]> = [];
    set.between(0, doc.length, (from, to, deco) => {
      out.push([doc.slice(from, to), String(deco.spec.class)]);
    });
    expect(out).toEqual([
      ["{++", "cm-sugg-delim"],
      ["a", "cm-sugg-ins"],
      ["++}", "cm-sugg-delim"],
      ["{--", "cm-sugg-delim"],
      ["b", "cm-sugg-del"],
      ["--}", "cm-sugg-delim"],
      ["{~~", "cm-sugg-delim"],
      ["c", "cm-sugg-del"],
      ["~>", "cm-sugg-delim"],
      ["d", "cm-sugg-ins"],
      ["~~}", "cm-sugg-delim"],
      ["{>>", "cm-sugg-delim"],
      ["e", "cm-sugg-comment"],
      ["<<}", "cm-sugg-delim"],
    ]);
  });
});
