/**
 * W11.I6: elicitation end to end inside the app's code — a server that asks
 * (the server-everything-shaped fixture, MRTR input_required), the real
 * McpClient, the app's own handler (askElicitation, the dialog the registry
 * wires in) mounted in the document, and the user's click. The server must
 * get exactly what the user chose: accept with the reviewed form, decline,
 * cancel; in URL mode nothing is loaded or opened before the click.
 *
 * The browser e2e of the same flow (e2e/, on the dev server) is owed on the
 * Mac; this test runs the same chain in the DOM.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, act } from "@testing-library/react";
import { McpClient, type JsonRpcMessage, type McpTransport } from "../agents/mcp/client";
import { askElicitation } from "../ui/McpDialogs";
// @ts-expect-error — plain .mjs fixture without types
import { everythingServer } from "./fixtures/mcp/referenceServers.mjs";

type Fixture = { handle(m: JsonRpcMessage): Promise<JsonRpcMessage | null>; log: JsonRpcMessage[] };
const inProcess = (srv: Fixture): McpTransport => ({
  reach: "local",
  binding: "memory",
  async send(msg) {
    return { message: await srv.handle(JSON.parse(JSON.stringify(msg))) };
  },
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

/** Start a tool call that elicits; `user` acts on the dialog once it is up. */
async function callWith(tool: string, args: Record<string, unknown>, user: () => unknown) {
  const srv = everythingServer() as Fixture;
  const client = new McpClient(inProcess(srv), { serverLabel: "My everything", elicit: askElicitation });
  const pending = client.callTool(tool, args);
  await waitFor(() => expect(screen.getByTestId("mcp-elicitation")).toBeTruthy());
  await act(async () => {
    await user();
  });
  const result = await pending;
  const calls = srv.log.filter((m) => m.method === "tools/call");
  return { result, calls, retry: calls[1]?.params as Record<string, unknown> | undefined };
}

describe("elicitation: server → client → the app's dialog → the user's answer → server (W11.I6)", () => {
  it("accept: the form the user reviewed and edited is what the server receives; the dialog is gone", async () => {
    const { result, retry } = await callWith("startElicitation", {}, async () => {
      expect(screen.getByText(/My everything/)).toBeTruthy();
      const inputs = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-testid='mcp-elicitation'] input, [data-testid='mcp-elicitation'] select")];
      expect(inputs.length).toBeGreaterThanOrEqual(3);
      const byName = (k: string) => document.querySelector<HTMLInputElement | HTMLSelectElement>(`#mcp-el-${k}`);
      const color = byName("color");
      const number = byName("number");
      const pets = byName("pets") as HTMLSelectElement | null;
      expect(color && number && pets).toBeTruthy();
      fireEvent.change(color!, { target: { value: "blue" } });
      fireEvent.change(number!, { target: { value: "7" } });
      fireEvent.change(pets!, { target: { value: pets!.options[pets!.options.length - 1].value } });
      fireEvent.click(screen.getByTestId("mcp-el-accept"));
    });
    expect(retry).toMatchObject({ name: "startElicitation", requestState: "state-form-1", inputResponses: { ask: { action: "accept", content: { color: "blue", number: 7 } } } });
    expect(result).toMatchObject({ kind: "complete" });
    expect((result as { text: string }).text).toContain('"color":"blue"');
    expect(screen.queryByTestId("mcp-elicitation")).toBeNull();
  });

  it("decline: the server gets decline with no content, and its own answer is the result", async () => {
    const { result, retry } = await callWith("startElicitation", {}, () => fireEvent.click(screen.getByTestId("mcp-el-decline")));
    expect(retry!.inputResponses).toEqual({ ask: { action: "decline" } });
    expect(result).toMatchObject({ kind: "complete", text: "User declined the request." });
    expect(screen.queryByTestId("mcp-elicitation")).toBeNull();
  });

  it("cancel (the button, and Escape): the server gets cancel", async () => {
    const a = await callWith("startElicitation", {}, () => fireEvent.click(screen.getByTestId("mcp-el-cancel")));
    expect(a.retry!.inputResponses).toEqual({ ask: { action: "cancel" } });
    expect(a.result).toMatchObject({ text: "User cancelled the request." });
    const b = await callWith("startElicitation", {}, () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }));
    expect(b.retry!.inputResponses).toEqual({ ask: { action: "cancel" } });
  });

  it("URL mode: nothing is fetched or opened while the dialog waits; Open opens the full URL outside Lumen, once", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      const { result, retry } = await callWith("authorizeService", { service: "GitHub" }, () => {
        expect(screen.getByTestId("mcp-el-fullurl").textContent).toBe("https://auth.example.com/connect?flow=abc");
        expect(document.querySelectorAll("[data-testid='mcp-elicitation'] a, [data-testid='mcp-elicitation'] img, [data-testid='mcp-elicitation'] iframe").length).toBe(0);
        expect(open).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId("mcp-el-accept"));
      });
      expect(open.mock.calls).toEqual([["https://auth.example.com/connect?flow=abc", "_blank", "noopener,noreferrer"]]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(retry).toMatchObject({ requestState: "state-url-1", inputResponses: { ask: { action: "accept" } } });
      expect(result).toMatchObject({ text: "Connected." });
    } finally {
      fetchSpy.mockRestore();
      open.mockRestore();
    }
  });

  it("URL mode, declined: the page is never opened", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      const { retry } = await callWith("authorizeService", { service: "GitHub" }, () => fireEvent.click(screen.getByTestId("mcp-el-decline")));
      expect(retry!.inputResponses).toEqual({ ask: { action: "decline" } });
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });
});
