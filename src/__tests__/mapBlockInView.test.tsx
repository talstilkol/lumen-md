import { describe, it, expect, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";

const mapCalls: unknown[] = [];
vi.mock("../plugins/map/leaflet", () => {
  const chain = (): Record<string, unknown> => ({ addTo: () => chain(), bindPopup: () => chain(), getBounds: () => ({ isValid: () => false }) });
  const L = {
    map: (...args: unknown[]) => {
      mapCalls.push(args);
      return { setView: () => ({}), remove: () => {}, fitBounds: () => {} };
    },
    tileLayer: () => chain(),
    marker: () => chain(),
    geoJSON: () => chain(),
  };
  return { getLeaflet: async () => L };
});

describe("MapBlock", () => {
  it("initializes Leaflet once the block scrolls into view", async () => {
    let trigger: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
          trigger = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const { default: MapBlock } = await import("../plugins/MapBlock");
    render(<MapBlock source={"markers:\n  - { lat: 32.08, lng: 34.78, label: TLV }"} lang="map" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(mapCalls).toHaveLength(0); // not in view yet: nothing loaded
    act(() => trigger?.([{ isIntersecting: true }]));
    await waitFor(() => expect(mapCalls).toHaveLength(1));
    vi.unstubAllGlobals();
  });
});
