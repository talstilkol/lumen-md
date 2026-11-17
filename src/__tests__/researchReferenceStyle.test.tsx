/**
 * W10.E38 (plan 6.13 step 2): a research answer ends with its reference list
 * in APA 7, Chicago (author-date) or MLA 9, as the user chose in Settings → AI.
 * The sources are SYNTHETIC (example.org pages).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../store/useStore", () => ({ useAppStore: { getState: () => ({ aiKey: null, useLocalAi: false, useFineTunedModel: false, fineTunedModelId: null }) } }));

import { citedBlocksToMarkdown } from "../research/agent";
import { REFERENCE_STYLE_KEY, referenceSection, researchReferenceStyle, setResearchReferenceStyle } from "../research/references";
import { AiSettingsPanel } from "../ui/AiSettingsPanel";
import { entryForLocalKey } from "../settings/schema";

const BLOCKS = [
  { text: "Niqqud marks vowels in Hebrew script. ", citations: [{ url: "https://example.org/niqqud", title: "Niqqud and its marks", quote: "marks vowels" }] },
  { text: "Dagesh doubles a consonant. ", citations: [{ url: "https://www.example.com/dagesh", title: "Dagesh", quote: "doubles" }] },
];
const refs = (md: string) => md.slice(md.indexOf("## References"), md.indexOf("[^1]:")).trim();
const expected = (style: "apa" | "chicago" | "mla", lang: "en" | "he" = "en") => referenceSection(BLOCKS.flatMap((b) => b.citations), style, lang).join("\n").trim();

beforeEach(() => localStorage.clear());

describe("the reference list's style (W10.E38)", () => {
  it("APA 7 when nothing is chosen, and for an unknown stored value", () => {
    expect(researchReferenceStyle()).toBe("apa");
    localStorage.setItem(REFERENCE_STYLE_KEY, "harvard");
    expect(researchReferenceStyle()).toBe("apa");
  });

  it("the stored choice is the one the research answer uses, and each style writes a different list", () => {
    const apa = refs(citedBlocksToMarkdown("What is niqqud?", BLOCKS).markdown);
    setResearchReferenceStyle("chicago");
    expect(localStorage.getItem(REFERENCE_STYLE_KEY)).toBe("chicago");
    const chicago = refs(citedBlocksToMarkdown("What is niqqud?", BLOCKS).markdown);
    setResearchReferenceStyle("mla");
    const mla = refs(citedBlocksToMarkdown("What is niqqud?", BLOCKS).markdown);
    for (const list of [apa, chicago, mla]) {
      expect(list.match(/^- /gm)).toHaveLength(2);
      // MLA 9 drops the scheme; APA and Chicago keep the full URL.
      expect(list).toContain("example.org/niqqud");
      expect(list).toContain("www.example.com/dagesh");
    }
    expect(new Set([apa, chicago, mla]).size).toBe(3);
    // Each list is the shared formatter's, in that style (no second formatter).
    expect(apa).toBe(expected("apa"));
    expect(chicago).toBe(expected("chicago"));
    expect(mla).toBe(expected("mla"));
  });

  it("back to APA stores nothing; an explicit style on the call wins over the setting", () => {
    setResearchReferenceStyle("mla");
    setResearchReferenceStyle("apa");
    expect(localStorage.getItem(REFERENCE_STYLE_KEY)).toBeNull();
    setResearchReferenceStyle("bogus" as never);
    expect(localStorage.getItem(REFERENCE_STYLE_KEY)).toBeNull();
    setResearchReferenceStyle("chicago");
    const md = citedBlocksToMarkdown("What is niqqud?", BLOCKS, new Date(), "mla").markdown;
    expect(refs(md)).toBe(expected("mla"));
  });

  it("a Hebrew question gets the Hebrew heading in the chosen style", () => {
    setResearchReferenceStyle("mla");
    const md = citedBlocksToMarkdown("מה ההבדל בין ניקוד לטעמים?", BLOCKS).markdown;
    expect(md).toContain("## מקורות");
    expect(md.slice(md.indexOf("## מקורות"))).toContain(referenceSection(BLOCKS.flatMap((b) => b.citations), "mla", "he")[2]);
  });

  it("storage that throws: APA, and choosing does not crash", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(researchReferenceStyle()).toBe("apa");
      expect(() => setResearchReferenceStyle("mla")).not.toThrow();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("is a known AI setting (exported and imported with the others)", () => {
    const entry = entryForLocalKey(REFERENCE_STYLE_KEY) as { tab?: string; type?: string; options?: { value: string }[] } | undefined;
    expect(entry?.tab).toBe("ai");
    expect(entry?.options?.map((o) => o.value)).toEqual(["apa", "chicago", "mla"]);
  });
});

describe("Settings → AI: the references picker (W10.E38)", () => {
  it("shows the stored style, and a change is stored and used", async () => {
    setResearchReferenceStyle("chicago");
    render(<AiSettingsPanel open onClose={() => {}} />);
    const select = (await screen.findByTestId("ai-set-reference-style")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("chicago"));
    expect([...select.options].map((o) => o.textContent)).toEqual(["APA 7", "Chicago (author-date)", "MLA 9"]);
    // It has a visible label (the <label> wraps it).
    expect(select.closest("label")?.textContent).toContain("References");
    fireEvent.change(select, { target: { value: "mla" } });
    await waitFor(() => expect(localStorage.getItem(REFERENCE_STYLE_KEY)).toBe("mla"));
    expect(researchReferenceStyle()).toBe("mla");
  });
});
