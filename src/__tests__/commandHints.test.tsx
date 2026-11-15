/**
 * The commands' hints load on demand (commands/hints.ts, train 7): a
 * command built before their English is registered holds the key, and
 * every place that shows or searches a hint resolves it then. Other hints
 * (translated text, a time, a path) pass through unchanged.
 */
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { t } from "../i18n";
import { loadCommandHints, shownHint, useCommandHints } from "../commands/hints";
import { matchScore } from "../ui/paletteSearch";

const lazy = JSON.parse(readFileSync("src/i18n/lazy/cmdHints.json", "utf8")) as Record<string, string>;

function Hint({ open, hint }: { open: boolean; hint: string }) {
  useCommandHints(open);
  return <span data-testid="hint">{shownHint(hint)}</span>;
}

describe("command hints on demand", () => {
  it("every lazy key is a command hint", () => {
    expect(Object.keys(lazy).length).toBeGreaterThan(200);
    for (const k of Object.keys(lazy)) expect(k).toMatch(/^cmd\.[\w.-]+\.hint$/);
  });

  it("other hints pass through", () => {
    expect(shownHint(undefined)).toBeUndefined();
    expect(shownHint("3 minutes ago")).toBe("3 minutes ago");
    expect(shownHint("notes/cmd.a.hint.md")).toBe("notes/cmd.a.hint.md");
  });

  it("a key built before the strings loaded shows as English once a menu that shows hints opens", async () => {
    const key = "cmd.view.zen.hint" in lazy ? "cmd.view.zen.hint" : Object.keys(lazy)[0];
    const built = t(key); // what a command built at start-up holds
    const { rerender } = render(<Hint open={false} hint={built} />);
    await act(async () => rerender(<Hint open hint={built} />));
    await act(() => loadCommandHints());
    expect(screen.getByTestId("hint").textContent).toBe(t(key));
    expect(t(key)).toBe(lazy[key]);
    // The palette's search reads the hint as shown.
    const word = lazy[key].split(/\s+/).find((w) => w.length > 4)!.toLowerCase();
    expect(matchScore({ label: "zzz", hint: built }, word)).toBe(1);
  });
});
