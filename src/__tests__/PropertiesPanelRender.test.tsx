/**
 * Plan 4.9 — the properties panel edits the note through the properties
 * API: one field changed, the rest of the text untouched.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { PropertiesPanel } from "../ui/PropertiesPanel";

const NOTE = "---\n# keep me\ntitle: 'Draft'\ndone: false\ntags:\n  - a\n---\nBody\n";

let latest = "";
function Harness({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  latest = text;
  return (
    <PropertiesPanel
      open
      onClose={() => {}}
      text={text}
      applyEdit={(edit) => setText((cur) => edit(cur))}
    />
  );
}

afterEach(cleanup);

describe("<PropertiesPanel>", () => {
  it("lists the properties with typed fields", () => {
    render(<Harness initial={NOTE} />);
    expect((screen.getByLabelText("Value of title") as HTMLInputElement).value).toBe("Draft");
    expect((screen.getByLabelText("Value of done") as HTMLInputElement).type).toBe("checkbox");
    expect((screen.getByLabelText("Type of tags") as HTMLSelectElement).value).toBe("list");
  });

  it("commits a text edit on Enter, changing only that value", () => {
    render(<Harness initial={NOTE} />);
    const input = screen.getByLabelText("Value of title");
    fireEvent.change(input, { target: { value: "Final" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(latest).toBe(NOTE.replace("title: 'Draft'", "title: 'Final'"));
  });

  it("toggles a checkbox, adds a list item, removes and adds properties", () => {
    render(<Harness initial={NOTE} />);
    fireEvent.click(screen.getByLabelText("Value of done"));
    expect(latest).toBe(NOTE.replace("done: false", "done: true"));
    const item = screen.getByLabelText("Add an item to tags");
    fireEvent.change(item, { target: { value: "b" } });
    fireEvent.keyDown(item, { key: "Enter" });
    expect(latest).toContain("tags:\n  - a\n  - b\n---");
    fireEvent.click(screen.getByLabelText("Remove done"));
    expect(latest).not.toContain("done:");
    fireEvent.change(screen.getByLabelText("Property name"), { target: { value: "status" } });
    fireEvent.click(screen.getByLabelText("Add property"));
    expect(latest).toContain("\nstatus:\n---\nBody\n");
    expect(latest).toContain("# keep me");
  });

  it("shows why an invalid frontmatter can't be edited, and offers to add to a note without one", () => {
    render(<Harness initial={"---\na: [1, 2\n---\n"} />);
    expect(screen.getByRole("alert").textContent).toMatch(/valid YAML/);
    cleanup();
    render(<Harness initial={"Just text"} />);
    expect(screen.getByText("This note has no properties yet.")).toBeTruthy();
  });
});
