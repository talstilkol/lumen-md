/**
 * Plan W13.R1 — the "Reading mode" menu: one place for the modes and the
 * note's profile, "Save for this note" in the file or on this device only.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createHash } from "node:crypto";
import { useAppStore } from "../store/useStore";
import { ReadingModeMenu } from "../ui/ReadingModeMenu";
import { localNoteProfile, globalProfile } from "../reading/settings";
import { fileProfile } from "../reading/profileStore";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const MD = "---\ntitle: שלום\n---\n\nבְּרֵאשִׁית בָּרָא\n";

function setDoc(content: string, workspaceName: string | null = "notes/a.md") {
  useAppStore.setState({ doc: { name: "a.md", content, dirty: false, workspaceName, handle: undefined } as never });
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  setDoc(MD);
});

describe("Reading mode menu", () => {
  it("lists the modes and the common fields, labelled", () => {
    render(<ReadingModeMenu close={() => undefined} />);
    expect(screen.getByTestId("rm-mode-page")).toBeTruthy();
    expect(screen.getByTestId("rm-mode-focus")).toBeTruthy();
    expect(screen.getByLabelText("Column width")).toBeTruthy();
    expect(screen.getByTestId("rm-sources").textContent).toMatch(/follows the reading settings/);
  });

  it("“on this device only” keeps the profile and leaves the file's bytes alone", () => {
    const before = sha(useAppStore.getState().doc.content);
    render(<ReadingModeMenu close={() => undefined} />);
    fireEvent.change(screen.getByTestId("rm-width"), { target: { value: "56" } });
    fireEvent.click(screen.getByTestId("rm-where-device"));
    fireEvent.click(screen.getByTestId("rm-save-note"));
    expect(sha(useAppStore.getState().doc.content)).toBe(before);
    expect(localNoteProfile("notes/a.md")).toEqual({ width: 56 });
  });

  it("“in the note's file” writes lumen-reading and nothing else", () => {
    render(<ReadingModeMenu close={() => undefined} />);
    fireEvent.click(screen.getByTestId("rm-mode-focus"));
    fireEvent.change(screen.getByTestId("rm-nikud"), { target: { value: "show" } });
    fireEvent.click(screen.getByTestId("rm-save-note"));
    const content = useAppStore.getState().doc.content;
    expect(fileProfile(content)).toEqual({ mode: "focus", nikud: "show" });
    expect(content).toBe("---\ntitle: שלום\nlumen-reading: {mode: focus, nikud: show}\n---\n\nבְּרֵאשִׁית בָּרָא\n");
    expect(localNoteProfile("notes/a.md")).toBeNull();
  });

  it("a note with a profile shows where each value comes from, and reset removes it", () => {
    setDoc("---\nlumen-reading: {width: 50}\n---\nx");
    render(<ReadingModeMenu close={() => undefined} />);
    expect(screen.getByTestId("rm-from-width").textContent).toMatch(/from the file/);
    fireEvent.click(screen.getByTestId("rm-reset"));
    expect(useAppStore.getState().doc.content).toBe("---\n---\nx");
  });

  it("“Save for all notes” changes the global profile, not the note", () => {
    render(<ReadingModeMenu close={() => undefined} />);
    fireEvent.change(screen.getByTestId("rm-size"), { target: { value: "21" } });
    fireEvent.click(screen.getByTestId("rm-save-all"));
    expect(globalProfile().size).toBe(21);
    expect(useAppStore.getState().doc.content).toBe(MD);
  });

  it("a broken frontmatter is never written: it falls back to this device", () => {
    setDoc("---\na: [\n---\nx");
    render(<ReadingModeMenu close={() => undefined} />);
    fireEvent.change(screen.getByTestId("rm-width"), { target: { value: "50" } });
    fireEvent.click(screen.getByTestId("rm-save-note"));
    expect(useAppStore.getState().doc.content).toBe("---\na: [\n---\nx");
    expect((screen.getByTestId("rm-where-device") as HTMLInputElement).checked).toBe(true);
  });
});
