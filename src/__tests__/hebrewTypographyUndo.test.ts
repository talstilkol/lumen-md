/**
 * W2.9 acceptance "Ctrl+Z gives back the original character at once", in a
 * real editor: a CodeMirror view with the editor's own history, history
 * keymap and typography extension (Editor.tsx), mounted in the document.
 * Ctrl+Z is a keydown on the content element that the keymap handles.
 *
 * In a real browser the text goes in through execCommand("insertText");
 * jsdom has no editing commands, so there each character is the transaction
 * CodeMirror's input handler makes for a keystroke (userEvent "input.type").
 * Either way the history, the keymap and the extension are the real ones;
 * e2e/hebrew-typography.spec.ts is the same check through the whole app with
 * Playwright's keyboard.
 */
import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { hebrewTypographyExtension } from "../editor/hebrewTypographyExtension";

const realInput = typeof document.execCommand === "function" && !/happy-dom|jsdom/i.test(navigator.userAgent);
const views: EditorView[] = [];

function mount(): EditorView {
  try {
    localStorage.removeItem("lumen-hebrew-typography");
  } catch {
    /* no storage: the defaults apply */
  }
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: "", extensions: [history(), hebrewTypographyExtension(), keymap.of([...defaultKeymap, ...historyKeymap])] }),
  });
  views.push(view);
  view.focus();
  return view;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function settle(): Promise<void> {
  // The fix is dispatched on the next task (dispatching inside an update is not allowed), and the DOM observer flushes on its own.
  for (let i = 0; i < 4; i++) await tick();
}

/** One character at a time, as a keystroke puts it in. */
async function type(view: EditorView, text: string): Promise<void> {
  for (const ch of text) {
    view.focus();
    if (realInput) {
      document.execCommand("insertText", false, ch);
      view.observer.flush();
    } else {
      const at = view.state.selection.main.head;
      view.dispatch({ changes: { from: at, insert: ch }, selection: { anchor: at + ch.length }, userEvent: "input.type", scrollIntoView: true });
    }
    await settle();
  }
}

function ctrlZ(view: EditorView): boolean {
  const ev = new KeyboardEvent("keydown", { key: "z", code: "KeyZ", keyCode: 90, ctrlKey: true, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(ev);
  return ev.defaultPrevented;
}

afterEach(() => {
  for (const v of views.splice(0)) {
    v.dom.parentElement?.remove();
    v.destroy();
  }
});

describe("Hebrew typography in a real editor: Ctrl+Z (W2.9)", () => {
  it('typing צה"ל gives צה״ל; one Ctrl+Z gives back the " and nothing else', async () => {
    const view = mount();
    await type(view, 'צה"ל');
    expect(view.state.doc.toString()).toBe("צה״ל");
    expect(ctrlZ(view)).toBe(true);
    await settle();
    expect(view.state.doc.toString()).toBe('צה"ל');
    expect(view.state.selection.main.head).toBe(4);
  });

  it("typing on after the undo does not redo the fix", async () => {
    const view = mount();
    await type(view, 'צה"ל');
    ctrlZ(view);
    await settle();
    await type(view, " הוא");
    expect(view.state.doc.toString()).toBe('צה"ל הוא');
  });

  it("ג'ירפה: the geresh fix is one undo step of its own", async () => {
    const view = mount();
    await type(view, "ג'");
    expect(view.state.doc.toString()).toBe("ג׳");
    ctrlZ(view);
    await settle();
    expect(view.state.doc.toString()).toBe("ג'");
    // The rest of the word goes on after the ' as typed.
    await type(view, "ירפה");
    expect(view.state.doc.toString()).toBe("ג'ירפה");
  });

  it("code typed in backticks is left as typed, so there is nothing to undo there", async () => {
    const view = mount();
    await type(view, '`צה"ל` ');
    expect(view.state.doc.toString()).toBe('`צה"ל` ');
  });
});
