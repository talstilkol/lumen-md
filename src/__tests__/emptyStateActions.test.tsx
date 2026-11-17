/**
 * Plan W3.2 on train 6: the four empty states that showed only a sentence
 * (scripts/check-empty-states.mjs flagged them) now show the way out, and
 * pressing it does what it says: an empty library clips a page, a verse no
 * note cites and an MCP tab no client has used open the help section that
 * says how, and a graph-table row with no links names its note's button.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LibraryPanel, type LibraryVault } from "../research/library/LibraryPanel";
import type { LibraryDeps } from "../research/library/clipIndex";
import { VersePanel } from "../sources/sefaria/VersePanel";
import { parseSourceRef } from "../sources/sefaria/refs";
import { PrivacyLedgerPanel } from "../ui/PrivacyLedgerPanel";
import { GraphTable } from "../ui/graph/GraphTable";
import "../ui/graphViewStrings"; // GraphView registers the table's lazy English
import { OPEN_HELP_EVENT } from "../ui/HelpButton";

/** The detail of every event of `type` sent while `fn` runs. */
async function events(type: string, fn: () => unknown): Promise<unknown[]> {
  const seen: unknown[] = [];
  const on = (e: Event) => seen.push((e as CustomEvent).detail);
  window.addEventListener(type, on);
  try {
    await fn();
  } finally {
    window.removeEventListener(type, on);
  }
  return seen;
}

afterEach(cleanup);

describe("empty states with an action (W3.2)", () => {
  it("an empty library offers to clip a web page, and closes itself for it", async () => {
    const vault: LibraryVault = { available: () => true, list: async () => ["notes/plan.md"], read: async () => "# Plan" };
    const deps: LibraryDeps = { embedder: async () => ({ id: "test:none", embed: async (texts) => texts.map(() => new Float32Array(4)) }), load: async () => undefined, save: async () => {} };
    const onClose = vi.fn();
    render(<LibraryPanel vault={vault} deps={deps} onClose={onClose} />);
    const empty = await waitFor(() => screen.getByTestId("library-empty"));
    expect(empty.textContent).toContain("No clips yet");
    const action = empty.querySelector('[data-testid="empty-state-action"]') as HTMLButtonElement;
    expect(action.textContent).toBe("Clip a web page…");
    const sent = await events("lumen-run-command", () => fireEvent.click(action));
    expect(sent).toEqual([{ id: "clip.url" }]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("a verse no note cites opens the help section on citing a verse", async () => {
    const ex = parseSourceRef("שמות כ:ב")!;
    render(<VersePanel initial={ex} notesFor={async () => []} onOpen={() => {}} onClose={() => {}} follow={() => () => {}} />);
    const empty = await waitFor(() => screen.getByTestId("verse-panel-empty"));
    const sent = await events(OPEN_HELP_EVENT, () => fireEvent.click(empty.querySelector('[data-testid="empty-state-action"]')!));
    expect(sent).toEqual([{ topic: "workspace/jewish-sources#my-notes-on-this-verse", query: "" }]);
  });

  it("the MCP tab with no client yet opens the help section on turning one on", async () => {
    render(<PrivacyLedgerPanel open onClose={() => {}} mcpLedger={async () => ""} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("privacy-tab-mcp"));
    });
    const empty = await waitFor(() => screen.getByTestId("privacy-mcp-empty"));
    expect(empty.textContent).toContain("No MCP client has used this vault yet.");
    const sent = await events(OPEN_HELP_EVENT, () => fireEvent.click(empty.querySelector('[data-testid="empty-state-action"]')!));
    expect(sent).toEqual([{ topic: "ai/mcp#turn-a-client-on", query: "" }]);
  });

  it("a graph-table row with no links: its note's button, in the same row, opens the note to add them", () => {
    const onOpen = vi.fn();
    render(<GraphTable labels={["linked", "alone", "other"]} neighbors={(i) => (i === 0 ? [2] : i === 2 ? [0] : [])} onOpen={onOpen} />);
    const row = screen.getByText("alone").closest("tr")!;
    expect(row.textContent).toContain("no links");
    fireEvent.click(row.querySelector("th button")!);
    expect(onOpen).toHaveBeenCalledWith(1);
  });
});
