/**
 * W13.R13, review 13 L1 / audit r4 A1.7: the gate's registry checked on LIVE roots, not by grepping the
 * source. Each mode that can mount in a unit test is mounted and must put `data-reading-mode="<id>"` on
 * an element in the DOM (the e2e gate finds the mode by that selector); the others are opened by the e2e
 * gate only, and are listed here so a new mode must be put in one list or the other.
 * The grep found RsvpReader's attribute only on its empty state, not its main dialog (A1.1).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { READING_MODES, readingModeSelector } from "../reading/modes";
import { RsvpReader } from "../ui/RsvpReader";
import { ImmersiveReader } from "../ui/ImmersiveReader";
import { CompareView } from "../reading/CompareView";
import { FocusMode } from "../ui/FocusMode";
import { FocusLayerBar } from "../ui/FocusLayerBar";
import { attachNoteSpread } from "../reading/noteSpread";

const MD = "# כותרת\n\nהילד הלך לבית הספר. The boy walked to school.\n\nשורה שנייה של טקסט.";
const live = (id: string) => document.querySelector(readingModeSelector(id));

/** Opened by the e2e gate only (they need the store's vault, a translation or the whole app shell). */
const E2E_ONLY = ["reader", "reading-aids", "page-view", "side-by-side", "daf", "bilingual", "triple", "sidenotes"];

const MOUNT: Record<string, () => void | Promise<void>> = {
  rsvp: () => void render(<RsvpReader content={MD} initialWpm={300} close={() => undefined} />),
  immersive: () => void render(<ImmersiveReader content={MD} profile={{ pos: true, syllables: false, lineFocus: 0 }} close={() => undefined} />),
  compare: () => void render(<CompareView left={{ label: "a", text: "one\ntwo" }} right={{ label: "b", text: "one\nthree" }} onClose={() => undefined} />),
  focus: () => void render(<FocusMode active onExit={() => undefined}><p>x</p></FocusMode>),
  "focus-layer": () => {
    const area = createRef<HTMLDivElement>();
    render(
      <div>
        <div ref={area} className="prose-lumen"><p>א. ב.</p></div>
        <FocusLayerBar area={area} />
      </div>,
    );
  },
  "book-spread": () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="prose-lumen"><p>one</p><p>two</p></div>';
    document.body.append(root);
    attachNoteSpread(root, "ws:a.md");
  },
};

describe("reading modes on live roots (W13.R13 DOM check)", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("every registered mode is either mounted here or opened by the e2e gate", () => {
    const ids = READING_MODES.map((m) => m.id).sort();
    expect([...Object.keys(MOUNT), ...E2E_ONLY].sort()).toEqual(ids);
  });

  for (const id of Object.keys(MOUNT)) {
    it(`${id}: mounted, its root carries data-reading-mode="${id}"`, async () => {
      await MOUNT[id]();
      expect(live(id), id).not.toBeNull();
    });
  }
});

describe("review 13 M8: the book spread leaves Space and Enter to a focused control", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });
  it("Space and Enter on a bar button are not swallowed", () => {
    const host = document.createElement("div");
    const root = document.createElement("div");
    root.innerHTML = `<div class="prose-lumen">${Array.from({ length: 40 }, (_, i) => `<p>paragraph ${i}</p>`).join("")}</div>`;
    host.append(root);
    document.body.append(host);
    attachNoteSpread(root, "ws:m8.md");
    // The bar sits right after the root (the preview's pane).
    const button = host.querySelector<HTMLButtonElement>(".bk-bar button")!;
    expect(button).not.toBeNull();
    const onButton = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    button.dispatchEvent(onButton);
    expect(onButton.defaultPrevented).toBe(false);
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    button.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
  });
});

describe("audit r4 A1.6: the page mode opens book pages and sets the margins", () => {
  it("layout spread asks the preview for book pages; sidenotes follows the profile", async () => {
    const { MODE_DEFS } = await import("../reading/modes");
    const { DEFAULT_PROFILE } = await import("../reading/settings");
    const { BOOK_SPREAD_TOGGLE } = await import("../reading/noteSpreadHook");
    const { sidenotesOn } = await import("../reading/sidenotesSetting");
    let asked = 0;
    const on = () => asked++;
    window.addEventListener(BOOK_SPREAD_TOGGLE, on);
    await MODE_DEFS.find((m) => m.id === "page")!.open({ ...DEFAULT_PROFILE, layout: "spread", sidenotes: true });
    window.removeEventListener(BOOK_SPREAD_TOGGLE, on);
    expect(asked).toBe(1);
    expect(sidenotesOn()).toBe(true);
  });
});

describe("audit r4 A1.6: daf, bilingual and compare read the note's reading profile", () => {
  afterEach(() => cleanup());
  it("the bilingual view takes the profile's size, face and line height (its own when unset)", async () => {
    const { BilingualView } = await import("../ui/BilingualView");
    const side = (lang: string) => ({ lang, dir: (lang === "he" ? "rtl" : "ltr") as "rtl" | "ltr", title: lang, license: null });
    const data = { kind: "machine" as const, title: "t", source: side("he"), target: side("en"), rows: [{ n: 1, label: "א", source: "בראשית", target: "In the beginning", sentences: null }], unmatched: 0 };
    render(<BilingualView data={data} initialMode="columns" />);
    expect((document.querySelector("[data-testid=bilingual-view]") as HTMLElement).style.fontSize).toBe("var(--reading-size, inherit)");
    const src = document.querySelector("[data-testid=bi-src]") as HTMLElement;
    expect(src.style.fontFamily).toBe("var(--reading-font, inherit)");
    expect(src.style.lineHeight).toBe("var(--reading-line-height, 1.75)");
  });

  it("the compare view's text and the daf's linear text use the profile's variables", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(__dirname, "../reading/CompareView.css"), "utf8");
    expect(css).toMatch(/\.cmp-body \{[^}]*font-size: var\(--reading-size, 15px\)[^}]*line-height: var\(--reading-line-height, 1\.7\)/);
    const { readingText } = await import("../reading/profileCore");
    expect(readingText()).toMatchObject({ fontFamily: "var(--reading-font, inherit)", fontSize: "var(--reading-size, inherit)" });
  });
});
