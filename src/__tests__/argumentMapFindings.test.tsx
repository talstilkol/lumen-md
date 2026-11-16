/**
 * W13.W8 in the argument map (W12.V4): the argument checker's findings per
 * claim show as a badge on the map and as a line in the list (readable by a
 * screen reader), axe clean in both directions.
 */
import { describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import axe from "axe-core";
import { argumentGraph, type ArgNoteInput } from "../argument/argumentMap";
import { ArgumentMapView, frontmatterOf } from "../viz/ArgumentMapBlock";
import { mapFindings } from "../agents/writing/argument/argumentChecker";
import "../i18n/lazy/viz.json";

const note = (path: string, fm: string, body: string) => ({ input: { path, fm: frontmatterOf(`---\n${fm}\n---\n`) } as ArgNoteInput, text: `---\n${fm}\n---\n\n${body}` });
const NOTES = [
  note("מחקר/מקור.md", "type: evidence\nsupports: ['[[השכר עלה]]']", "דוח הלמ״ס."),
  note("מחקר/השכר עלה.md", "type: claim", "כולם יודעים שהשכר עלה."),
  note("מחקר/השערה.md", "type: claim", "ההשערה נבדקת."),
];

describe("argument-checker findings on the map", () => {
  const inputs = NOTES.map((n) => n.input);
  const g = argumentGraph(inputs);
  const findings = mapFindings(NOTES.map((n) => ({ path: n.input.path, text: n.text })), inputs);
  it("counts per claim: a fallacy on one, the map's own flag on the other", () => {
    expect(findings.get("מחקר/השכר עלה.md")?.kinds).toEqual(["appeal-to-popularity"]);
    expect(findings.get("מחקר/השערה.md")?.kinds).toEqual(["map-unsupported"]);
    expect(findings.has("מחקר/מקור.md")).toBe(false);
  });
  for (const dir of ["rtl", "ltr"] as const)
    it(`${dir}: a badge on the node, a line in the list, axe clean`, async () => {
      const { container, getByRole } = render(
        <div dir={dir} lang={dir === "rtl" ? "he" : "en"}>
          <ArgumentMapView g={g} dir={dir} title="מפה" onOpen={() => {}} findings={findings} />
        </div>,
      );
      expect(container.querySelector('[data-node="מחקר/השכר עלה.md"] [data-findings]')!.getAttribute("data-findings")).toBe("1");
      act(() => {
        fireEvent.click(getByRole("button", { expanded: false }));
      });
      const line = container.querySelector('[data-claim="מחקר/השכר עלה.md"] [data-findings]')!;
      expect(line.textContent).toContain("1 logic findings");
      expect((await axe.run(container, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
    });
  it("without findings, no badge (the map as before)", () => {
    const { container } = render(<ArgumentMapView g={g} dir="ltr" title="m" onOpen={() => {}} />);
    expect(container.querySelector("[data-findings]")).toBeNull();
  });
});
