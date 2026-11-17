/**
 * Plan W13.R5 — the immersive reader's view: colours, a word's translation
 * (lexicon first, the on-device model only when asked), syllables and
 * labels, keyboard, 0 network requests and the note unchanged.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { immersiveParagraphs, lexiconTranslation } from "../reading/immersive";
import { ImmersiveReader } from "../ui/ImmersiveReader";

describe("the reader", () => {
  const MD = "---\ntitle: x\n---\n# שיעור\n\nהילד הקטן הלך לבית הספר.\n\nThe little boy walked to school.";
  let calls: string[];
  const realFetch = globalThis.fetch;
  const realOpen = XMLHttpRequest.prototype.open;
  beforeEach(() => {
    cleanup();
    calls = [];
    globalThis.fetch = ((u: unknown) => {
      calls.push(String(u));
      return Promise.reject(new Error("no network"));
    }) as typeof fetch;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, _m: string, u: string | URL) {
      calls.push(String(u));
      throw new Error("no network");
    } as typeof XMLHttpRequest.prototype.open;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    XMLHttpRequest.prototype.open = realOpen;
  });

  it("colours words by part of speech, opens a word with its lexicon translation — 0 requests, the note unchanged", async () => {
    const before = createHash("sha256").update(MD).digest("hex");
    render(<ImmersiveReader content={MD} profile={{ pos: true, syllables: false, lineFocus: 1 }} close={() => undefined} />);
    const page = screen.getByTestId("immersive-page");
    const word = (w: string) => page.querySelector<HTMLElement>(`[data-w="${w}"]`)!;
    expect(word("הלך").dataset.pos).toBe("verb");
    expect(word("הקטן").dataset.pos).toBe("adj");
    expect(word("walked").dataset.pos).toBe("verb");
    expect(word("הלך").style.color).not.toBe("");
    // The title and frontmatter are not read as words; the heading is.
    expect(page.querySelector('[data-w="title"]')).toBeNull();
    fireEvent.click(word("הספר"));
    await waitFor(() => expect(screen.getByTestId("immersive-gloss").textContent).toMatch(/book/));
    // Nouns off: their colour goes, the others stay.
    fireEvent.click(screen.getByTestId("immersive-pos-noun"));
    expect(word("הספר").style.color).toBe("");
    expect(word("הלך").style.color).not.toBe("");
    // Syllables and labels are display only.
    fireEvent.click(screen.getByTestId("immersive-syllables"));
    expect(word("little").textContent).toBe("lit·tle");
    fireEvent.click(screen.getByTestId("immersive-labels"));
    expect(page.querySelectorAll("rt").length).toBeGreaterThan(3);
    expect(calls).toEqual([]);
    expect(createHash("sha256").update(MD).digest("hex")).toBe(before);
  });

  it("a word the lexicon lacks offers the on-device translation, which runs only when asked", async () => {
    const asked: string[] = [];
    render(<ImmersiveReader content={"Gardens grow."} profile={{ pos: true, syllables: false, lineFocus: 0 }} close={() => undefined} translate={async (w) => (asked.push(w), "גינות")} />);
    fireEvent.click(screen.getByTestId("immersive-page").querySelector('[data-w="Gardens"]')!);
    const btn = await screen.findByTestId("immersive-translate");
    expect(asked).toEqual([]);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId("immersive-gloss").textContent).toBe("גינות"));
    expect(asked).toEqual(["Gardens"]);
  });

  it("keyboard: arrows move along the words in the text's direction, Enter opens one", async () => {
    render(<ImmersiveReader content={"שלום עולם יפה"} profile={{ pos: true, syllables: false, lineFocus: 0 }} close={() => undefined} />);
    const page = screen.getByTestId("immersive-page");
    fireEvent.keyDown(page, { key: "ArrowLeft" });
    fireEvent.keyDown(page, { key: "Enter" });
    expect(await screen.findByTestId("immersive-word")).toBeTruthy();
    expect(screen.getByTestId("immersive-word").textContent).toContain("עולם");
  });

  it("paragraphs and lexicon lookups need no network", async () => {
    expect(immersiveParagraphs("one\n\n```\ncode\n```\n\ntwo").length).toBe(2);
    expect(await lexiconTranslation("ובספר")).toContain("book");
    expect(calls).toEqual([]);
  });
});
