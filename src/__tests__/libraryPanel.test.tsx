/**
 * Plan 7.6 / W10.E36 — the library panel: opening it brings the index up to
 * date with the vault's clips, a query lists the closest clips, a result
 * opens the clip. The embedder is the synthetic trigram one of
 * libraryIndex.test.ts (no model runs offline); the vault is an in-memory
 * list of notes.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LibraryPanel, toggleLibraryPanel, isLibraryPanelOpen, type LibraryVault } from "../research/library/LibraryPanel";
import type { LibraryDeps, LibraryIndex } from "../research/library/clipIndex";
import { clipToNote } from "../research/clipper";
import { useAppStore } from "../store/useStore";

function vec(text: string, dims = 128): Float32Array {
  const v = new Float32Array(dims);
  const s = ` ${text.toLowerCase()} `;
  for (let i = 0; i + 3 <= s.length; i++) v[((s.charCodeAt(i) * 31 + s.charCodeAt(i + 1)) * 31 + s.charCodeAt(i + 2)) % dims] += 1;
  return v;
}

function deps(): LibraryDeps {
  let stored: LibraryIndex | undefined;
  return {
    embedder: async () => ({ id: "test:tri", embed: async (texts) => texts.map((t) => vec(t)) }),
    load: async () => stored,
    save: async (i) => void (stored = JSON.parse(JSON.stringify(i)) as LibraryIndex),
  };
}

const NOTES: Record<string, string> = {
  "Library/cranes.md": clipToNote({ title: "Cranes over the Hula valley", source: "https://example.org/cranes", body: "Thousands of cranes rest in the Hula valley every autumn on their way to Africa.", date: new Date("2026-11-01") }),
  "Library/bread.md": clipToNote({ title: "Sourdough basics", source: "https://example.com/bread", body: "Feed the starter every day with flour and water.", date: new Date("2026-11-02") }),
  "notes/plan.md": "# Plan\ncranes trip",
};
const vault = (available = true): LibraryVault => ({ available: () => available, list: async () => Object.keys(NOTES), read: async (p) => NOTES[p] });

describe("the library panel", () => {
  beforeEach(() => {
    useAppStore.setState({ openTabs: [], doc: { name: "Welcome.md", content: "", dirty: false } });
  });

  it("indexes the vault's clips on open, finds the closest by meaning, and opens it", async () => {
    render(<LibraryPanel vault={vault()} deps={deps()} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("library-status").textContent).toMatch(/2 clips in the library/));
    fireEvent.change(screen.getByTestId("library-search"), { target: { value: "cranes resting in the valley" } });
    await waitFor(() => expect(screen.getAllByTestId("library-hit").length).toBeGreaterThan(0), { timeout: 3000 });
    const first = screen.getAllByTestId("library-hit")[0];
    expect(first.getAttribute("data-path")).toBe("Library/cranes.md");
    expect(first.textContent).toContain("example.org");
    // The plain note that mentions cranes is not a clip: not listed.
    expect(screen.getAllByTestId("library-hit").map((h) => h.getAttribute("data-path"))).not.toContain("notes/plan.md");
    fireEvent.click(first.querySelector("button")!);
    await waitFor(() => expect(useAppStore.getState().doc.workspaceName).toBe("Library/cranes.md"));
  });

  it("without a vault on this device it says so", async () => {
    render(<LibraryPanel vault={vault(false)} deps={deps()} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("library-status").textContent).toMatch(/needs a vault/));
  });

  it("an embedder that fails shows why", async () => {
    const bad: LibraryDeps = { ...deps(), embedder: async () => Promise.reject(new Error("no embedding model")) };
    render(<LibraryPanel vault={vault()} deps={bad} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("library-status").textContent).toMatch(/not available/));
  });

  it("the command toggles it, as a dialog with a name", async () => {
    await act(async () => toggleLibraryPanel({ vault: vault(), deps: deps() }));
    expect(isLibraryPanelOpen()).toBe(true);
    expect(document.querySelector('[role="dialog"][data-testid="library-panel"]')?.getAttribute("aria-label")).toBe("Reading library");
    await act(async () => toggleLibraryPanel());
    expect(isLibraryPanelOpen()).toBe(false);
    expect(document.getElementById("library-panel-root")).toBeNull();
  });
});
