/**
 * Plan 4.4: open notes follow changes made outside Lumen, and a concurrent
 * edit becomes a conflict with 0 data loss — the other version is kept as a
 * file before anything is asked, and saving never overwrites it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, setVaultBackend, type VaultBackend } from "../storage/vault";
import { useAppStore } from "../store/useStore";
import {
  __resetExternalChanges,
  __setConflictUi,
  saveOpenNote,
  startExternalChanges,
  type ConflictResolver,
} from "../store/externalChanges";
import { listWorkspace, readWorkspaceFile, writeWorkspaceFile } from "../storage/workspace";

let vault: VaultBackend;
let stop: () => void;
let resolver: ReturnType<typeof vi.fn<ConflictResolver>>;
const toasts: string[] = [];

function open(path: string, content: string, dirty = false) {
  useAppStore.setState({
    doc: { name: path, content, workspaceName: path, dirty },
    openTabs: [{ id: path, name: path, content, workspaceName: path, dirty }],
  } as never);
}
const doc = () => useAppStore.getState().doc;
/** Another program changes the file: the watcher reports it as external. */
async function outside(path: string, text: string | null, renameTo?: string) {
  if (renameTo) {
    await vault.rename(path, renameTo);
    vault.notifyExternal({ type: "rename", from: path, path: renameTo });
  } else if (text === null) {
    await vault.remove(path);
    vault.notifyExternal({ type: "delete", path });
  } else {
    await vault.write(path, text);
    vault.notifyExternal({ type: "write", path });
  }
}
const settle = () => vi.waitFor(() => undefined).then(() => new Promise((r) => setTimeout(r, 20)));

beforeEach(async () => {
  vault = createMemoryBackend();
  setVaultBackend(vault);
  __resetExternalChanges();
  toasts.length = 0;
  resolver = vi.fn<ConflictResolver>(async () => ({ kind: "local" }));
  __setConflictUi(resolver, (m) => void toasts.push(m));
  await writeWorkspaceFile("note.md", "base");
  open("note.md", "base");
  stop = startExternalChanges();
});
afterEach(() => {
  stop();
  setVaultBackend(null);
});

describe("a note without unsaved edits", () => {
  it("shows the text changed outside Lumen", async () => {
    await outside("note.md", "changed in Obsidian");
    await vi.waitFor(() => expect(doc().content).toBe("changed in Obsidian"));
    expect(doc().dirty).toBe(false);
    expect(useAppStore.getState().openTabs[0].content).toBe("changed in Obsidian");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("follows a rename made outside Lumen", async () => {
    await outside("note.md", "", "archive/note.md");
    await vi.waitFor(() => expect(doc().workspaceName).toBe("archive/note.md"));
    // Autosave now writes the new path, not the old one back.
    expect(await saveOpenNote("archive/note.md", "edited")).toBe(true);
    expect(await vault.stat("note.md")).toBeNull();
  });

  it("stays open, unsaved and detached when deleted outside Lumen (autosave does not recreate it)", async () => {
    await outside("note.md", null);
    await vi.waitFor(() => expect(doc().workspaceName).toBeNull());
    expect(doc()).toMatchObject({ content: "base", dirty: true });
    expect(await vault.stat("note.md")).toBeNull();
  });
});

describe("a concurrent edit (unsaved text in Lumen, a change on disk)", () => {
  it("becomes a conflict: the other version is kept as a file first; 'keep mine' loses nothing", async () => {
    useAppStore.getState().setContent("mine, unsaved");
    await outside("note.md", "theirs, from another editor");
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    expect(resolver.mock.calls[0][0]).toMatchObject({ path: "note.md", base: "base", local: "mine, unsaved", remote: "theirs, from another editor" });
    await settle();
    const files = (await listWorkspace()).map((f) => f.path);
    const copy = files.find((p) => p.startsWith("note (changed outside Lumen"));
    expect(copy).toBeDefined();
    // 0 data loss: both versions are on disk.
    expect(await readWorkspaceFile(copy!)).toBe("theirs, from another editor");
    expect(await readWorkspaceFile("note.md")).toBe("mine, unsaved");
    expect(doc()).toMatchObject({ content: "mine, unsaved", dirty: false });
    expect(toasts.some((t) => t.includes(copy!))).toBe(true);
  });

  it("'take theirs' shows their text and drops the copy (the note holds it again)", async () => {
    resolver.mockResolvedValueOnce({ kind: "remote" });
    useAppStore.getState().setContent("mine, unsaved");
    await outside("note.md", "theirs");
    await vi.waitFor(() => expect(doc().content).toBe("theirs"));
    await settle();
    expect(doc().dirty).toBe(false);
    expect((await listWorkspace()).map((f) => f.path)).toEqual(["note.md"]);
  });

  it("a merge writes the merged text and keeps the copy", async () => {
    resolver.mockResolvedValueOnce({ kind: "merged", content: "mine + theirs" });
    useAppStore.getState().setContent("mine");
    await outside("note.md", "theirs");
    await vi.waitFor(() => expect(doc().content).toBe("mine + theirs"));
    await settle();
    expect(await readWorkspaceFile("note.md")).toBe("mine + theirs");
    expect((await listWorkspace()).length).toBe(2);
  });

  it("autosave is compare-and-swap: a change on disk not yet noticed is never overwritten", async () => {
    useAppStore.getState().setContent("mine");
    // Another program writes, and the watcher has not reported it yet.
    await vault.write("note.md", "theirs, not yet noticed");
    expect(await saveOpenNote("note.md", "mine")).toBe(false);
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    await settle();
    const files = (await listWorkspace()).map((f) => f.path);
    const copy = files.find((p) => p !== "note.md")!;
    expect(await readWorkspaceFile(copy)).toBe("theirs, not yet noticed");
    expect(await readWorkspaceFile("note.md")).toBe("mine");
  });

  it("while a conflict waits for an answer, saving that note writes nothing", async () => {
    let answer!: (v: { kind: "local" }) => void;
    resolver.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    useAppStore.getState().setContent("mine");
    await outside("note.md", "theirs");
    await vi.waitFor(() => expect(resolver).toHaveBeenCalled());
    expect(await saveOpenNote("note.md", "mine, typed on")).toBe(false);
    expect(await readWorkspaceFile("note.md")).toBe("theirs");
    answer({ kind: "local" });
    await vi.waitFor(async () => expect(await readWorkspaceFile("note.md")).toBe("mine"));
  });

  it("the same text on both sides is not a conflict", async () => {
    useAppStore.getState().setContent("same");
    await outside("note.md", "same");
    await settle();
    expect(resolver).not.toHaveBeenCalled();
    expect(doc()).toMatchObject({ content: "same", dirty: false });
  });
});
