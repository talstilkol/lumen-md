/**
 * T46 — safe file operations: moves never overwrite silently, keep links
 * working (wiki and Markdown, files and folders), deletes go to the trash
 * and come back.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeDir, installFakeOpfs } from "./helpers/fakeOpfs";
import { listWorkspace, readWorkspaceFile, renameWorkspaceFile, WorkspaceConflictError, workspaceHasEntry, writeWorkspaceFile } from "../storage/workspace";
import { rewriteLinks } from "../storage/linkRewrite";
import { safeMove, trashPaths, undoTrash } from "../storage/fileOps";
import { emptyTrash, listTrash, purgeExpiredTrash, restoreFromTrash, TRASH_KEEP_MS } from "../storage/trash";

beforeEach(() => {
  installFakeOpfs();
});

describe("rename / move", () => {
  it("refuses to replace an existing note", async () => {
    await writeWorkspaceFile("a.md", "A");
    await writeWorkspaceFile("b.md", "B");
    await expect(renameWorkspaceFile("a.md", "b.md")).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(await readWorkspaceFile("b.md")).toBe("B");
    expect(await readWorkspaceFile("a.md")).toBe("A");
  });

  it("moves folders with everything inside", async () => {
    await writeWorkspaceFile("proj/a.md", "A");
    await writeWorkspaceFile("proj/sub/b.md", "B");
    await renameWorkspaceFile("proj", "archive/proj");
    expect(await workspaceHasEntry("proj")).toBe(false);
    expect(await readWorkspaceFile("archive/proj/sub/b.md")).toBe("B");
  });

  it("removes the partial copy when a folder move fails half way", async () => {
    await writeWorkspaceFile("proj/a.md", "A");
    await writeWorkspaceFile("proj/b.md", "B");
    const real = FakeDir.prototype.getFileHandle;
    const spy = vi.spyOn(FakeDir.prototype, "getFileHandle").mockImplementation(function (this: FakeDir, name, opts) {
      if (name === "b.md" && opts?.create && this.name === "proj2") return Promise.reject(new DOMException("full", "QuotaExceededError"));
      return real.call(this, name, opts);
    });
    await expect(renameWorkspaceFile("proj", "proj2")).rejects.toThrow("full");
    spy.mockRestore();
    expect(await workspaceHasEntry("proj2")).toBe(false);
    expect(await readWorkspaceFile("proj/b.md")).toBe("B");
    await renameWorkspaceFile("proj", "proj2");
    expect(await readWorkspaceFile("proj2/b.md")).toBe("B");
  });

  it("refuses to move a folder into itself", async () => {
    await writeWorkspaceFile("p/a.md", "A");
    await expect(renameWorkspaceFile("p", "p/inner")).rejects.toThrow(/into itself/);
  });
});

describe("link rewriting", () => {
  it("rewrites wiki links by name, keeping heading and label", () => {
    const md = "See [[Old Name]], [[old name#Intro|the intro]] and [[folder/Old Name]]. Not [[Other]].";
    expect(rewriteLinks(md, "x.md", "folder/Old Name.md", "folder/New.md")).toBe(
      "See [[New]], [[New#Intro|the intro]] and [[folder/New]]. Not [[Other]].",
    );
  });

  it("matches Hebrew names regardless of niqqud", () => {
    expect(rewriteLinks("ראו [[שָׁלוֹם]]", "x.md", "שלום.md", "ברכה.md")).toBe("ראו [[ברכה]]");
  });

  it("rewrites relative Markdown links that point at the old path", () => {
    const md = "[a](../notes/old.md#top) [b](old.md) [c](https://x.org/old.md)";
    expect(rewriteLinks(md, "docs/x.md", "notes/old.md", "notes/sub/new.md")).toBe(
      "[a](../notes/sub/new.md#top) [b](old.md) [c](https://x.org/old.md)",
    );
  });

  it("leaves code spans and fenced code alone", () => {
    const md = "[[Old]] `[[Old]]` ``a [[Old]] b``\n```md\n[[Old]] [x](Old.md)\n```\n~~~\n[[Old]]\n~~~\nafter [[Old]] [x](Old.md)";
    expect(rewriteLinks(md, "x.md", "Old.md", "New.md")).toBe(
      "[[New]] `[[Old]]` ``a [[Old]] b``\n```md\n[[Old]] [x](Old.md)\n```\n~~~\n[[Old]]\n~~~\nafter [[New]] [x](New.md)",
    );
  });

  it("rewrites extension-qualified wiki links", () => {
    expect(rewriteLinks("[[Old.md]] [[folder/Old.markdown#h|l]]", "x.md", "folder/Old.md", "folder/New.md")).toBe(
      "[[New]] [[folder/New#h|l]]",
    );
  });

  it("rewrites angle-bracket destinations and reference definitions", () => {
    const md = "[a](<Old Note.md#top>) [b][r]\n\n[r]: Old%20Note.md\n[^1]: Old Note.md is a footnote";
    expect(rewriteLinks(md, "x.md", "Old Note.md", "sub/New Note.md")).toBe(
      "[a](<sub/New Note.md#top>) [b][r]\n\n[r]: sub/New%20Note.md\n[^1]: Old Note.md is a footnote",
    );
  });

  it("only rewrites a short wiki link that resolved to the moved note", () => {
    const vault = ["x/Old.md", "y/Old.md"];
    expect(rewriteLinks("[[Old]] [[y/Old]]", "n.md", "y/Old.md", "y/New.md", { vault })).toBe("[[Old]] [[y/New]]");
    expect(rewriteLinks("[[Old]]", "n.md", "x/Old.md", "x/New.md", { vault })).toBe("[[New]]");
  });

  it("a moved note keeps its relative links to notes that stayed", async () => {
    await writeWorkspaceFile("notes/b.md", "B");
    await writeWorkspaceFile("notes/a.md", "[B](b.md) [self](a.md#x)");
    await safeMove("notes/a.md", "archive/a.md");
    expect(await readWorkspaceFile("archive/a.md")).toBe("[B](../notes/b.md) [self](a.md#x)");
  });

  it("notes inside a moved folder keep their links to notes outside it", async () => {
    await writeWorkspaceFile("out.md", "O");
    await writeWorkspaceFile("proj/a.md", "[o](../out.md) [s](sub/b.md) [[proj/sub/b]]");
    await writeWorkspaceFile("proj/sub/b.md", "[a](../a.md)");
    await writeWorkspaceFile("index.md", "[b](proj/sub/b.md)");
    await safeMove("proj", "archive/proj", { folder: true });
    expect(await readWorkspaceFile("archive/proj/a.md")).toBe("[o](../../out.md) [s](sub/b.md) [[archive/proj/sub/b]]");
    expect(await readWorkspaceFile("archive/proj/sub/b.md")).toBe("[a](../a.md)");
    expect(await readWorkspaceFile("index.md")).toBe("[b](archive/proj/sub/b.md)");
  });

  it("safeMove reports the move even when rewriting links fails", async () => {
    await writeWorkspaceFile("a.md", "A");
    await writeWorkspaceFile("b.md", "[[a]]");
    const lr = await import("../storage/linkRewrite");
    const spy = vi.spyOn(lr, "updateLinksAfterMove").mockRejectedValueOnce(new Error("quota"));
    const r = await safeMove("a.md", "c.md");
    spy.mockRestore();
    expect(r?.path).toBe("c.md");
    expect(r?.linksError?.message).toBe("quota");
    expect(await readWorkspaceFile("c.md")).toBe("A");
  });

  it("the returned rewrite applies the same change to text held in memory", async () => {
    await writeWorkspaceFile("Target.md", "# T");
    await writeWorkspaceFile("a.md", "→ [[Target]]");
    const r = await safeMove("Target.md", "Renamed.md");
    expect(r!.rewrite("unsaved → [[Target]]", "a.md")).toBe("unsaved → [[Renamed]]");
  });

  it("safeMove updates every linking note and reports them", async () => {
    await writeWorkspaceFile("Target.md", "# T");
    await writeWorkspaceFile("a.md", "→ [[Target]]");
    await writeWorkspaceFile("b.md", "nothing here");
    const r = await safeMove("Target.md", "Renamed.md");
    expect(r?.linksUpdated).toEqual(["a.md"]);
    expect(await readWorkspaceFile("a.md")).toBe("→ [[Renamed]]");
  });

  it("safeMove asks before replacing, and an accepted replace is undoable", async () => {
    await writeWorkspaceFile("a.md", "A");
    await writeWorkspaceFile("b.md", "B");
    const no = vi.fn(async () => false);
    expect(await safeMove("a.md", "b.md", { confirmReplace: no })).toBeNull();
    expect(no).toHaveBeenCalledWith("b.md");
    const r = await safeMove("a.md", "b.md", { confirmReplace: async () => true });
    expect(await readWorkspaceFile("b.md")).toBe("A");
    expect(r?.replaced).toBeTruthy();
    await restoreFromTrash(r!.replaced!.id);
    expect((await listWorkspace()).map((f) => f.path).sort()).toEqual(["b 2.md", "b.md"]);
  });
});

describe("trash", () => {
  it("delete moves to a hidden .trash and Undo restores", async () => {
    await writeWorkspaceFile("notes/keep.md", "K");
    const items = await trashPaths(["notes/keep.md"]);
    expect(await workspaceHasEntry("notes/keep.md")).toBe(false);
    // hidden from the vault listing
    expect((await listWorkspace()).map((f) => f.path)).toEqual([]);
    expect((await listTrash()).map((i) => i.originalPath)).toEqual(["notes/keep.md"]);
    await undoTrash(items);
    expect(await readWorkspaceFile("notes/keep.md")).toBe("K");
    expect(await listTrash()).toEqual([]);
  });

  it("restores next to a note that took the old name", async () => {
    await writeWorkspaceFile("a.md", "old");
    const [item] = await trashPaths(["a.md"]);
    await writeWorkspaceFile("a.md", "new");
    expect(await restoreFromTrash(item.id)).toBe("a 2.md");
    expect(await readWorkspaceFile("a 2.md")).toBe("old");
  });

  it("trashes and restores folders", async () => {
    await writeWorkspaceFile("p/x.md", "X");
    const items = await trashPaths(["p"], { p: "directory" });
    expect(await workspaceHasEntry("p")).toBe(false);
    await undoTrash(items);
    expect(await readWorkspaceFile("p/x.md")).toBe("X");
  });

  it("sync callers still see dot entries other than the trash", async () => {
    await writeWorkspaceFile("repo/.github/workflows/release.yml", "on: push");
    await writeWorkspaceFile("gone.md", "x");
    await trashPaths(["gone.md"]);
    expect((await listWorkspace()).map((f) => f.path)).toEqual([]);
    expect((await listWorkspace({ includeHidden: true })).map((f) => f.path)).toEqual(["repo/.github/workflows/release.yml"]);
  });

  it("trashing a folder together with a note inside it moves only the folder", async () => {
    await writeWorkspaceFile("p/x.md", "X");
    await writeWorkspaceFile("p/sub/y.md", "Y");
    const items = await trashPaths(["p/x.md", "p", "p/sub/y.md"], { p: "directory" });
    expect(items.map((i) => i.originalPath)).toEqual(["p"]);
    expect((await listTrash()).map((i) => i.originalPath)).toEqual(["p"]);
    await undoTrash(items);
    expect(await readWorkspaceFile("p/sub/y.md")).toBe("Y");
  });

  it("records the moves that succeeded when a later one fails", async () => {
    await writeWorkspaceFile("a.md", "A");
    await expect(trashPaths(["a.md", "missing.md"])).rejects.toThrow();
    expect((await listTrash()).map((i) => i.originalPath)).toEqual(["a.md"]);
  });

  it("restores a note beside a folder that took its name", async () => {
    await writeWorkspaceFile("a.md", "old");
    const [item] = await trashPaths(["a.md"]);
    await writeWorkspaceFile("a.md/inner.md", "folder now");
    expect(await restoreFromTrash(item.id)).toBe("a 2.md");
    expect(await readWorkspaceFile("a 2.md")).toBe("old");
  });

  it("purges only items older than 30 days; empty removes for good", async () => {
    await writeWorkspaceFile("old.md", "o");
    await writeWorkspaceFile("new.md", "n");
    const { moveToTrash } = await import("../storage/trash");
    const now = Date.now();
    await moveToTrash(["old.md"], {}, now - TRASH_KEEP_MS - 1);
    await moveToTrash(["new.md"], {}, now);
    expect(await purgeExpiredTrash(now)).toBe(1);
    expect((await listTrash()).map((i) => i.originalPath)).toEqual(["new.md"]);
    expect(await emptyTrash()).toBe(1);
    expect(await listTrash()).toEqual([]);
  });
});
