/**
 * W12.E2 wired into W12.E5: when the review panel opens, the extraction
 * worker's run (here the same extractor, in-process, at the worker's
 * boundary) scans the vault's notes and its proposals reach the queue
 * through the review's controlled write; nothing else in the vault
 * changes. A rejected proposal is not proposed again, a second opening
 * scans only changed paragraphs, and with no local NER model the panel
 * says the rules ran alone. Synthetic vault (rules only: no model here).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { setVaultBackend } from "../storage/vault";
import { createMemoryBackend } from "../storage/vault/memory";
import type { VaultBackend } from "../storage/vault/types";
import * as workspace from "../storage/workspace";
import { EntityReviewHost } from "../ui/EntityReviewHost";
import { PROPOSALS_PATH, parseJsonl, type Proposal } from "../entities/store";
import { extractEntities } from "../entities/extract/run";
import { addsNothing, isScannedNote, resetScan, type ExtractRun } from "../entities/extract/scanVault";
import { extractInWorker } from "../entities/extract/protocol";
import type { ExtractReply, ExtractRequest } from "../entities/extract/protocol";

const NOTE = "יומן/א.md";
const TEXT = "לפי חוק הגנת הפרטיות, התשמ״א-1981 אסור.\n\nנפגשנו בט״ו בשבט התשפ״ו בבוקר.";

/** What extract.worker.ts does, without the worker: rules only (no model is cached here). */
const runs: Array<{ notes: number; scanned: number; skipped: number }> = [];
const inProcess: ExtractRun = async (req) => {
  const seen = new Map(Object.entries(req.seen ?? {}).map(([k, v]) => [k, new Set(v)]));
  const res = await extractEntities({ notes: req.notes, seen, known: req.known, ner: null });
  runs.push({ notes: req.notes.length, ...res.paragraphs });
  return { id: 1, mode: res.mode, proposals: res.proposals, seen: Object.fromEntries([...res.seen].map(([k, v]) => [k, [...v]])), paragraphs: res.paragraphs };
};

let previous: VaultBackend | null = null;
async function seed() {
  previous = setVaultBackend(createMemoryBackend());
  await workspace.writeWorkspaceFile(NOTE, TEXT);
}
const queue = async () => parseJsonl<Proposal>(await workspace.readWorkspaceFile(PROPOSALS_PATH)).rows;

beforeEach(() => {
  resetScan();
  runs.length = 0;
});
afterEach(() => {
  cleanup();
  setVaultBackend(previous);
});

describe("the extraction worker behind the graph review (W12.E2 → W12.E5)", () => {
  it("opening the review scans the notes; the proposals reach the queue and nothing else is written", async () => {
    await seed();
    render(<EntityReviewHost vault={workspace} extract={inProcess} />);
    const panel = await screen.findByTestId("entity-review", undefined, { timeout: 10_000 });
    const names = (await queue()).map((p) => (p.kind === "entity" ? `${p.type}:${p.name}` : p.id));
    expect(names).toEqual(expect.arrayContaining(["law:חוק הגנת הפרטיות, התשמ״א-1981"]));
    expect(names.some((n) => n.startsWith("event:"))).toBe(true); // ט״ו בשבט התשפ״ו, a date
    expect(within(within(panel).getByRole("listbox")).getAllByRole("option")).toHaveLength(names.length);
    expect(within(panel).getByText(/Rules only|רק כללים|כללים בלבד/)).toBeTruthy();
    // Only the queue: the note is untouched and no entity note exists before approval.
    expect(await workspace.readWorkspaceFile(NOTE)).toBe(TEXT);
    expect((await workspace.listWorkspace({ includeHidden: true })).map((e) => e.path).sort()).toEqual([PROPOSALS_PATH, NOTE].sort());
  });

  it("a rejected proposal is not proposed again; a second opening scans only changed paragraphs", async () => {
    await seed();
    const first = render(<EntityReviewHost vault={workspace} extract={inProcess} />);
    const panel = await screen.findByTestId("entity-review", undefined, { timeout: 10_000 });
    const before = (await queue()).length;
    const list = within(panel).getByRole("listbox");
    await act(async () => {
      fireEvent.keyDown(list, { key: "r" });
    });
    await waitFor(async () => expect((await queue()).length).toBe(before - 1));
    first.unmount();

    await workspace.writeWorkspaceFile(NOTE, TEXT + "\n\nועוד פסקה בלי תאריך.");
    render(<EntityReviewHost vault={workspace} extract={inProcess} />);
    await screen.findByTestId("entity-review", undefined, { timeout: 10_000 });
    await waitFor(() => expect(runs).toHaveLength(2));
    expect(runs[1]).toMatchObject({ scanned: 1, skipped: 2 });
    expect((await queue()).length).toBe(before - 1);
  });

  it("nothing to propose and no graph: nothing renders and nothing is written", async () => {
    previous = setVaultBackend(createMemoryBackend());
    await workspace.writeWorkspaceFile(NOTE, "פסקה רגילה.");
    render(<EntityReviewHost vault={workspace} extract={inProcess} />);
    await waitFor(() => expect(runs).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("entity-review")).toBeNull();
    expect(await workspace.workspaceHasFile(PROPOSALS_PATH)).toBe(false);
  });

  it("scans notes only, and drops a match that adds no spelling", () => {
    expect(isScannedNote("יומן/א.md")).toBe(true);
    expect(isScannedNote(".lumen/entities/x.md")).toBe(false);
    expect(isScannedNote("ישויות/person/דוד.md")).toBe(false);
    const known = [{ id: "person/david", type: "person", name: "דוד", aliases: ["דויד"] }] as never;
    const p = (text: string): Proposal => ({ kind: "entity", id: "p:x", type: "person", name: "דוד", aliases: [], mentions: [{ note: NOTE, anchor: null, paragraphHash: "h", start: 0, end: 3, text }], extractor: "x", model: null, confidence: 1, matches: "person/david" });
    expect(addsNothing(p("דויד"), known)).toBe(true);
    expect(addsNothing(p("לדוד"), known)).toBe(false);
  });

  it("a failing worker rejects instead of hanging", async () => {
    const listeners: Record<string, (e: Event) => void> = {};
    const worker = { postMessage: () => listeners.error?.(Object.assign(new Event("error"), { message: "boom" })), addEventListener: (k: string, f: (e: Event) => void) => void (listeners[k] = f), removeEventListener: () => {} };
    await expect(extractInWorker(worker as never, { id: 1, notes: [], useModel: false } as ExtractRequest)).rejects.toThrow("boom");
    const ok = { postMessage: (r: ExtractRequest) => listeners.message?.(new MessageEvent("message", { data: { id: r.id, mode: "rules-only", proposals: [], seen: {}, paragraphs: { scanned: 0, skipped: 0 } } satisfies ExtractReply })), addEventListener: (k: string, f: (e: Event) => void) => void (listeners[k] = f), removeEventListener: () => {} };
    await expect(extractInWorker(ok as never, { id: 1, notes: [], useModel: false })).resolves.toMatchObject({ mode: "rules-only" });
  });
});
