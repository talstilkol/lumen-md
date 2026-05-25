import { describe, it, expect, beforeEach } from "vitest";
import { clearAllLumenLocalStorage } from "../storage/clearLumenState";

describe("clearAllLumenLocalStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes every key with lumen- or lumen. prefix", () => {
    localStorage.setItem("lumen-md", "x");
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen.canvas.last", "scratch");
    localStorage.setItem("lumen.collab.signaling", "wss://x");
    localStorage.setItem("lumen.gdrive.token", '{"access":"a"}');
    localStorage.setItem("lumen-search-history", "[]");

    const cleared = clearAllLumenLocalStorage();
    // Sorted set — order independent
    expect([...cleared].sort()).toEqual(
      [
        "lumen-md",
        "lumen-tour-done",
        "lumen.canvas.last",
        "lumen.collab.signaling",
        "lumen.gdrive.token",
        "lumen-search-history",
      ].sort(),
    );

    // After the call only `lumen-tour-done` should remain (re-asserted).
    expect(localStorage.getItem("lumen-tour-done")).toBe("1");
    expect(localStorage.getItem("lumen-md")).toBeNull();
    expect(localStorage.getItem("lumen.canvas.last")).toBeNull();
    expect(localStorage.getItem("lumen.gdrive.token")).toBeNull();
  });

  it("leaves non-Lumen keys untouched (foreign app state is sacred)", () => {
    localStorage.setItem("lumen-md", "x");
    localStorage.setItem("other-app", "keep me");
    localStorage.setItem("vscode.theme", "dark");
    clearAllLumenLocalStorage();
    expect(localStorage.getItem("other-app")).toBe("keep me");
    expect(localStorage.getItem("vscode.theme")).toBe("dark");
    expect(localStorage.getItem("lumen-md")).toBeNull();
  });

  it("with keepTourDone=false, removes the tour flag too", () => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", "x");
    clearAllLumenLocalStorage({ keepTourDone: false });
    expect(localStorage.getItem("lumen-tour-done")).toBeNull();
    expect(localStorage.getItem("lumen-md")).toBeNull();
  });

  it("is a no-op on empty storage", () => {
    expect(clearAllLumenLocalStorage()).toEqual([]);
    // tour flag was re-set as documented contract
    expect(localStorage.getItem("lumen-tour-done")).toBe("1");
  });
});
