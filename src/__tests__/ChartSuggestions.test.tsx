import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../plugins/EChart", () => ({
  EChart: ({ option }: { option: { series: Array<{ type: string }> } }) => (
    <div data-testid="echart">{option.series.map((s) => s.type).join(",")}</div>
  ),
}));
vi.mock("../plugins/MapBlock", () => ({
  default: ({ source }: { source: string }) => <div data-testid="map">{source}</div>,
}));

import { ChartSuggestions } from "../plugins/ChartSuggestions";
import { suggestCharts } from "../data/suggest";
import { parseCSV } from "../data/csv";

describe("ChartSuggestions", () => {
  it("shows ranked alternatives with the active chart's reason and switches on click", () => {
    const ds = parseCSV("team,points\nA,10\nB,15\nC,20\nD,5");
    const suggestions = suggestCharts(ds);
    render(<ChartSuggestions suggestions={suggestions} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(suggestions.length);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("chart-reason").textContent).toBe(suggestions[0].reason);
    expect(screen.getByTestId("echart").textContent).toBe("bar");

    const pieIdx = suggestions.findIndex((s) => s.kind === "pie");
    fireEvent.click(tabs[pieIdx]);
    expect(tabs[pieIdx].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("chart-reason").textContent).toBe(suggestions[pieIdx].reason);
    expect(screen.getByTestId("echart").textContent).toBe("pie");
  });

  it("renders the map block for coordinate data", async () => {
    const ds = parseCSV("city,lat,lng\nTel Aviv,32.0853,34.7818\nHaifa,32.794,34.9896");
    render(<ChartSuggestions suggestions={suggestCharts(ds)} />);
    const map = await screen.findByTestId("map");
    expect(JSON.parse(map.textContent ?? "{}").markers).toHaveLength(2);
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(<ChartSuggestions suggestions={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
