/**
 * Plan W12.H6: side-by-side translation, aligned by paragraph.
 *
 *  - The sidecar `<note>.<lang>.md` keeps a hash of each source paragraph:
 *    an edited paragraph shows "out of date" and only it is sent again.
 *  - Where Chrome's Translator API is missing (phones), the next layer is
 *    chosen and the view says so. The Chrome layer here is the real one with
 *    no API present; the Opus-MT layer is a stand-in, because its converted
 *    model can't be downloaded here (the model files are owed to the Mac).
 *  - The eval card for the three layers on FLORES-200 (numbers from the Mac,
 *    W12.M3): the card's shape and FLORES's file layout. The lines below are
 *    SYNTHETIC, hand-written, not FLORES (which is gated and never committed).
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { align, paragraphsOf, parseSidecar, serializeSidecar, sidecarPath, updateSidecar, viaLocalLayers } from "../ai/mt/sideBySide";
import { createChromeLayer } from "../ai/mt/chromeTranslator";
import type { MtLayer } from "../ai/mt/layers";
import { SideBySideTranslation } from "../ui/SideBySideTranslation";
// @ts-expect-error -- plain .mjs script without types
import { CARD_LAYERS, evalCard, floresItems } from "../../scripts/golden/evals/mt-flores-card.mjs";
// @ts-expect-error -- plain .mjs script without types
import { chrF } from "../../scripts/golden/evals/mt.mjs";

afterEach(cleanup);

const NOTE = ["---", "tags: [שיעור]", "---", "# בראשית", "", "בראשית ברא אלהים את השמים ואת הארץ.", "", "```js", "const x = 1;", "", "```", "", "והארץ היתה תהו ובהו."].join("\n");
/** A stand-in translator: tags each paragraph, and counts what it was sent. */
const tagger = (sent: string[], layer = "opus") => async (texts: string[]) => {
  sent.push(...texts);
  return { texts: texts.map((x) => `EN(${x.slice(0, 12)})`), layer };
};

describe("paragraphs and the sidecar", () => {
  it("paragraphs skip the frontmatter and keep a code fence whole; the sidecar is next to the note", () => {
    expect(paragraphsOf(NOTE).map((p) => p.text)).toEqual(["# בראשית", "בראשית ברא אלהים את השמים ואת הארץ.", "```js\nconst x = 1;\n\n```", "והארץ היתה תהו ובהו."]);
    expect(sidecarPath("notes/שיעור.md", "en")).toBe("notes/שיעור.en.md");
  });

  it("translates once, keeps hashes; after an edit only the changed paragraph is out of date and sent again", async () => {
    const sent: string[] = [];
    const first = await updateSidecar("notes/a.md", NOTE, null, "en", tagger(sent));
    expect(first.translated).toBe(4);
    const md = serializeSidecar(first.sidecar);
    expect(md).toMatch(/^---\ntranslation-of: notes\/a\.md\nlang: en\nlayer: opus\n---\n<!-- src:[0-9a-f]{8} -->\n/);
    expect(parseSidecar(md)).toEqual(first.sidecar);
    expect(align(NOTE, parseSidecar(md)).map((r) => r.state)).toEqual(["ok", "ok", "ok", "ok"]);

    const edited = NOTE.replace("תהו ובהו", "תוהו ובוהו");
    const rows = align(edited, parseSidecar(md));
    expect(rows.map((r) => r.state)).toEqual(["ok", "ok", "ok", "stale"]);
    expect(rows[3].translation).toMatch(/^EN\(/);
    sent.length = 0;
    const second = await updateSidecar("notes/a.md", edited, parseSidecar(md), "en", tagger(sent));
    expect(sent).toEqual(["והארץ היתה תוהו ובוהו."]);
    expect(align(edited, second.sidecar).map((r) => r.state)).toEqual(["ok", "ok", "ok", "ok"]);
    // A new paragraph is missing, not stale.
    expect(align(edited + "\n\nפסקה חדשה.", second.sidecar).at(-1)?.state).toBe("missing");
  });
});

describe("no Translator API (mobile): the next layer, and the view says so", () => {
  it("the real Chrome layer without its API is skipped; Opus-MT translates and is named", async () => {
    const opusStandIn: MtLayer = {
      id: "opus",
      supports: () => true,
      availability: async () => ({ state: "ready" }),
      prepare: async () => true,
      translate: async (texts) => texts.map((x) => `[opus] ${x}`),
    };
    const consent = { confirm: async () => false, t: (k: string) => k };
    const tr = viaLocalLayers({ source: "he", target: "en" }, consent, { layers: [createChromeLayer(() => null), opusStandIn] });
    const r = await tr(["שלום."]);
    expect(r.layer).toBe("opus");
    expect(r.texts[0]).toContain("[opus]");

    let saved = "";
    render(<SideBySideTranslation sourcePath="a.md" sourceMd={"שלום.\n\nעולם."} sidecarMd={null} lang="en" translate={tr} chromeAvailable={false} onSave={(s) => void (saved = s)} />);
    expect(screen.getByTestId("sbs-fallback")).toBeTruthy();
    expect(screen.getAllByTestId("sbs-row")).toHaveLength(2);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    await waitFor(() => expect(saved).toContain("layer: opus"));
    cleanup();
    render(<SideBySideTranslation sourcePath="a.md" sourceMd={"שלום!\n\nעולם."} sidecarMd={saved} lang="en" translate={tr} chromeAvailable={false} onSave={() => undefined} />);
    expect(screen.getAllByTestId("sbs-stale")).toHaveLength(1);
    expect(screen.getByTestId("sbs-layer").textContent).toBeTruthy();
  });
});

describe("the eval card (SYNTHETIC lines here; FLORES-200 itself is read on the Mac)", () => {
  it("reads FLORES's one-sentence-per-line files, and the card has every layer and direction, null with a reason when not run", () => {
    const items = floresItems("שורה אחת\nשורה שתיים\n", "Line one\nLine two\n");
    expect(items).toEqual([{ he: "שורה אחת", en: "Line one" }, { he: "שורה שתיים", en: "Line two" }]);
    expect(chrF(["Line one"], ["Line one"])).toBeCloseTo(100, 5);
    const card = evalCard({ opus: { "he-en": { chrF: 41.2 } } }, { n: 2, machine: null, date: "2026-11-15" });
    expect(CARD_LAYERS).toEqual(["chrome", "opus", "m2m100"]);
    expect(Object.keys(card.layers)).toEqual(CARD_LAYERS);
    expect(card.layers.opus["he-en"]).toEqual({ chrF: 41.2 });
    expect(card.layers.chrome["en-he"]).toEqual({ chrF: null, reason: "not run" });
    expect(card.dev).toBe(false);
  });
});
