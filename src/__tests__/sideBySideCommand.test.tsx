/**
 * Plan W12.H6: the palette command that opens the side-by-side view
 * (src/ai/mt/openSideBySide.tsx) on the current note, over the real vault
 * code on an in-memory OPFS (helpers/fakeOpfs). The translator is a
 * stand-in that tags each paragraph: no model can be downloaded here (the
 * real layers' numbers are owed to the Mac, W12.M3).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import { closeSideBySide, openSideBySide, pairFor } from "../ai/mt/openSideBySide";
import { readWorkspaceFile, writeWorkspaceFile } from "../storage/workspace";
import { useAppStore } from "../store/useStore";
import { useToastStore } from "../store/useToastStore";

const NOTE = ["# בראשית", "", "בראשית ברא אלהים את השמים ואת הארץ.", "", "והארץ היתה תהו ובהו."].join("\n");
const tagger = (sent: string[]) => async (texts: string[]) => {
  sent.push(...texts);
  return { texts: texts.map((x) => `EN(${x.slice(0, 8)})`), layer: "opus" };
};

beforeEach(() => {
  installFakeOpfs();
});
afterEach(() => {
  act(() => closeSideBySide());
  cleanup();
});

const setDoc = (content: string, workspaceName: string | null) => useAppStore.setState({ doc: { ...useAppStore.getState().doc, name: "a.md", content, workspaceName, dirty: false } });

describe("the language pair", () => {
  it("a Hebrew note goes to English, anything else to Hebrew", () => {
    expect(pairFor(NOTE)).toEqual({ source: "he", target: "en" });
    expect(pairFor("# Genesis\n\nIn the beginning (בראשית)")).toEqual({ source: "en", target: "he" });
    expect(pairFor("")).toEqual({ source: "en", target: "he" });
  });
});

describe("Side-by-side translation from the palette", () => {
  it("opens the note and its translation; Translate writes the sidecar next to the note; an edit is out of date on reopening", async () => {
    await writeWorkspaceFile("notes/a.md", NOTE);
    setDoc(NOTE, "notes/a.md");
    const sent: string[] = [];
    await act(() => openSideBySide({ translate: tagger(sent) }));
    expect(screen.getByTestId("side-by-side-dialog")).toBeTruthy();
    expect(screen.getAllByTestId("sbs-row")).toHaveLength(3);
    expect(screen.getByText("Saved as notes/a.en.md")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Translate 3 paragraph(s)" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Up to date" })).toBeTruthy());
    expect(sent).toHaveLength(3);
    const sidecar = await readWorkspaceFile("notes/a.en.md");
    expect(sidecar).toContain("EN(בראשית ב)");

    act(() => closeSideBySide());
    const edited = NOTE.replace("והארץ היתה תהו ובהו.", "והארץ היתה תהו ובהו וחושך.");
    setDoc(edited, "notes/a.md");
    await act(() => openSideBySide({ translate: tagger(sent) }));
    expect(screen.getAllByTestId("sbs-stale")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Translate 1 paragraph(s)" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Up to date" })).toBeTruthy());
    expect(sent).toHaveLength(4);
  });

  it("an unsaved note gets a message instead (the translation is saved next to the note)", async () => {
    setDoc(NOTE, null);
    useToastStore.setState({ toasts: [] } as never);
    await act(() => openSideBySide({ translate: tagger([]) }));
    expect(screen.queryByTestId("side-by-side-dialog")).toBeNull();
    expect(JSON.stringify(useToastStore.getState())).toContain("Save the note in the vault first");
  });
});
