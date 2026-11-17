/**
 * W12.S3 — the conflict dialog in three columns (mine, base, theirs) with
 * a result editor, keyboard moves between conflicts, and "mine" on the
 * right in RTL. Uses the real `threeWayDiff`/`applyMerge`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { openConflictDialog, type ConflictChoice } from "../sync/cloud/ConflictDialog";
import { applyMerge, attachBase, threeWayDiff } from "../sync/cloud/diff";

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.dir = "ltr";
});

const base = "# Title\nThe meeting is on Monday.\nEnd";
const local = "# Title\nThe meeting is on Tuesday.\nEnd";
const remote = "# Title\nThe meeting is on Wednesday.\nEnd";

/** Opens the dialog; returns its pending choice in a box (an async function would wait for it). */
async function open(opts: { base: string; local: string; remote: string }): Promise<{ done: Promise<ConflictChoice> }> {
  let done!: Promise<ConflictChoice>;
  await act(async () => {
    done = openConflictDialog({ path: "notes/a.md", ...opts });
  });
  return { done };
}

describe("attachBase", () => {
  it("puts the replaced base line on the conflict, without changing any merge", () => {
    const raw = threeWayDiff(base, local, remote);
    // Before: the base line sits in its own "both deleted" hunk after the conflict.
    expect(raw.find((h) => h.op === "conflict")?.base).toEqual([]);
    const hs = attachBase(raw);
    expect(hs.map((h) => h.op)).toEqual(["equal", "conflict", "equal"]);
    expect(hs[1].base).toEqual(["The meeting is on Monday."]);
    for (const pick of ["local", "remote", "both"] as const) expect(applyMerge(hs, [pick])).toBe(applyMerge(raw, [pick]));
  });

  it("leaves a conflict that already has a base (git's diff3 hunks) alone", () => {
    const given = [{ op: "conflict" as const, local: ["a"], remote: ["b"], base: ["o"] }, { op: "both" as const, local: [], remote: [], base: ["x"] }];
    expect(attachBase(given)).toEqual(given);
  });
});

describe("three-way conflict dialog", () => {
  it("a one-line conflict shows mine, base and theirs; a hand edit in the result is what is saved", async () => {
    const { done } = await open({ base, local, remote });
    const hunk = await screen.findByTestId("conflict-hunk");
    const cells = [...hunk.children].slice(0, 3).map((c) => c.textContent);
    expect(cells).toEqual(["The meeting is on Tuesday.", "The meeting is on Monday.", "The meeting is on Wednesday."]);

    const result = screen.getByLabelText("Result") as HTMLTextAreaElement;
    expect(result.value).toBe(local); // starts from the picks (mine by default)
    fireEvent.click(screen.getAllByRole("radio")[1]); // theirs
    expect(result.value).toBe(remote);

    fireEvent.change(result, { target: { value: "# Title\nThe meeting is on Thursday.\nEnd" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply merge" }));
    await expect(done).resolves.toEqual({ kind: "merged", content: "# Title\nThe meeting is on Thursday.\nEnd" });
  });

  it("Reset to picks drops the hand edit", async () => {
    await (open({ base, local, remote }));
    const result = (await screen.findByLabelText("Result")) as HTMLTextAreaElement;
    fireEvent.change(result, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset to picks" }));
    expect(result.value).toBe(local);
    expect(screen.queryByRole("button", { name: "Reset to picks" })).toBeNull();
  });

  it("Alt+ArrowDown / F7 move focus between conflicts and wrap; Alt+ArrowUp goes back", async () => {
    const b = "a\nb\nc\nd\ne\nf\ng";
    const l = "A\nb\nc\nd\ne\nf\nG";
    const r = "a1\nb\nc\nd\ne\nf\ng1";
    await (open({ base: b, local: l, remote: r }));
    const hunks = await screen.findAllByTestId("conflict-hunk");
    expect(hunks).toHaveLength(2);
    expect(hunks.map((h) => h.getAttribute("aria-label"))).toEqual(["Conflict 1 of 2", "Conflict 2 of 2"]);
    act(() => hunks[0].focus());
    fireEvent.keyDown(hunks[0], { key: "ArrowDown", altKey: true });
    expect(document.activeElement).toBe(hunks[1]);
    fireEvent.keyDown(hunks[1], { key: "F7" });
    expect(document.activeElement).toBe(hunks[0]);
    fireEvent.keyDown(hunks[0], { key: "ArrowUp", altKey: true });
    expect(document.activeElement).toBe(hunks[1]);
    fireEvent.click(screen.getByRole("button", { name: "Previous conflict" }));
    expect(document.activeElement).toBe(hunks[0]);
  });

  it("each conflict's radios share a name, so arrow keys move within one group", async () => {
    await (open({ base, local, remote }));
    const radios = (await screen.findAllByRole("radio")) as HTMLInputElement[];
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
    expect(radios[0].name).not.toBe("");
  });

  it("in RTL the first column — mine — is on the right", async () => {
    document.documentElement.dir = "rtl";
    await (open({ base, local, remote }));
    const hunk = await screen.findByTestId("conflict-hunk");
    const [mine, , theirs] = [...hunk.children] as HTMLElement[];
    await waitFor(() => expect(mine.getBoundingClientRect().width).toBeGreaterThan(0));
    expect(getComputedStyle(hunk).direction).toBe("rtl");
    expect(mine.getBoundingClientRect().left).toBeGreaterThan(theirs.getBoundingClientRect().left);
  });
});
