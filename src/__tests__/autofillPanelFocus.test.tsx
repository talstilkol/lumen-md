/**
 * Plan 5.10 — the approval queue as a user drives it (the panel, not only the
 * queue): nothing is written until Approve, a stale note is refused, and the
 * keyboard focus never drops to <body> when a row leaves the list (audit r4:
 * focus must land somewhere sensible after every action).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const files = new Map<string, string>();
const writes: string[] = [];
vi.mock("../storage/workspace", () => ({
  readWorkspaceFile: async (p: string) => files.get(p) ?? null,
  writeWorkspaceFile: async (p: string, text: string) => void (writes.push(p), files.set(p, text)),
}));
vi.mock("../store/externalChanges", () => ({ showOwnWrite: () => undefined }));
vi.mock("./../ui/AiToast", () => ({ showAiToast: () => undefined }));

import { proposeFor, type FieldSpec } from "../properties/autofill";
import { AutofillPanel, autofillQueue } from "../ui/AutofillPanel";

const FIELDS: FieldSpec[] = [{ key: "status", type: "text", options: ["draft", "done"] }];
const NOTES = ["a.md", "b.md", "c.md"];

function fill() {
  for (const p of NOTES) {
    const text = `# ${p}\n`;
    files.set(p, text);
    autofillQueue().add(proposeFor(p, text, { status: "draft" }, FIELDS)!);
  }
}

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
/** The writes go through dynamic imports: wait (in steps) until `ok()` or give up after 2 s. */
async function until(ok: () => boolean) {
  for (let i = 0; i < 100 && !ok(); i++) await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
}
const focusedTestId = () => (document.activeElement as HTMLElement | null)?.dataset.testid ?? document.activeElement?.tagName;
const focusedPath = () => (document.activeElement?.closest("[data-path]") as HTMLElement | null)?.dataset.path;

afterEach(() => {
  cleanup();
  for (const p of autofillQueue().list()) autofillQueue().reject(p.id);
  files.clear();
  writes.length = 0;
});

describe("the autofill panel (5.10)", () => {
  it("shows every proposal and writes nothing before Approve", async () => {
    fill();
    render(<AutofillPanel onClose={() => undefined} />);
    expect(screen.getAllByTestId("autofill-proposal")).toHaveLength(3);
    await settle();
    expect(writes).toEqual([]);
  });

  it("reject: the row leaves, nothing is written, focus moves to the row now in its place", async () => {
    fill();
    render(<AutofillPanel onClose={() => undefined} />);
    const reject = screen.getAllByTestId("autofill-reject")[0];
    reject.focus();
    fireEvent.click(reject);
    await settle();
    expect(screen.getAllByTestId("autofill-proposal").map((li) => li.dataset.path)).toEqual(["b.md", "c.md"]);
    expect(writes).toEqual([]);
    expect(focusedTestId()).toBe("autofill-approve");
    expect(focusedPath()).toBe("b.md");
  });

  it("approve the last row: one write, focus on the row before it", async () => {
    fill();
    render(<AutofillPanel onClose={() => undefined} />);
    const approve = screen.getAllByTestId("autofill-approve")[2];
    approve.focus();
    fireEvent.click(approve);
    await until(() => writes.length === 1 && screen.queryAllByTestId("autofill-proposal").length === 2 && focusedPath() !== "c.md");
    expect(writes).toEqual(["c.md"]);
    expect(files.get("c.md")).toContain("status: draft");
    expect(focusedPath()).toBe("b.md");
  });

  it("a note changed since the proposal is not written; the queue empties and focus goes to the empty state's action", async () => {
    fill();
    files.set("a.md", "# a.md\nedited by hand\n");
    render(<AutofillPanel onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId("autofill-approve-all"));
    await until(() => screen.queryAllByTestId("autofill-proposal").length === 0 && focusedTestId() === "empty-state-action");
    expect([...writes].sort()).toEqual(["b.md", "c.md"]);
    expect(files.get("a.md")).toBe("# a.md\nedited by hand\n");
    expect(screen.queryAllByTestId("autofill-proposal")).toHaveLength(0);
    expect(focusedTestId()).toBe("empty-state-action");
  });
});

describe("the note's name in a row (5.10)", () => {
  it("is the title without .md, the folder apart, each part isolated for right-to-left", async () => {
    const { NotePath } = await import("../ui/AutofillPanel");
    const { container } = render(<NotePath path="פגישות/תקציב 2027.md" />);
    expect(container.querySelector("strong bdi")!.textContent).toBe("תקציב 2027");
    expect([...container.querySelectorAll("span > span bdi")].map((b) => b.textContent)).toEqual(["פגישות"]);
    expect(container.textContent).not.toContain(".md");
    expect(container.querySelector("[title]")!.getAttribute("title")).toBe("פגישות/תקציב 2027.md");
  });
});
