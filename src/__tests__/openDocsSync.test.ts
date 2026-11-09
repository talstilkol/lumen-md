/**
 * T46 review fixes: open notes follow moves (folder renames included) and
 * get the same link rewrite as the files on disk; unsaved edits are written
 * before the note is trashed or exported.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import { useAppStore } from "../store/useStore";
import { readWorkspaceFile, writeWorkspaceFile } from "../storage/workspace";
import { safeMove, trashPaths, undoTrash } from "../storage/fileOps";
import { flushActiveWorkspaceDoc, syncOpenDocsAfterMove } from "../store/openDocs";

beforeEach(() => {
  installFakeOpfs();
  useAppStore.setState({ doc: { name: "Untitled.md", content: "", dirty: false, workspaceName: null }, openTabs: [] });
});

function open(path: string, content: string) {
  useAppStore.getState().openTab({ name: path, content, workspaceName: path });
}

describe("syncOpenDocsAfterMove", () => {
  it("retargets the active note when its folder is renamed", async () => {
    await writeWorkspaceFile("proj/a.md", "A");
    open("proj/a.md", "A");
    const r = await safeMove("proj", "work", { folder: true });
    syncOpenDocsAfterMove("proj", r!.path, r!.rewrite);
    const s = useAppStore.getState();
    expect(s.doc.workspaceName).toBe("work/a.md");
    expect(s.doc.name).toBe("work/a.md");
    expect(s.openTabs.map((t) => t.id)).toEqual(["work/a.md"]);
  });

  it("puts rewritten links into open tabs, keeping unsaved edits", async () => {
    await writeWorkspaceFile("Target.md", "# T");
    await writeWorkspaceFile("a.md", "[[Target]]");
    await writeWorkspaceFile("b.md", "[[Target]]");
    open("a.md", "[[Target]]");
    open("b.md", "[[Target]]");
    useAppStore.getState().setContent("[[Target]] typing");
    const r = await safeMove("Target.md", "Renamed.md");
    syncOpenDocsAfterMove("Target.md", r!.path, r!.rewrite);
    const s = useAppStore.getState();
    expect(s.doc.content).toBe("[[Renamed]] typing");
    expect(s.doc.dirty).toBe(true);
    expect(s.openTabs.find((t) => t.id === "a.md")?.content).toBe("[[Renamed]]");
    expect(await readWorkspaceFile("a.md")).toBe("[[Renamed]]");
  });
});

describe("flushActiveWorkspaceDoc", () => {
  it("writes unsaved edits so trashing and Undo keep them", async () => {
    await writeWorkspaceFile("n.md", "saved");
    open("n.md", "saved");
    useAppStore.getState().setContent("saved + recent edit");
    await flushActiveWorkspaceDoc();
    expect(useAppStore.getState().doc.dirty).toBe(false);
    const items = await trashPaths(["n.md"]);
    await undoTrash(items);
    expect(await readWorkspaceFile("n.md")).toBe("saved + recent edit");
  });

  it("does nothing for a clean or non-workspace document", async () => {
    useAppStore.setState({ doc: { name: "Scratch.md", content: "x", dirty: true, workspaceName: null } });
    await flushActiveWorkspaceDoc();
    expect(useAppStore.getState().doc.dirty).toBe(true);
  });
});
