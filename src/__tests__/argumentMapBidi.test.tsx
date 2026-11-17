/**
 * W12.V4, wave g5: the argument map in a real browser (headless Chromium,
 * the shim's runner), beyond the walk in argumentMap.test.tsx:
 *
 *  - a note name with a left-to-right run inside Hebrew ("דוח OECD על C++
 *    ושכר") keeps its order: the run is isolated (src/graph/labels.ts
 *    prepareLabel). With only the whole label isolated, the bidi algorithm
 *    drew "C++" as "++C" in the SVG and in the list.
 *  - a long name with niqqud is shortened by grapheme: no mark loses its
 *    letter.
 *  - the keyboard's place is visible: the node the arrows reached has a
 *    ring, and focus stays on the map.
 * The notes are synthetic (written here).
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ArgumentMapView } from "../viz/ArgumentMapBlock";
import { argumentGraph, layoutArgument, readingOrder } from "../argument/argumentMap";
import { FSI, PDI, orphanMarks } from "../graph/labels";

afterEach(cleanup);

const NOTES = [
  { path: "מחקר/שכר המינימום מעלה תעסוקה.md", fm: { type: "claim", conclusion: true } },
  { path: "מחקר/דוח OECD על C++ ושכר.md", fm: { type: "evidence", contradicts: ["[[שכר המינימום מעלה תעסוקה]]"] } },
  { path: "מחקר/מחקר בנק ישראל (2019).md", fm: { type: "evidence", supports: ["[[שכר המינימום מעלה תעסוקה]]"] } },
  { path: "מחקר/טַעֲנָה בְּלִי מָקוֹר עִם נִקּוּד אָרֹךְ מְאֹד מְאֹד.md", fm: { type: "claim" } },
];

describe("argument map labels and focus (RTL)", () => {
  const g = argumentGraph(NOTES);

  it("a Latin run inside a Hebrew name is isolated, in the map and in the list", () => {
    const { container, getByRole } = render(
      <div dir="rtl" lang="he">
        <ArgumentMapView g={g} dir="rtl" title="מפה" onOpen={() => {}} />
      </div>,
    );
    const svgText = container.querySelector('[data-node="מחקר/דוח OECD על C++ ושכר.md"] text')!;
    expect(svgText.getAttribute("direction")).toBe("rtl");
    expect(svgText.textContent).toContain(`${FSI}C++${PDI}`);
    act(() => {
      fireEvent.click(getByRole("button", { expanded: false }));
    });
    const link = [...container.querySelectorAll(".lumen-viz-arg-link")].find((b) => b.textContent!.includes("OECD"))!;
    expect(link.textContent).toContain(`${FSI}C++${PDI}`);
    expect(link.getAttribute("dir")).toBe("rtl");
  });

  it("a long name with niqqud is cut between letters, never inside one", () => {
    const { container } = render(<ArgumentMapView g={g} dir="rtl" title="מפה" onOpen={() => {}} />);
    const source = "טַעֲנָה בְּלִי מָקוֹר עִם נִקּוּד אָרֹךְ מְאֹד מְאֹד";
    const shown = container.querySelector(`[data-node="מחקר/${source}.md"] text`)!.textContent!;
    expect(shown.endsWith("…")).toBe(true);
    expect(orphanMarks(source, shown)).toBe(0);
  });

  it("the node the arrows reach is ringed, focus stays on the map, and leaving the map clears the ring", () => {
    const { container } = render(
      <div dir="rtl">
        <ArgumentMapView g={g} dir="rtl" title="מפה" onOpen={() => {}} />
        <button type="button">אחרי</button>
      </div>,
    );
    const plot = container.querySelector("[data-viz-plot]") as HTMLElement;
    plot.focus();
    const order = readingOrder(layoutArgument(g));
    act(() => {
      fireEvent.keyDown(plot, { key: "ArrowLeft" });
    });
    act(() => {
      fireEvent.keyDown(plot, { key: "ArrowLeft" });
    });
    const ringed = container.querySelectorAll("[data-active-ring]");
    expect(ringed).toHaveLength(1);
    expect(ringed[0].closest("[data-node]")!.getAttribute("data-node")).toBe(order[1]);
    expect(document.activeElement).toBe(plot);
    act(() => {
      fireEvent.blur(plot);
    });
    expect(container.querySelectorAll("[data-active-ring]")).toHaveLength(0);
  });
});
