/**
 * Plan 4.14 — a PDF and its highlights note (`<file>.pdf.md`) move together;
 * a declined replace leaves both where they were; a PDF renamed by its stem
 * stays a PDF.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import { readWorkspaceFile, workspaceHasEntry, writeWorkspaceFile } from "../storage/workspace";
import { companionNoteOf, renamedFileName, safeMoveWithCompanion, withoutCompanions } from "../storage/fileOps";
import { listTrash } from "../storage/trash";

beforeEach(() => {
  installFakeOpfs();
});

describe("renamedFileName", () => {
  it("keeps a non-Markdown file's extension when a bare name is typed", () => {
    expect(renamedFileName("papers/paper.pdf", "draft")).toBe("draft.pdf");
    expect(renamedFileName("data.csv", "table")).toBe("table.csv");
  });

  it("gives notes .md, and keeps any extension that was typed", () => {
    expect(renamedFileName("a.md", "b")).toBe("b.md");
    expect(renamedFileName("a.markdown", "b")).toBe("b.md");
    expect(renamedFileName("README", "b")).toBe("b.md");
    expect(renamedFileName("paper.pdf", "notes.md")).toBe("notes.md");
    expect(renamedFileName("paper.pdf", "draft.v2.pdf")).toBe("draft.v2.pdf");
  });

  it("only PDFs have a companion note", () => {
    expect(companionNoteOf("a/paper.PDF")).toBe("a/paper.PDF.md");
    expect(companionNoteOf("a/paper.md")).toBeNull();
  });
});

describe("safeMoveWithCompanion", () => {
  it("moves the PDF and its highlights note together", async () => {
    await writeWorkspaceFile("paper.pdf", "%PDF");
    await writeWorkspaceFile("paper.pdf.md", "highlights");
    const m = await safeMoveWithCompanion("paper.pdf", "archive/draft.pdf");
    expect(m?.main.path).toBe("archive/draft.pdf");
    expect(m?.companion?.path).toBe("archive/draft.pdf.md");
    expect(await readWorkspaceFile("archive/draft.pdf.md")).toBe("highlights");
    expect(await workspaceHasEntry("paper.pdf")).toBe(false);
    expect(await workspaceHasEntry("paper.pdf.md")).toBe(false);
  });

  it("asks about both destinations first; a declined replace moves nothing and deletes nothing", async () => {
    await writeWorkspaceFile("paper.pdf", "%PDF");
    await writeWorkspaceFile("paper.pdf.md", "mine");
    await writeWorkspaceFile("draft.pdf.md", "theirs");
    const confirmReplace = vi.fn(async () => false);
    expect(await safeMoveWithCompanion("paper.pdf", "draft.pdf", { confirmReplace })).toBeNull();
    expect(confirmReplace).toHaveBeenCalledWith("draft.pdf.md");
    expect(await readWorkspaceFile("paper.pdf")).toBe("%PDF");
    expect(await readWorkspaceFile("paper.pdf.md")).toBe("mine");
    expect(await readWorkspaceFile("draft.pdf.md")).toBe("theirs");
    expect(await workspaceHasEntry("draft.pdf")).toBe(false);
    expect(await listTrash()).toEqual([]);
  });

  it("asks once per destination when the user agrees, and the replaced files go to the trash", async () => {
    await writeWorkspaceFile("paper.pdf", "%PDF new");
    await writeWorkspaceFile("paper.pdf.md", "new notes");
    await writeWorkspaceFile("draft.pdf", "%PDF old");
    await writeWorkspaceFile("draft.pdf.md", "old notes");
    const confirmReplace = vi.fn(async () => true);
    const m = await safeMoveWithCompanion("paper.pdf", "draft.pdf", { confirmReplace });
    expect(m?.companion?.path).toBe("draft.pdf.md");
    expect(confirmReplace.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["draft.pdf", "draft.pdf.md"]);
    expect(await readWorkspaceFile("draft.pdf")).toBe("%PDF new");
    expect(await readWorkspaceFile("draft.pdf.md")).toBe("new notes");
    expect((await listTrash()).length).toBe(2);
  });

  it("leaves the note alone when it is part of the same move, and moves a PDF without one", async () => {
    await writeWorkspaceFile("paper.pdf", "%PDF");
    await writeWorkspaceFile("paper.pdf.md", "notes");
    const m = await safeMoveWithCompanion("paper.pdf", "dir/paper.pdf", { alsoMoving: new Set(["paper.pdf", "paper.pdf.md"]) });
    expect(m?.companion).toBeNull();
    expect(await readWorkspaceFile("paper.pdf.md")).toBe("notes");
    await writeWorkspaceFile("lone.pdf", "%PDF");
    expect((await safeMoveWithCompanion("lone.pdf", "x.pdf"))?.main.path).toBe("x.pdf");
  });
});

describe("a multi-file move with a PDF and its note both selected", () => {
  it("moves them as one unit: the note is left to the PDF's move", () => {
    expect(withoutCompanions(["b.md", "paper.pdf.md", "paper.pdf", "x/other.pdf.md"])).toEqual(["b.md", "paper.pdf", "x/other.pdf.md"]);
  });

  it("so a declined replace of the note's destination keeps the pair together", async () => {
    await writeWorkspaceFile("paper.pdf", "%PDF");
    await writeWorkspaceFile("paper.pdf.md", "mine");
    await writeWorkspaceFile("dir/paper.pdf.md", "theirs");
    const confirmReplace = vi.fn(async () => false);
    for (const p of withoutCompanions(["paper.pdf.md", "paper.pdf"])) {
      expect(await safeMoveWithCompanion(p, `dir/${p}`, { confirmReplace })).toBeNull();
    }
    expect(await readWorkspaceFile("paper.pdf")).toBe("%PDF");
    expect(await readWorkspaceFile("paper.pdf.md")).toBe("mine");
    expect(await readWorkspaceFile("dir/paper.pdf.md")).toBe("theirs");
    expect(await workspaceHasEntry("dir/paper.pdf")).toBe(false);
  });
});
