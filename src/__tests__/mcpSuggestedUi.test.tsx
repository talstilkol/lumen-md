/**
 * W10.C3 (plan W7.18): the suggested MCP servers in Settings → MCP servers.
 *
 *   • Each card says what the server is, its licence, what it reaches, that
 *     every tool asks before it runs, and whether it is an address or a
 *     program you install — in Hebrew and in English (the strings exist in
 *     both, for every suggestion).
 *   • "Use" fills the form and nothing else: 0 connections, 0 tool listings,
 *     0 approval checks, 0 requests, nothing saved — for every suggestion.
 *     Focus goes to the form's first field and a status line says the form
 *     was filled (never to <body>).
 *   • A suggestion already added says so and cannot be added twice.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServers } from "../ui/settings/McpServers";
import { SUGGESTED } from "../agents/mcp/suggested";
import { addServer, readServers } from "../agents/mcp/servers";

const ROOT = join(__dirname, "..", "..");
const json = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as Record<string, string>;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("suggested MCP servers (W10.C3)", () => {
  it("lists every suggestion with its licence, what it reaches, that each tool asks, and how it runs", () => {
    render(<McpServers list={vi.fn()} desktop />);
    expect(SUGGESTED.length).toBeGreaterThan(0);
    for (const s of SUGGESTED) {
      const chips = screen.getByTestId(`mcp-suggested-chips-${s.id}`).textContent ?? "";
      expect(chips, s.id).toMatch(s.license === "unverified" ? /Licence not checked/ : new RegExp(`Licence: ${s.license}`));
      expect(chips, s.id).toMatch(s.reaches === "network" ? /internet/ : s.reaches === "your files" ? /folders/ : /this computer/);
      expect(chips, s.id).toMatch(/asks before it runs/);
      expect(chips, s.id).toMatch(s.transport === "stdio" ? /program you install/ : /An address/);
      expect(screen.getByTestId(`mcp-suggested-${s.id}`).textContent, s.id).toMatch(/Where to get it:/);
    }
  });

  it("every suggestion's name, description and source are in English and in Hebrew", () => {
    const en = json("src/i18n/lazy/mcpServers.json");
    const he = json("src/i18n/locales/he/common.json");
    for (const s of SUGGESTED) {
      const keys = ["name", "about", "source", ...(s.install ? ["install"] : [])].map((k) => `mcpServers.s.${s.id}.${k}`);
      for (const k of keys) {
        expect(en[k], k).toBeTruthy();
        expect(he[k], k).toBeTruthy();
      }
      // The Hebrew description is Hebrew, not the English copied over.
      expect(he[`mcpServers.s.${s.id}.about`], s.id).toMatch(/[א-ת]/);
    }
  });

  it("'Use' fills the form for each suggestion and makes 0 connections, 0 listings, 0 requests; focus goes to the form", async () => {
    const list = vi.fn(async () => []);
    const approvals = { approved: vi.fn(async () => true), revoke: vi.fn(async () => true) };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const ws = vi.fn();
    const RealWs = globalThis.WebSocket;
    (globalThis as { WebSocket: unknown }).WebSocket = ws;
    try {
      render(<McpServers list={list} desktop approvals={approvals} />);
      for (const s of SUGGESTED) {
        const use = screen.getByTestId(`mcp-use-${s.id}`);
        use.focus();
        await act(async () => {
          fireEvent.click(use);
          await Promise.resolve();
        });
        expect((screen.getByTestId("mcp-form-id") as HTMLInputElement).value, s.id).toBe(s.id);
        expect(document.activeElement, s.id).toBe(screen.getByTestId("mcp-form-id"));
        const status = screen.getByTestId("mcp-filled");
        expect(status.getAttribute("role")).toBe("status");
        expect(status.textContent, s.id).toMatch(/filled from .+Nothing is connected/);
        if (s.transport === "stdio") expect((screen.getByTestId("mcp-form-command") as HTMLInputElement).value).toBe(s.command);
        else expect((screen.getByTestId("mcp-form-url") as HTMLInputElement).value).toBe(s.url ?? "");
      }
      expect(list).not.toHaveBeenCalled();
      expect(approvals.approved).not.toHaveBeenCalled();
      expect(approvals.revoke).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(ws).not.toHaveBeenCalled();
      expect(readServers()).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
      (globalThis as { WebSocket: unknown }).WebSocket = RealWs;
    }
  });

  it("a suggestion already added says so and cannot be used again", () => {
    addServer({ id: "files", label: "Files", transport: "stdio", command: "mcp-server-filesystem", args: [], defaultPermission: "ask" });
    render(<McpServers list={vi.fn()} desktop />);
    const use = screen.getByTestId("mcp-use-files") as HTMLButtonElement;
    expect(use.disabled).toBe(true);
    expect(use.textContent).toMatch(/Already added/);
    expect((screen.getByTestId("mcp-use-everything") as HTMLButtonElement).disabled).toBe(false);
  });

  it("in the browser, a program suggestion says it runs only in the desktop app", () => {
    render(<McpServers list={vi.fn()} desktop={false} />);
    const program = SUGGESTED.find((s) => s.transport === "stdio")!;
    const address = SUGGESTED.find((s) => s.transport === "http")!;
    expect(screen.getByTestId(`mcp-suggested-${program.id}`).textContent).toMatch(/only in the desktop app/);
    expect(screen.getByTestId(`mcp-suggested-${address.id}`).textContent).not.toMatch(/only in the desktop app/);
  });

  it("its buttons and fields have a visible box (not bare under preflight)", () => {
    render(<McpServers list={vi.fn()} desktop />);
    for (const el of [screen.getByTestId("mcp-use-files"), screen.getByTestId("mcp-form-save"), screen.getByTestId("mcp-form-id")]) {
      expect(el.style.border, el.getAttribute("data-testid") ?? "").toMatch(/1px solid/);
      expect(el.style.padding, el.getAttribute("data-testid") ?? "").not.toBe("");
    }
  });
});
