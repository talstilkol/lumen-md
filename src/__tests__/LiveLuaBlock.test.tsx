/**
 * Live Lua block — fence routing + idle render. The runtime itself is
 * covered in liveLua.test.ts (real wasmoon, Node environment); Workers
 * don't exist in jsdom, so here we only pin what renders before Run.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import LiveLuaBlock from "../plugins/LiveLuaBlock";
import { renderMarkdown } from "../renderer/pipeline";
import { components } from "../renderer/components";
import { readFileSync } from "node:fs";
import { join } from "node:path";

afterEach(cleanup);

/** Langs of every element in the rendered tree that mounts the Live Lua block. */
async function luaBlockLangs(src: string): Promise<string[]> {
  const target = (components as Record<string, unknown>)["lumen-livelua"];
  const found: string[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    const props = n.props as { lang?: string; children?: ReactNode };
    if (n.type === target) found.push(String(props.lang));
    walk(props.children);
  };
  walk(await renderMarkdown(src, () => false));
  return found;
}

const target = () => (components as Record<string, unknown>)["lumen-livelua"];

describe("live-lua fence routing", () => {
  it("routes live-lua / lua-live to the Live Lua block, plain lua stays code", async () => {
    expect(target()).toBeTruthy();
    expect(await luaBlockLangs("```live-lua\nprint(1)\n```")).toEqual(["live-lua"]);
    expect(await luaBlockLangs("```lua-live\nprint(1)\n```")).toEqual(["lua-live"]);
    expect(await luaBlockLangs("```lua\nprint(1)\n```")).toEqual([]);
  });

  it("is offered in the insert / slash menu", () => {
    // ENTRIES is module-private; pin the entry in the source instead.
    const src = readFileSync(join(__dirname, "..", "editor", "insertMenu.ts"), "utf8");
    expect(src).toMatch(/id: "live-lua",[\s\S]{0,200}template: '```live-lua/);
  });
});

describe("LiveLuaBlock", () => {
  it("renders Run and the idle prompt without starting a worker", () => {
    render(<LiveLuaBlock source={"print(1+1)"} />);
    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
    expect(screen.getByText(/Click Run to execute this Lua block/)).toBeTruthy();
    expect(screen.getByText(/Lua: Not run/)).toBeTruthy();
  });

  it("toggles the source view", () => {
    render(<LiveLuaBlock source={"local x = 41 + 1"} meta="height=120" />);
    fireEvent.click(screen.getByRole("button", { name: /source/i }));
    expect(screen.getByText(/local x = 41 \+ 1/)).toBeTruthy();
  });
});
