/**
 * Plan W12.T2, e2e in RTL (offline part): make the type "אדם" with Object
 * Studio's writers, start a new note from it, fill five fields in the form
 * and save; then axe on the form. The vault is SYNTHETIC. The form is the
 * real component; its edits run through the real frontmatter writer over the
 * note's text, which is what the editor saves.
 */
import { describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import axe from "axe-core";
import { useState } from "react";
import { TypedFields } from "../types/TypedFields";
import { loadTypeRegistry } from "../types/typeRegistry";
import { addFieldToTypeText, newTypedNote, newTypeFile } from "../types/typedForm";
import { readProperties } from "../properties/frontmatter";

function personType() {
  let f = newTypeFile("person", { he: "אדם", en: "Person" }, { tag: "person" });
  let text = f.text;
  text = addFieldToTypeText(text, "שם_מלא", "text", { label: { he: "שם מלא" } });
  text = addFieldToTypeText(text, "נולד", "hebrew-date", { label: { he: "תאריך לידה" } });
  text = addFieldToTypeText(text, "תפקיד", "select", { options: ["סופר", "עורך"], label: { he: "תפקיד" } });
  text = addFieldToTypeText(text, "ספרים", "number", { label: { he: "מספר ספרים" } });
  text = addFieldToTypeText(text, "מורה", "relation", { to: "person", label: { he: "מורה" } });
  f = { ...f, text };
  return loadTypeRegistry([f]);
}

const notes = [{ path: "people/רחל.md", fm: { type: "person" }, tags: [] }, { path: "books/x.md", fm: { type: "book" }, tags: [] }];

function Harness({ reg, initial, onText }: { reg: ReturnType<typeof personType>; initial: string; onText: (t: string) => void }) {
  const [text, setText] = useState(initial);
  return (
    <div dir="rtl" lang="he">
      <TypedFields
        reg={reg}
        text={text}
        path="people/לאה.md"
        notes={notes}
        locale="he"
        applyEdit={(edit) =>
          setText((cur) => {
            const next = edit(cur);
            onText(next);
            return next;
          })
        }
      />
    </div>
  );
}

describe("a person in RTL: new note, five fields, save (W12.T2)", () => {
  const reg = personType();
  const made = newTypedNote(reg, "person", { title: "לאה", now: new Date(Date.UTC(2026, 10, 15)) });
  if (!made.ok) throw new Error("no note");
  it("the new note opens with every field of the type and the heading", () => {
    expect(readProperties(made.text).map((p) => p.key)).toEqual(["type", "שם_מלא", "נולד", "תפקיד", "ספרים", "מורה"]);
    expect(made.text.endsWith("\n# לאה\n")).toBe(true);
  });
  it("filling five fields writes them into the frontmatter, the body untouched", async () => {
    document.documentElement.dir = "rtl";
    let saved = made.text;
    const view = render(<Harness reg={reg} initial={made.text} onText={(t) => (saved = t)} />);
    const byLabel = (l: string) => view.getByLabelText(l) as HTMLInputElement;
    fireEvent.change(byLabel("שם מלא"), { target: { value: "לאה גולדברג" } });
    fireEvent.blur(byLabel("שם מלא"));
    fireEvent.change(byLabel("תאריך לידה"), { target: { value: "1911-05-29" } });
    fireEvent.change(byLabel("תפקיד"), { target: { value: "סופר" } });
    fireEvent.change(byLabel("מספר ספרים"), { target: { value: "12" } });
    fireEvent.blur(byLabel("מספר ספרים"));
    fireEvent.change(byLabel("מורה"), { target: { value: "רחל" } });
    fireEvent.blur(byLabel("מורה"));
    await act(async () => undefined);
    const p = Object.fromEntries(readProperties(saved).map((x) => [x.key, x.value]));
    expect(p).toMatchObject({ type: "person", "שם_מלא": "לאה גולדברג", "נולד": "1911-05-29", "תפקיד": "סופר", "ספרים": 12, "מורה": "[[רחל]]" });
    expect(saved.endsWith("\n# לאה\n")).toBe(true);
    // The Hebrew date is shown next to the date input.
    expect(view.container.textContent).toContain("2 בסיוון 5671");
  });
  it("the relation picker suggests only people", () => {
    const view = render(<Harness reg={reg} initial={made.text} onText={() => undefined} />);
    expect([...view.container.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"))).toEqual(["[[רחל]]"]);
  });
  it("a value that does not fit is marked and kept, not removed", () => {
    const bad = made.text.replace("ספרים:", "ספרים: הרבה");
    const view = render(<Harness reg={reg} initial={bad} onText={() => undefined} />);
    const input = view.getByLabelText("מספר ספרים") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.value).toBe("הרבה");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)!.textContent).toMatch(/ספרים is a number/);
  });
  it("axe finds no violations on the form", async () => {
    const view = render(<Harness reg={reg} initial={made.text.replace("ספרים:", "ספרים: הרבה")} onText={() => undefined} />);
    const r = await axe.run(view.container, { rules: { region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    expect(r.passes.length).toBeGreaterThan(5);
  });
});
