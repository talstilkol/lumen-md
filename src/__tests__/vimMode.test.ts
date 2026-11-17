/**
 * W13.E1 — Vim mode: motions that read Hebrew right, :w / :q, Esc cancels
 * running AI first, and the package stays out of the startup chunk.
 *
 * 30 motion tests (12 of them on Hebrew or mixed lines) run on the pure
 * motions (editor/vimMotions.ts) that vimMode.ts maps onto h / l / w / b / e.
 * The test against @replit/codemirror-vim itself needs the package (the Mac):
 * here it is skipped with that reason.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { clusterStart, lineIsRtl, linesOf, motionLeft, motionRight, wordBackward, wordEnd, wordForward } from "../editor/vimMotions";
import { aiEscapeGuard, defineLumenVim, VIM_EX } from "../editor/vimMode";
import { __resetAiAbort, aiOperation, installAiEscape } from "../ai/aiAbort";

const at = (line: string, marker = "|") => ({ line: line.replace(marker, ""), ch: line.indexOf(marker) });
const show = (line: string, ch: number) => line.slice(0, ch) + "|" + line.slice(ch);

describe("h / l — visual in an RTL line, logical in an LTR one", () => {
  const cases: Array<[name: string, before: string, motion: "h" | "l", count: number, after: string]> = [
    ["LTR h", "hel|lo", "h", 1, "he|llo"],
    ["LTR l", "hel|lo", "l", 1, "hell|o"],
    ["LTR h stops at 0", "|hello", "h", 1, "|hello"],
    ["LTR l stops on the last char", "hell|o", "l", 1, "hell|o"],
    ["LTR 3l", "|hello", "l", 3, "hel|lo"],
    ["RTL h goes forward in the text (visually left)", "של|ום", "h", 1, "שלו|ם"],
    ["RTL l goes back in the text (visually right)", "של|ום", "l", 1, "ש|לום"],
    ["RTL h stops on the last letter (the leftmost)", "שלו|ם", "h", 1, "שלו|ם"],
    ["RTL l stops on the first letter (the rightmost)", "|שלום", "l", 1, "|שלום"],
    ["RTL 2h over niqqud: a pointed letter is one cell", "|שָׁלוֹם", "h", 2, "שָׁל|וֹם"],
    ["RTL l never lands on a mark", "שָׁל|וֹם", "l", 1, "שָׁ|לוֹם"],
    ["a Hebrew list line is RTL despite the marker", "- של|ום", "h", 1, "- שלו|ם"],
    ["an English line with a Hebrew word stays LTR", "see של|ום", "h", 1, "see ש|לום"],
  ];
  it.each(cases)("%s", (_n, before, motion, count, after) => {
    const { line, ch } = at(before);
    const got = motion === "h" ? motionLeft(line, ch, count) : motionRight(line, ch, count);
    expect(show(line, got)).toBe(after);
  });
});

describe("w / b / e — logical in every line", () => {
  type W = [name: string, text: string, motion: "w" | "b" | "e", count: number, expected: string];
  const cases: W[] = [
    ["w to the next word", "|one two", "w", 1, "one |two"],
    ["w over punctuation as its own word", "|one, two", "w", 1, "one|, two"],
    ["2w", "|a b c", "w", 2, "a b |c"],
    ["w across a line end", "on|e\ntwo", "w", 1, "one\n|two"],
    ["w stops on an empty line", "on|e\n\ntwo", "w", 1, "one\n|\ntwo"],
    ["b to the word's start", "one tw|o", "b", 1, "one |two"],
    ["b to the previous word", "one |two", "b", 1, "|one two"],
    ["e to the word's end", "|one two", "e", 1, "on|e two"],
    ["e to the next end", "on|e two", "e", 1, "one tw|o"],
    ["Hebrew w in reading order", "|שלום עולם", "w", 1, "שלום |עולם"],
    ["Hebrew w over niqqud", "|שָׁלוֹם עוֹלָם", "w", 1, "שָׁלוֹם |עוֹלָם"],
    ["Hebrew e lands on the last letter, not its mark", "|שָׁלוֹם עוֹלָם", "e", 1, "שָׁלוֹ|ם עוֹלָם"],
    ["gershayim stay inside the word", "|צה״ל קם", "w", 1, "צה״ל |קם"],
    ["Hebrew b", "שלום עו|לם", "b", 1, "שלום |עולם"],
    ["mixed line: w crosses scripts in reading order", "|Lumen עורך markdown", "w", 2, "Lumen עורך |markdown"],
    ["maqaf is punctuation between two words", "|בית־ספר", "w", 1, "בית|־ספר"],
    ["2e on Arabic with tashkeel", "|مُحَمَّد رَسُول", "e", 2, "مُحَمَّد رَسُو|ل"],
  ];
  it.each(cases)("%s", (_n, text, motion, count, expected) => {
    const flat = text.replace("|", "");
    const doc = linesOf(flat);
    const before = text.slice(0, text.indexOf("|")).split("\n");
    const from = { line: before.length - 1, ch: before[before.length - 1].length };
    const fn = motion === "w" ? wordForward : motion === "b" ? wordBackward : wordEnd;
    const p = fn(doc, from, count);
    const lines = flat.split("\n");
    lines[p.line] = show(lines[p.line], p.ch);
    expect(lines.join("\n")).toBe(expected);
  });

  it("the cursor never sits on a combining mark", () => {
    const line = "בְּרֵאשִׁית";
    for (let ch = 0; ch <= line.length; ch++) expect(/\p{M}/u.test(line[clusterStart(line, ch)] ?? "")).toBe(false);
  });

  it("detects the line direction from its first strong character, Markdown syntax aside", () => {
    expect(lineIsRtl("## כותרת")).toBe(true);
    expect(lineIsRtl("> - [ ] משימה")).toBe(true);
    expect(lineIsRtl("Hello שלום")).toBe(false);
  });
});

describe("the package wiring", () => {
  it("maps h l w b e to Lumen's motions and defines :w :q :wq :x", () => {
    const motions = new Map<string, (...a: never[]) => { line: number; ch: number }>();
    const maps: string[] = [];
    const ex: string[] = [];
    defineLumenVim({
      defineMotion: (n, fn) => void motions.set(n, fn as never),
      mapCommand: (k, _t, name) => void maps.push(`${k}→${name}`),
      defineEx: (n, p) => void ex.push(`${n}/${p}`),
    });
    expect(maps).toEqual(expect.arrayContaining(["h→lumenLeft", "l→lumenRight", "w→lumenWordForward", "b→lumenWordBackward", "e→lumenWordEnd"]));
    expect(ex).toEqual(["write/w", "quit/q", "wq/wq", "xit/x"]);
    // A motion through the package's cm interface: h in a Hebrew line goes forward in the text.
    const cm = { getLine: () => "שלום", lineCount: () => 1 };
    expect((motions.get("lumenLeft") as unknown as (...a: unknown[]) => { ch: number })(cm, { line: 0, ch: 1 }, { repeat: 1 }).ch).toBe(2);
    // cw changes to the word's end, as in Vim.
    const cm2 = { getLine: () => "one two", lineCount: () => 1 };
    expect((motions.get("lumenWordForward") as unknown as (...a: unknown[]) => { ch: number })(cm2, { line: 0, ch: 0 }, { repeat: 1 }, {}, { operator: "change" }).ch).toBe(3);
  });

  it(":w runs file.save, :q asks App to close the tab", () => {
    const seen: string[] = [];
    const on = (e: Event) => seen.push(e.type === "lumen-run-command" ? (e as CustomEvent).detail.id : e.type);
    window.addEventListener("lumen-run-command", on);
    window.addEventListener("lumen-vim-quit", on);
    VIM_EX.write();
    VIM_EX.quit();
    window.removeEventListener("lumen-run-command", on);
    window.removeEventListener("lumen-vim-quit", on);
    expect(seen).toEqual(["file.save", "lumen-vim-quit"]);
  });
});

describe("Esc: running AI first, then Vim", () => {
  beforeEach(() => __resetAiAbort());

  function editorWithFakeVim() {
    const vimEsc = vi.fn(() => true);
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    // The guard comes before Vim, as loadVimMode() puts it; the fake stands where Vim's own keydown handler is.
    const view = new EditorView({ state: EditorState.create({ doc: "שלום", extensions: [aiEscapeGuard(), EditorView.domEventHandlers({ keydown: (e) => (e.key === "Escape" ? vimEsc() : false) })] }), parent });
    return { view, vimEsc };
  }

  it("with an AI request running, Esc cancels it and Vim never sees the key (insert mode stays)", () => {
    installAiEscape(() => {});
    const op = aiOperation();
    const { view, vimEsc } = editorWithFakeVim();
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(op.signal.aborted).toBe(true);
    expect(vimEsc).not.toHaveBeenCalled();
    view.destroy();
  });

  it("with nothing running, Esc reaches Vim", () => {
    const { view, vimEsc } = editorWithFakeVim();
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(vimEsc).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it("the second Esc, after the cancel, goes to Vim", () => {
    installAiEscape(() => {});
    aiOperation();
    const { view, vimEsc } = editorWithFakeVim();
    const press = () => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    press();
    press();
    expect(vimEsc).toHaveBeenCalledTimes(1);
    view.destroy();
  });
});

describe("the startup chunk does not grow: Vim loads only when switched on", () => {
  const SRC = join(__dirname, "..");
  const files = (d: string, out: string[] = []): string[] => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (n === "__tests__") continue;
      if (statSync(p).isDirectory()) files(p, out);
      else if (/\.(ts|tsx)$/.test(n)) out.push(p);
    }
    return out;
  };
  it("no module imports @replit/codemirror-vim or vimMode statically", () => {
    const bad: string[] = [];
    for (const f of files(SRC)) {
      const s = readFileSync(f, "utf8");
      if (/^\s*import[^(]*from\s+["']@replit\/codemirror-vim["']/m.test(s)) bad.push(relative(SRC, f));
      if (/^\s*import[^(]*from\s+["']\.\.?\/(editor\/)?vimMode["']/m.test(s)) bad.push(relative(SRC, f));
    }
    expect(bad).toEqual([]);
    expect(readFileSync(join(SRC, "editor/Editor.tsx"), "utf8")).toMatch(/import\("\.\/vimMode"\)/);
  });
});

// Installed or not (an offline stand-in module may answer the import, so ask the disk).
const pkg = existsSync(join(__dirname, "../../node_modules/@replit/codemirror-vim/package.json"));
describe("@replit/codemirror-vim itself", () => {
  (pkg ? it : it.skip)(
    pkg ? "loads with Lumen's motions" : "loads with Lumen's motions — skipped: @replit/codemirror-vim is not installed offline (the Mac installs it, W10.M2)",
    async () => {
      const { loadVimMode } = await import("../editor/vimMode");
      expect(await loadVimMode()).toBeTruthy();
    },
  );
});
