/**
 * The database block (4.10) in the DOM: editing a table cell writes that one
 * value to the note; the toolbar filters, sorts and groups; the kanban has a
 * column per value (plus the spec's `columns:`) and a keyboard handle per card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import { readWorkspaceFile, writeWorkspaceFile } from "../storage/workspace";
import DatabaseBlock from "../views/DatabaseBlock";

vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));

const note = (status: string, rating: number, extra = "") => `---\ntype: task\nstatus: ${status}\nrating: ${rating}\n${extra}---\n\nBody of the note.\n`;

beforeEach(async () => {
  installFakeOpfs();
  await writeWorkspaceFile("tasks/Alpha.md", note("todo", 3, "# keep this comment\n"));
  await writeWorkspaceFile("tasks/Beta.md", note("doing", 5));
  await writeWorkspaceFile("tasks/גימל.md", note("todo", 1));
});
afterEach(() => cleanup());

const SPEC = "source: tasks\ntype: task\nfields: [status, rating]\ngroupBy: status\ncolumns: [todo, doing, done]\n";
const titles = () => screen.getAllByRole("link").map((a) => a.textContent);

describe("DatabaseBlock", () => {
  it("edits a table cell: only that value changes in the file", async () => {
    render(<DatabaseBlock source={SPEC.replace("groupBy: status\n", "")} />);
    await waitFor(() => expect(titles()).toEqual(["Alpha", "Beta", "גימל"]));
    const before = await readWorkspaceFile("tasks/Alpha.md");
    fireEvent.click(screen.getByRole("button", { name: "Edit rating of Alpha" }));
    const input = screen.getByRole("textbox", { name: "Edit rating of Alpha" });
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(async () => expect(await readWorkspaceFile("tasks/Alpha.md")).toBe(before.replace("rating: 3", "rating: 4")));
    expect(await readWorkspaceFile("tasks/Beta.md")).toBe(note("doing", 5));
    // Escape leaves the value alone.
    fireEvent.click(screen.getByRole("button", { name: "Edit status of Beta" }));
    const other = screen.getByRole("textbox", { name: "Edit status of Beta" });
    fireEvent.change(other, { target: { value: "gone" } });
    fireEvent.keyDown(other, { key: "Escape" });
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(await readWorkspaceFile("tasks/Beta.md")).toBe(note("doing", 5));
  });

  it("filters (AND/OR), shows a filter error, sorts and groups", async () => {
    render(<DatabaseBlock source={SPEC.replace("groupBy: status\n", "")} />);
    await waitFor(() => expect(titles()).toHaveLength(3));
    const filter = screen.getByTestId("database-filter");
    fireEvent.change(filter, { target: { value: 'status = "todo" AND rating >= 2 OR rating = 5' } });
    fireEvent.keyDown(filter, { key: "Enter" });
    await waitFor(() => expect(titles()).toEqual(["Alpha", "Beta"]));
    fireEvent.change(filter, { target: { value: "rating >=" } });
    fireEvent.keyDown(filter, { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toContain("expression ends too early");
    fireEvent.change(filter, { target: { value: "" } });
    fireEvent.keyDown(filter, { key: "Enter" });
    fireEvent.change(screen.getByTestId("database-sort"), { target: { value: "rating" } });
    await waitFor(() => expect(titles()).toEqual(["גימל", "Alpha", "Beta"]));
    fireEvent.click(screen.getByRole("button", { name: "Ascending" }));
    await waitFor(() => expect(titles()).toEqual(["Beta", "Alpha", "גימל"]));
    fireEvent.change(screen.getByTestId("database-group"), { target: { value: "status" } });
    await waitFor(() => expect(screen.getAllByRole("rowheader").map((h) => h.textContent?.replace(/\d+$/, "").trim())).toEqual(["doing", "todo"]));
  });

  it("kanban: a column per value and per listed column, a move handle per card", async () => {
    render(<DatabaseBlock source={SPEC.replace("source:", "view: kanban\nsource:")} />);
    const board = await screen.findByTestId("database-kanban");
    await waitFor(() => expect(within(board).getAllByRole("region").map((c) => c.getAttribute("data-column"))).toEqual(["todo", "doing", "done"]));
    const todo = within(board).getByRole("region", { name: "todo" });
    expect(within(todo).getAllByRole("link").map((a) => a.textContent)).toEqual(["Alpha", "גימל"]);
    const handle = within(todo).getByRole("button", { name: "Move Alpha" });
    expect(handle.getAttribute("aria-roledescription")).toBe("draggable");
    expect(document.getElementById(handle.getAttribute("aria-describedby")!)?.textContent).toContain("press Space or Enter");
  });
});
