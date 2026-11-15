/**
 * W12.S2 — "What I knew then" in the UI: the date slider changes the
 * results (RTL), a result opens read-only under a "this is how it was"
 * bar, then-vs-now hunks, and restoring one paragraph as one editor
 * transaction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as history from "../storage/history";
import { applyRestore, paragraphs, restoreHunks } from "../storage/asOfRestore";
import { restoreInView } from "../editor/asOfRestoreEdit";
import { AsOfDialog } from "../ui/AsOfDialog";

vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let run = 0;
beforeEach(() => {
  try {
    globalThis.indexedDB = new IDBFactory();
  } catch {
    // why: offline browser runner: the real IndexedDB, with a vault scope per test.
  }
  history.__resetHistoryDb();
  history.setHistoryVault(`as-of-ui-${Date.now()}-${run++}`);
  document.documentElement.dir = "rtl";
});

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 15, 12);

describe("paragraph hunks (then vs now)", () => {
  it("splits on blank lines with offsets", () => {
    const text = "א\n\n  ב ג\n\n\nד";
    expect(paragraphs(text).map((p) => [p.text, text.slice(p.from, p.to)])).toEqual([
      ["א", "א"],
      ["ב ג", "ב ג"],
      ["ד", "ד"],
    ]);
  });

  it("a changed paragraph, a deleted one and a new one; restoring each gives back then's paragraph", () => {
    const then = "# כותרת\n\nנפגשנו בירושלים.\n\nפסקה שנמחקה.\n\nסוף";
    const now = "# כותרת\n\nנפגשנו בתל אביב.\n\nסוף\n\nתוספת חדשה";
    const hs = restoreHunks(then, now);
    expect(hs.map((h) => h.kind)).toEqual(["changed", "added"]);
    expect(hs[0]).toMatchObject({ then: "נפגשנו בירושלים.\n\nפסקה שנמחקה.", now: "נפגשנו בתל אביב." });
    expect(applyRestore(now, hs[0])).toBe("# כותרת\n\nנפגשנו בירושלים.\n\nפסקה שנמחקה.\n\nסוף\n\nתוספת חדשה");
  });

  it("a paragraph deleted since goes back where it stood", () => {
    const then = "א\n\nב\n\nג";
    const now = "א\n\nג";
    const [h] = restoreHunks(then, now);
    expect(h.kind).toBe("removed");
    expect(applyRestore(now, h)).toBe(then);
    const first = restoreHunks("ראשון\n\nשני", "שני")[0];
    expect(applyRestore("שני", first)).toBe("ראשון\n\nשני");
  });

  it("no hunks when nothing changed", () => {
    expect(restoreHunks("א\n\nב", "א\n\nב")).toEqual([]);
  });
});

describe("restoreInView (real CodeMirror state and view)", () => {
  it("applies one transaction tagged input.restore, and refuses when the editor moved on", () => {
    const now = "א\n\nג";
    const [h] = restoreHunks("א\n\nב\n\nג", now);
    const seen: string[] = [];
    const view = new EditorView({
      state: EditorState.create({ doc: now }),
      parent: document.body,
      dispatchTransactions: (trs, v) => {
        for (const tr of trs) if (tr.docChanged) seen.push(tr.isUserEvent("input.restore") ? "restore" : "other");
        v.update(trs);
      },
    });
    expect(restoreInView(view, h)).toBe(true);
    expect(view.state.doc.toString()).toBe("א\n\nב\n\nג");
    expect(seen).toEqual(["restore"]);
    // The hunk no longer matches what is there: nothing changes.
    expect(restoreInView(view, { ...h, now: "something else", from: 0, to: 3 })).toBe(false);
    expect(view.state.doc.toString()).toBe("א\n\nב\n\nג");
    view.destroy();
  });
});

describe("<AsOfDialog> over the real history store", () => {
  it("in RTL: moving the slider back changes the results, and a result opens read-only with the bar", async () => {
    await history.recordSnapshot("trip.md", "# טיול\n\nנפגשנו בירושלים ליד השער.", "save", NOW - 30 * DAY);
    await history.recordSnapshot("trip.md", "# טיול\n\nנפגשנו ליד השער.", "save", NOW - 2 * DAY);
    const applied: unknown[] = [];
    render(<AsOfDialog onClose={() => {}} now={NOW} activeName="trip.md" applyRestore={(h) => (applied.push(h), true)} />);
    const slider = (await screen.findByTestId("as-of-slider")) as HTMLInputElement;
    await waitFor(() => expect(Number(slider.min)).toBe(Math.floor((NOW - 30 * DAY) / DAY)));
    expect(screen.getByRole("note").textContent).toMatch(/History starts on/);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "בירושלים" } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Nothing matched in the vault as of this date."));

    await act(async () => {
      fireEvent.change(slider, { target: { value: String(Math.floor((NOW - 20 * DAY) / DAY)) } });
    });
    const hit = await screen.findByRole("button", { name: /trip\.md/ });
    fireEvent.click(hit);
    expect((await screen.findByTestId("as-of-banner")).textContent).toMatch(/This is how it was on .*Read-only\./);
    expect(screen.getByTestId("as-of-note").textContent).toContain("בירושלים");

    fireEvent.click(screen.getByRole("button", { name: "Then vs now" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore paragraph" }));
    expect(applied).toEqual([expect.objectContaining({ kind: "changed", then: "נפגשנו בירושלים ליד השער.", now: "נפגשנו ליד השער." })]);
  });

  it("restore is disabled for a note that is not the one open in the editor", async () => {
    await history.recordSnapshot("a.md", "ישן", "save", NOW - 10 * DAY);
    await history.recordSnapshot("a.md", "חדש", "save", NOW - DAY);
    render(<AsOfDialog onClose={() => {}} now={NOW} activeName="other.md" applyRestore={() => true} />);
    const slider = (await screen.findByTestId("as-of-slider")) as HTMLInputElement;
    await waitFor(() => expect(Number(slider.min)).toBe(Math.floor((NOW - 10 * DAY) / DAY)));
    await act(async () => {
      fireEvent.change(slider, { target: { value: slider.min } });
    });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ישן" } });
    fireEvent.click(await screen.findByRole("button", { name: /a\.md/ }));
    fireEvent.click(screen.getByRole("button", { name: "Then vs now" }));
    expect(((await screen.findByRole("button", { name: "Restore paragraph" })) as HTMLButtonElement).disabled).toBe(true);
  });
});
