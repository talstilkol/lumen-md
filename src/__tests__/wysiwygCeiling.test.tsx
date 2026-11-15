/**
 * W11.Q4 (research R5.6): a note over the WYSIWYG ceiling (300 KB or 5,000
 * blocks) opens in the source editor with a notice; the person can still
 * open it in WYSIWYG, with a warning; a small note is not affected.
 *
 * The layout's decision is the real code (layouts/EditorLayout.tsx,
 * editor/wysiwygCeiling.ts, ui/WysiwygCeilingBanner.tsx). CodeMirror and
 * Milkdown are replaced by small stand-ins that only record that they were
 * mounted and with which text, as in EditorLayout.test.tsx.
 *
 * Text: the large notes are the real Ben-Yehuda fragment (public domain,
 * fixtures/benyehuda) repeated to the size under test — the size is what is
 * tested, not the content; the small note is this repo's own README.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { RefObject } from "react";
import type { EditorHandle } from "../editor/Editor";

const seen = vi.hoisted(() => ({ editor: [] as string[], wysiwyg: [] as string[] }));

vi.mock("../editor/Editor", async () => {
  const { forwardRef } = await import("react");
  return {
    Editor: forwardRef<unknown, { value: string }>(function StandInEditor(props, _ref) {
      seen.editor.push(props.value);
      return <div className="cm-scroller" data-testid="source-editor" />;
    }),
  };
});
vi.mock("../editor/WysiwygEditor", () => ({
  default: (props: { value: string }) => {
    seen.wysiwyg.push(props.value);
    return <div data-testid="wysiwyg-editor" />;
  },
}));
vi.mock("../renderer/Preview", () => ({ Preview: () => <div data-preview-root /> }));
vi.mock("../ui/WritingGoalBanner", () => ({ WritingGoalBanner: () => null }));

import { EditorLayout } from "../layouts/EditorLayout";
import type { ViewMode } from "../store/useStore";
import { countBlocks, resetWysiwygForced, utf8Bytes, wysiwygCeiling, WYSIWYG_MAX_BLOCKS, WYSIWYG_MAX_BYTES } from "../editor/wysiwygCeiling";
import { applyLocale, loadLocale } from "../i18n";

const FRAGMENT = readFileSync("src/__tests__/fixtures/benyehuda/m4387.txt", "utf8");
/** Real Hebrew text repeated to about `bytes` bytes, in paragraphs. */
function hebrewNote(bytes: number): string {
  const para = `${FRAGMENT.trim()}\n\n`;
  return para.repeat(Math.ceil(bytes / utf8Bytes(para)));
}
const SMALL = readFileSync("README.md", "utf8");
const TWO_MB = hebrewNote(2 * 1024 * 1024);

const editorRef = { current: null } as RefObject<EditorHandle | null>;
function layout(mode: ViewMode, docContent: string, activeFile = "big.md") {
  return (
    <EditorLayout
      mode={mode}
      docContent={docContent}
      deferredContent={docContent}
      editorRef={editorRef}
      vimEnabled={false}
      spellCheck={false}
      grammarCheck={false}
      typewriterMode={false}
      activeFile={activeFile}
      pageView={false}
      collab={null}
      setContent={() => {}}
      handleAddAsset={async () => null}
    />
  );
}

beforeEach(() => {
  seen.editor.length = 0;
  seen.wysiwyg.length = 0;
  resetWysiwygForced();
  applyLocale("en");
});
afterEach(() => cleanup());

describe("the WYSIWYG ceiling", () => {
  it("is 300 KB or 5,000 blocks", () => {
    expect(WYSIWYG_MAX_BYTES).toBe(300 * 1024);
    expect(WYSIWYG_MAX_BLOCKS).toBe(5000);
  });

  it("counts UTF-8 bytes like TextEncoder", () => {
    for (const s of ["", "abc", "שלום עולם", "日本語", "emoji 😀 x", FRAGMENT]) expect(utf8Bytes(s)).toBe(new TextEncoder().encode(s).length);
  });

  it("counts blocks: paragraphs, headings, list items, quotes, table rows, a fence as one", () => {
    expect(countBlocks("# H\n\npara one\nstill one\n\n- a\n- b\n> q\n| t |\n\n```\ncode\n\n# not a heading\n```\nafter")).toBe(8);
    expect(countBlocks("")).toBe(0);
  });

  it("passes a 2 MB note on bytes, and a note of 6,000 short paragraphs on blocks", () => {
    expect(wysiwygCeiling(TWO_MB)).toMatchObject({ tooLarge: true, reason: "bytes" });
    expect(wysiwygCeiling(TWO_MB).bytes).toBeGreaterThanOrEqual(2 * 1024 * 1024);
    const manyBlocks = Array.from({ length: 6000 }, (_, i) => `פסקה ${i}`).join("\n\n");
    expect(utf8Bytes(manyBlocks)).toBeLessThan(WYSIWYG_MAX_BYTES);
    expect(wysiwygCeiling(manyBlocks)).toMatchObject({ tooLarge: true, reason: "blocks" });
  });

  it("leaves a small note under it", () => {
    expect(wysiwygCeiling(SMALL)).toMatchObject({ tooLarge: false, reason: null });
  });
});

describe("EditorLayout with the ceiling (W11.Q4)", () => {
  it("opens a 2 MB note in the source editor with a notice, not in WYSIWYG", async () => {
    render(layout("wysiwyg", TWO_MB));
    expect(await screen.findByTestId("source-editor")).toBeTruthy();
    expect(screen.queryByTestId("wysiwyg-editor")).toBeNull();
    expect(seen.wysiwyg).toHaveLength(0);
    const notice = screen.getByTestId("wysiwyg-ceiling-notice");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toMatch(/This note is large \(2,0\d\d KB\), so it opened in Source view/);
  });

  it("opens it in WYSIWYG anyway when asked, with a warning, and goes back", async () => {
    const { rerender } = render(layout("wysiwyg", TWO_MB));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open in WYSIWYG anyway" })));
    expect(await screen.findByTestId("wysiwyg-editor")).toBeTruthy();
    expect(screen.getByTestId("wysiwyg-ceiling-warning").textContent).toMatch(/over the WYSIWYG size limit/);
    expect(screen.queryByTestId("wysiwyg-ceiling-notice")).toBeNull();
    // The choice holds for this note while it is edited.
    rerender(layout("wysiwyg", `${TWO_MB}x`));
    expect(screen.getByTestId("wysiwyg-editor")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Back to Source view" })));
    expect(await screen.findByTestId("source-editor")).toBeTruthy();
    expect(screen.queryByTestId("wysiwyg-editor")).toBeNull();
  });

  it("does not touch a small note", async () => {
    render(layout("wysiwyg", SMALL, "README.md"));
    expect(await screen.findByTestId("wysiwyg-editor")).toBeTruthy();
    expect(screen.queryByTestId("source-editor")).toBeNull();
    expect(screen.queryByTestId("wysiwyg-ceiling-notice")).toBeNull();
    expect(screen.queryByTestId("wysiwyg-ceiling-warning")).toBeNull();
  });

  it("does not touch source and split views of a large note", () => {
    render(layout("source", TWO_MB));
    expect(screen.queryByTestId("wysiwyg-ceiling-notice")).toBeNull();
    cleanup();
    render(layout("split", TWO_MB));
    expect(screen.queryByTestId("wysiwyg-ceiling-notice")).toBeNull();
  });

  it("decides when the note opens, not while it grows: a small note typed past the ceiling stays in WYSIWYG", async () => {
    const { rerender } = render(layout("wysiwyg", SMALL, "grow.md"));
    expect(await screen.findByTestId("wysiwyg-editor")).toBeTruthy();
    rerender(layout("wysiwyg", TWO_MB, "grow.md"));
    expect(screen.getByTestId("wysiwyg-editor")).toBeTruthy();
    expect(screen.queryByTestId("wysiwyg-ceiling-notice")).toBeNull();
    // Opening another large note decides again.
    rerender(layout("wysiwyg", TWO_MB, "other-big.md"));
    expect(screen.getByTestId("wysiwyg-ceiling-notice")).toBeTruthy();
  });

  it("decides again once a note that opened empty has loaded", () => {
    const { rerender } = render(layout("wysiwyg", "", "late.md"));
    rerender(layout("wysiwyg", TWO_MB, "late.md"));
    expect(screen.getByTestId("wysiwyg-ceiling-notice")).toBeTruthy();
  });

  it("says it in Hebrew", async () => {
    await loadLocale("he");
    applyLocale("he");
    render(layout("wysiwyg", TWO_MB));
    expect(screen.getByTestId("wysiwyg-ceiling-notice").textContent).toMatch(/הפתק הזה גדול/);
    expect(screen.getByRole("button", { name: "לפתוח ב-WYSIWYG בכל זאת" })).toBeTruthy();
  });
});
