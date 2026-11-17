/**
 * Plan W12.X2 — the reading list's palette commands: "new source from the
 * citation library" and "new source from a captured page". They run here
 * end to end through the real path: the command's action, the real
 * dialogs (answered in the DOM), the real citation library and type
 * registry read from the vault, and the vault on an in-memory OPFS.
 *
 * The library items and the clip note are SYNTHETIC, written for the test.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import { listWorkspace, readWorkspaceFile, writeWorkspaceFile } from "../storage/workspace";
import { invalidateLibrary } from "../citations/library";
import { useAppStore } from "../store/useStore";
import { COMMAND_SECTIONS } from "../commands/domains";
import { buildReadingCommands } from "../commands/domains/reading";
import { newSourceFromCapture, newSourceFromLibrary } from "../commands/domains/readingActions";
import type { CommandContext } from "../commands/domains/context";
import { frontmatterOf } from "../reading/progress";
import { captureFromNote, webUrl } from "../reading/sourceFrom";

const ZOTERO = JSON.stringify([
  { id: "cohen2020", "citation-key": "cohen2020", type: "article-journal", title: "Reading in Hebrew", author: [{ family: "Cohen", given: "Dana" }], issued: { "date-parts": [[2020]] }, DOI: "10.1000/xyz" },
  { id: "levi2018", "citation-key": "levi2018", type: "book", title: "Books and Readers", author: [{ family: "Levi", given: "Avi" }], issued: { "date-parts": [[2018]] } },
]);

const CLIP = `---\ntitle: "על קריאה איטית"\nsource: "https://example.org/slow-reading"\nauthor: "Noa Bar"\npublished: "2024-03-01"\nclipped: "2026-11-15"\ntags: [clip]\n---\n\n# על קריאה איטית\n\n> https://example.org/slow-reading · 2026-11-15\n\nטקסט.\n`;

/** The dialog open now: type `value` into its field (or pick it in its list), then OK. */
async function answer(value: string): Promise<void> {
  const ok = await waitFor(() => {
    const b = document.querySelector<HTMLButtonElement>(".prompt-btn-ok");
    if (!b) throw new Error("no dialog yet");
    return b;
  });
  const field = document.querySelector<HTMLInputElement | HTMLSelectElement>(".prompt-dialog .prompt-input");
  if (field) fireEvent.change(field, { target: { value } });
  fireEvent.click(ok);
}

const ctxFor = (content: string, workspaceName: string | null): CommandContext =>
  ({ liveDoc: () => ({ name: "doc.md", content, workspaceName, dirty: false }) }) as unknown as CommandContext;

const sourcesIn = async () => (await listWorkspace()).map((f) => f.path).filter((p) => p.startsWith("Sources/")).sort();

beforeEach(async () => {
  installFakeOpfs();
  invalidateLibrary();
  document.body.innerHTML = "";
  useAppStore.setState({ locale: "en" });
});

describe("the palette lists the two commands", () => {
  it("in the Insert group, after every earlier section (the pinned order is kept)", () => {
    const cmds = buildReadingCommands(ctxFor("", null));
    expect(cmds.map((c) => c.id)).toEqual(["reading.newFromLibrary", "reading.newFromCapture"]);
    for (const c of cmds) expect(c.label).not.toMatch(/^cmd\./);
    // Sections appended later (T8: screenshot, MCP, Yiddish/Ladino, academic, external agents) come after it, in this order.
    const at = COMMAND_SECTIONS.indexOf(buildReadingCommands);
    expect(at).toBeGreaterThan(0);
    expect(COMMAND_SECTIONS.slice(at + 1).map((f) => f.name)).toEqual(["buildScreenshotCommands", "buildMcpCommands", "buildJewishLanguageCommands", "buildAcademicCommands", "buildExternalAgentCommands"]);
  });
});

describe("new source from the citation library", () => {
  it("searches the vault's Zotero copy, saves the picked item as a source in Sources/ and opens it", async () => {
    await writeWorkspaceFile(".lumen/zotero-library.csl.json", ZOTERO);
    const run = newSourceFromLibrary();
    await answer("cohen");
    await answer("cohen2020");
    await run;
    expect(await sourcesIn()).toEqual(["Sources/Reading in Hebrew.md"]);
    const text = await readWorkspaceFile("Sources/Reading in Hebrew.md");
    expect(frontmatterOf(text)).toMatchObject({ type: "source", kind: "article", status: "to-read", citekey: "cohen2020", author: "Dana Cohen", year: "2020", url: "https://doi.org/10.1000/xyz" });
    expect(useAppStore.getState().doc.workspaceName).toBe("Sources/Reading in Hebrew.md");
  });

  it("an item that is already a source is opened, not made twice", async () => {
    await writeWorkspaceFile(".lumen/zotero-library.csl.json", ZOTERO);
    await writeWorkspaceFile("reading/levi.md", "---\ntype: source\ncitekey: levi2018\nstatus: reading\n---\n\n# Levi\n");
    const run = newSourceFromLibrary();
    await answer("");
    await answer("levi2018");
    await run;
    expect(await sourcesIn()).toEqual([]);
    expect(useAppStore.getState().doc.workspaceName).toBe("reading/levi.md");
  });

  it("an empty library says so and writes nothing", async () => {
    const run = newSourceFromLibrary();
    await answer("");
    await run;
    expect(await sourcesIn()).toEqual([]);
  });
});

describe("new source from a captured page", () => {
  it("the clip open now becomes a website source with its link, author and year, linked back to the clip", async () => {
    await writeWorkspaceFile("Library/slow.md", CLIP);
    await newSourceFromCapture(ctxFor(CLIP, "Library/slow.md"));
    expect(await sourcesIn()).toEqual(["Sources/על קריאה איטית.md"]);
    const text = await readWorkspaceFile("Sources/על קריאה איטית.md");
    expect(frontmatterOf(text)).toMatchObject({ type: "source", kind: "website", url: "https://example.org/slow-reading", author: "Noa Bar", year: "2024", status: "to-read" });
    expect(text).toContain("[[Library/slow]]");
    expect(document.querySelector(".prompt-btn-ok")).toBeNull(); // nothing asked
  });

  it("from a note that is not a clip it asks for the link, and refuses one that is not http(s)", async () => {
    const run = newSourceFromCapture(ctxFor("# plain note\n", "notes/plain.md"));
    await answer("javascript:alert(1)");
    await answer(""); // the alert
    await run;
    expect(await sourcesIn()).toEqual([]);

    const again = newSourceFromCapture(ctxFor("# plain note\n", "notes/plain.md"));
    await answer("https://example.org/b");
    await again;
    expect(await sourcesIn()).toEqual(["Sources/https example.org b.md"]);
  });

  it("the same page twice opens the first source", async () => {
    await newSourceFromCapture(ctxFor(CLIP, "Library/slow.md"));
    await newSourceFromCapture(ctxFor(CLIP, "Library/slow.md"));
    expect(await sourcesIn()).toEqual(["Sources/על קריאה איטית.md"]);
  });
});

describe("what counts as a captured page", () => {
  it("a clip's frontmatter source: link; not a plain note, not a non-web link", () => {
    expect(captureFromNote(CLIP, "Library/slow.md")).toEqual({ url: "https://example.org/slow-reading", title: "על קריאה איטית", author: "Noa Bar", year: "2024", note: "Library/slow.md" });
    expect(captureFromNote("# just a note\n")).toBeNull();
    expect(captureFromNote("---\nsource: Sefaria\n---\n")).toBeNull();
    expect(webUrl("javascript:alert(1)")).toBeNull();
    expect(webUrl(" https://example.org/x ")).toBe("https://example.org/x");
  });
});
