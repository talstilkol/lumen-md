/**
 * Plan W12.X3 — "Fill references from OpenAlex" on a source note with a
 * DOI, from ⌘K and from the properties panel. It runs end to end through
 * the real path: the palette command's action and the panel's button, the
 * gated lookup (Settings switch, a question before every lookup), the
 * app's real dialogs answered in the DOM, the property review queue and
 * its panel, and the vault on an in-memory OPFS.
 *
 * Requests are counted at the network boundary, the window's fetch, which
 * the lookup uses in the app. The note, the DOIs and OpenAlex's answer are
 * SYNTHETIC, written for the test (10.5555 is the DOI test prefix).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import { readWorkspaceFile, writeWorkspaceFile } from "../storage/workspace";
import { useAppStore } from "../store/useStore";
import { buildExportCommands } from "../commands/domains/export";
import { loadCommandHints, shownHint } from "../commands/hints";
import type { CommandContext } from "../commands/domains/context";
import { PropertiesPanel } from "../ui/PropertiesPanel";
import { autofillQueue } from "../ui/AutofillPanel";
import { setOpenAlexEnabled } from "../citations/openAlexLookup";
import { fillReferencesForOpenNote } from "../citations/fillReferencesAction";
import { referencesProposal, sourceDoi } from "../citations/fillReferences";
import { readProperties } from "../properties/frontmatter";

const PATH = "Sources/Synthetic paper.md";
// A private phrase in the note: it must never leave the machine.
const NOTE = `---\ntype: source\nkind: article\ntitle: "Synthetic paper"\ndoi: "10.5555/SRC.01"\nreferences:\n  - 10.5555/old.01\n---\n\n# Synthetic paper\n\nMy private reading notes: kumquat-7731.\n`;

let sent: Array<{ url: string; method: string; body: unknown }> = [];
const realFetch = globalThis.fetch;

beforeEach(async () => {
  installFakeOpfs();
  localStorage.clear();
  document.body.innerHTML = "";
  sent = [];
  for (const p of autofillQueue().list()) autofillQueue().reject(p.id);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    sent.push({ url, method: init?.method ?? "GET", body: init?.body ?? null });
    const body = url.includes("/works/doi:")
      ? { referenced_works: ["https://openalex.org/W11", "https://openalex.org/W12", "https://openalex.org/W13"] }
      : {
          results: [
            { id: "https://openalex.org/W11", doi: "https://doi.org/10.5555/REF.11" },
            { id: "https://openalex.org/W12", doi: "https://doi.org/10.5555/ref.12" },
            // Already in the note: not proposed twice.
            { id: "https://openalex.org/W13", doi: "https://doi.org/10.5555/old.01" },
          ],
        };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  await writeWorkspaceFile(PATH, NOTE);
  useAppStore.setState({ locale: "en" });
  useAppStore.getState().openTab({ name: "Synthetic paper.md", content: NOTE, workspaceName: PATH });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  cleanup();
  document.querySelector("#autofill-panel-root") && fireEvent.keyDown(window, { key: "Escape" });
  document.body.innerHTML = "";
});

const ctx = { liveDoc: () => useAppStore.getState().doc, getEditorView: () => null } as unknown as CommandContext;
const paletteCommand = () => buildExportCommands(ctx).find((c) => c.id === "cite.fillReferencesOpenAlex")!;

/** The app dialog open now. */
const dialog = () =>
  waitFor(() => {
    const d = document.querySelector<HTMLElement>(".prompt-dialog");
    if (!d) throw new Error("no dialog yet");
    return d;
  });
const press = (d: HTMLElement, which: "ok" | "cancel") => fireEvent.click(d.querySelector<HTMLButtonElement>(`.prompt-btn-${which}`)!);

/** The panel's button, on the open note. */
function panelButton(): HTMLButtonElement {
  render(<PropertiesPanel open onClose={() => {}} text={useAppStore.getState().doc.content} applyEdit={() => {}} />);
  return screen.getByTestId("props-fill-references") as HTMLButtonElement;
}

/** Run the action through the palette, answering the consent question with `answer`. */
async function viaPalette(answer: "ok" | "cancel"): Promise<void> {
  paletteCommand().action();
  const d = await dialog();
  expect(d.textContent).toContain("10.5555/src.01");
  expect(d.textContent).toContain("api.openalex.org");
  press(d, answer);
}

const proposalRow = () =>
  waitFor(() => {
    const row = document.querySelector<HTMLElement>('[data-testid="autofill-proposal"]');
    if (!row) throw new Error("no proposal row yet");
    return row;
  });

describe("where the action is", () => {
  it("is in ⌘K, with its strings, and in the panel only for a source note with a DOI", async () => {
    const cmd = paletteCommand();
    expect(cmd.label).toBe("Citations: fill references from OpenAlex…");
    // The hint as the palette shows it: its English is the commands' lazy hints chunk (commands/hints.ts).
    await loadCommandHints();
    expect(shownHint(cmd.hint)).not.toMatch(/^cmd\./);
    expect(panelButton().textContent).toBe("Fill references from OpenAlex");
    cleanup();
    render(<PropertiesPanel open onClose={() => {}} text={"---\ntitle: plain\ndoi: 10.5555/x.1\n---\nA plain note.\n"} applyEdit={() => {}} />);
    expect(screen.queryByTestId("props-fill-references")).toBeNull();
    expect(sourceDoi("---\ntype: source\nurl: https://doi.org/10.5555/AB.2\n---\n")).toBe("10.5555/ab.2");
    expect(sourceDoi("---\ntype: source\nurl: https://example.org/x\n---\n")).toBeNull();
  });
});

describe("the switch and the question", () => {
  it("switch off: 0 requests, 0 questions, nothing queued, from ⌘K and from the panel", async () => {
    paletteCommand().action();
    let d = await dialog();
    expect(d.textContent).toContain("Settings → Privacy");
    expect(d.querySelector(".prompt-btn-cancel")).toBeNull(); // a notice, not the consent question
    press(d, "ok");
    await waitFor(() => expect(document.querySelector(".prompt-dialog")).toBeNull());

    fireEvent.click(panelButton());
    d = await dialog();
    expect(d.textContent).toContain("Settings → Privacy");
    press(d, "ok");
    await waitFor(() => expect(document.querySelector(".prompt-dialog")).toBeNull());

    expect(sent).toEqual([]);
    expect(autofillQueue().list()).toEqual([]);
    expect(await readWorkspaceFile(PATH)).toBe(NOTE);
  });

  it("consent declined: 0 requests, nothing queued, nothing written", async () => {
    setOpenAlexEnabled(true);
    fireEvent.click(panelButton());
    const d = await dialog();
    expect(d.textContent).toContain("10.5555/src.01");
    press(d, "cancel");
    await waitFor(() => expect(document.querySelector(".prompt-dialog")).toBeNull());
    // Asked again the next time (not remembered), declined again.
    const run = fillReferencesForOpenNote();
    press(await dialog(), "cancel");
    expect(await run).toBe("declined");

    expect(sent).toEqual([]);
    expect(autofillQueue().list()).toEqual([]);
    expect(await readWorkspaceFile(PATH)).toBe(NOTE);
  });

  it("a note with unsaved edits is asked to be saved first: no question, no request", async () => {
    setOpenAlexEnabled(true);
    useAppStore.getState().setContent(NOTE + "\nmore\n");
    const run = fillReferencesForOpenNote();
    const d = await dialog();
    expect(d.textContent).toContain("Save the note first");
    press(d, "ok");
    expect(await run).toBe("unsaved");
    expect(sent).toEqual([]);
  });
});

describe("the review queue", () => {
  it("approve writes the references; only the DOI was sent, and nothing was written before the approval", async () => {
    setOpenAlexEnabled(true);
    await viaPalette("ok");
    const row = await proposalRow();
    expect(row.dataset.path).toBe(PATH);
    expect(row.textContent).toContain("references");
    expect(row.textContent).toContain("10.5555/ref.11");

    // What went out: GETs to api.openalex.org with the DOI (and then OpenAlex's own ids), no body, none of the note.
    expect(sent.length).toBe(2);
    expect(sent[0].url).toBe("https://api.openalex.org/works/doi:10.5555%2Fsrc.01?select=referenced_works");
    expect(sent[1].url).toBe("https://api.openalex.org/works?filter=openalex:W11|W12|W13&select=id,doi&per-page=50");
    for (const r of sent) {
      expect(r.method).toBe("GET");
      expect(r.body).toBeNull();
      expect(decodeURIComponent(r.url)).not.toMatch(/kumquat|Synthetic|private/i);
    }
    // Queued, not written.
    expect(await readWorkspaceFile(PATH)).toBe(NOTE);

    fireEvent.click(row.querySelector<HTMLButtonElement>('[data-testid="autofill-approve"]')!);
    await waitFor(async () => expect(await readWorkspaceFile(PATH)).not.toBe(NOTE));
    const written = await readWorkspaceFile(PATH);
    expect(readProperties(written).find((p) => p.key === "references")?.value).toEqual(["10.5555/old.01", "10.5555/ref.11", "10.5555/ref.12"]);
    // Only references: changed; the rest of the note is byte for byte the same.
    expect(written.replace(/references:\n(?: {2}- .*\n)+/, "")).toBe(NOTE.replace(/references:\n(?: {2}- .*\n)+/, ""));
    // The open note shows the written text and stays clean.
    await waitFor(() => expect(useAppStore.getState().doc.content).toBe(written));
    expect(useAppStore.getState().doc.dirty).toBe(false);
    expect(autofillQueue().list()).toEqual([]);
  });

  it("reject writes nothing", async () => {
    setOpenAlexEnabled(true);
    fireEvent.click(panelButton());
    press(await dialog(), "ok");
    const row = await proposalRow();
    fireEvent.click(row.querySelector<HTMLButtonElement>('[data-testid="autofill-reject"]')!);
    await waitFor(() => expect(document.querySelector('[data-testid="autofill-proposal"]')).toBeNull());
    expect(autofillQueue().list()).toEqual([]);
    expect(await readWorkspaceFile(PATH)).toBe(NOTE);
    expect(useAppStore.getState().doc.content).toBe(NOTE);
  });

  it("a note changed since the proposal is not written on approve", async () => {
    setOpenAlexEnabled(true);
    await viaPalette("ok");
    const row = await proposalRow();
    await writeWorkspaceFile(PATH, NOTE + "\nEdited elsewhere.\n");
    fireEvent.click(row.querySelector<HTMLButtonElement>('[data-testid="autofill-approve"]')!);
    await waitFor(() => expect(autofillQueue().list()).toEqual([]));
    expect(await readWorkspaceFile(PATH)).toBe(NOTE + "\nEdited elsewhere.\n");
  });

  it("proposes nothing when OpenAlex lists only references the note has", () => {
    expect(referencesProposal(PATH, NOTE, ["10.5555/OLD.01", "https://doi.org/10.5555/old.01"])).toBeNull();
    expect(referencesProposal(PATH, NOTE, ["not a doi"])).toBeNull();
  });
});
