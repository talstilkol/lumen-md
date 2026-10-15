import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo, history } from "@codemirror/commands";

vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));
vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  formatDocumentInView,
  formatCodeBlockInView,
  buildFormatCommands,
  formatShortcutLabel,
} from "../editor/formatCommands";
import { showAiToast } from "../ui/AiToast";

function makeView(doc: string, cursor = 0): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [history()] }),
    parent: document.body,
  });
}

// jsdom has no layout; CodeMirror's scrollIntoView measures Range rects.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
const zeroRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} }) as DOMRect;
Range.prototype.getClientRects ??= emptyRects;
Range.prototype.getBoundingClientRect ??= zeroRect;

beforeEach(() => vi.clearAllMocks());

describe("formatDocumentInView", () => {
  it("formats in a single undoable transaction and keeps the cursor near its token", async () => {
    const src = "#  Title\n\n```js\nconst a={b:1}\n```\n";
    const view = makeView(src, src.indexOf("b:1"));
    const spy = vi.fn();
    const orig = view.dispatch.bind(view);
    view.dispatch = ((...args: Parameters<EditorView["dispatch"]>) => {
      spy();
      return orig(...args);
    }) as EditorView["dispatch"];
    expect(await formatDocumentInView(view)).toBe("formatted");
    expect(spy).toHaveBeenCalledTimes(1);
    const out = view.state.doc.toString();
    expect(out).toBe("# Title\n\n```js\nconst a = { b: 1 };\n```\n");
    expect(out.slice(view.state.selection.main.head)).toMatch(/^\s*b: 1/);
    undo(view);
    expect(view.state.doc.toString()).toBe(src);
    view.destroy();
  });

  it("reports an already-formatted document", async () => {
    const view = makeView("# Title\n");
    expect(await formatDocumentInView(view)).toBe("unchanged");
    expect(showAiToast).toHaveBeenCalledWith("Already formatted", "info");
    view.destroy();
  });
});

describe("formatCodeBlockInView", () => {
  it("formats only the block under the cursor", async () => {
    const src = "a  b\n\n```css\na{color:red}\n```\n";
    const view = makeView(src, src.indexOf("color"));
    expect(await formatCodeBlockInView(view)).toBe("formatted");
    expect(view.state.doc.toString()).toBe("a  b\n\n```css\na {\n  color: red;\n}\n```\n");
    view.destroy();
  });

  it("toasts 'no formatter' for unsupported languages", async () => {
    const src = "```python\nx=1\n```\n";
    const view = makeView(src, 12);
    expect(await formatCodeBlockInView(view)).toBe("noFormatter");
    expect(showAiToast).toHaveBeenCalledWith("No formatter for python", "info");
    expect(view.state.doc.toString()).toBe(src);
    view.destroy();
  });

  it("toasts when the cursor is outside a code block", async () => {
    const view = makeView("plain text", 3);
    expect(await formatCodeBlockInView(view)).toBe("noBlock");
    view.destroy();
  });

  it("reports parse errors without touching the doc", async () => {
    const src = "```js\nconst = = ;\n```\n";
    const view = makeView(src, 8);
    expect(await formatCodeBlockInView(view)).toBe("error");
    expect(view.state.doc.toString()).toBe(src);
    view.destroy();
  });
});

describe("buildFormatCommands", () => {
  it("exposes both commands with the platform shortcut", () => {
    const cmds = buildFormatCommands({ getView: () => null, getContent: () => "", setContent: () => {} }, true);
    expect(cmds.map((c) => c.id)).toEqual(["edit.formatDocument", "edit.formatCodeBlock"]);
    expect(cmds[0].shortcut).toBe("⇧⌥F");
    expect(formatShortcutLabel(false)).toBe("Shift+Alt+F");
  });

  it("formats the store content when no CodeMirror view is mounted", async () => {
    let content = "*  a\n*  b\n";
    const setContent = vi.fn((s: string) => {
      content = s;
    });
    const [doc] = buildFormatCommands({ getView: () => null, getContent: () => content, setContent });
    doc.action();
    await vi.waitFor(() => expect(setContent).toHaveBeenCalled());
    expect(content).toBe("- a\n- b\n");
  });
});
