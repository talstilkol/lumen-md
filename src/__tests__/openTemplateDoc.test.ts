import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../store/useStore";
import { openTemplateDoc } from "../commands/useCommands";

describe("openTemplateDoc", () => {
  beforeEach(() => {
    useAppStore.setState({ openTabs: [], doc: { name: "Welcome.md", content: "", dirty: false } });
    useAppStore.getState().openTab({ name: "Draft.md", content: "my unsaved work", workspaceName: null });
    useAppStore.getState().setDoc({ content: "my unsaved work, edited", dirty: true });
  });

  it("opens the template in a new dirty tab without touching the active document", () => {
    openTemplateDoc("Meeting notes", "# Meeting");
    const s = useAppStore.getState();
    expect(s.doc).toMatchObject({ name: "Meeting notes.md", content: "# Meeting", dirty: true });
    expect(s.openTabs.find((t) => t.id === "Draft.md")).toMatchObject({ content: "my unsaved work, edited", dirty: true });
    expect(s.openTabs.map((t) => t.id)).toEqual(["Draft.md", "Meeting notes.md"]);
  });

  it("never reuses an open tab of the same name", () => {
    openTemplateDoc("Meeting notes", "# One");
    openTemplateDoc("Meeting notes", "# Two");
    const s = useAppStore.getState();
    expect(s.doc).toMatchObject({ name: "Meeting notes 2.md", content: "# Two" });
    expect(s.openTabs.find((t) => t.id === "Meeting notes.md")?.content).toBe("# One");
  });

  it("keeps an active document that has no tab", () => {
    useAppStore.setState({ openTabs: [], doc: { name: "Renamed.md", content: "keep me", dirty: true } });
    openTemplateDoc("Blank", "");
    expect(useAppStore.getState().openTabs.find((t) => t.id === "Renamed.md")).toMatchObject({ content: "keep me", dirty: true });
  });
});
