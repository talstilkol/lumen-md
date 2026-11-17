/**
 * Plan W13.X1: the MCP stdio allow-list, from the WebView's side.
 *
 * The allow-list itself lives in Rust (src-tauri/mcp-stdio/src/allowlist.rs,
 * `rustc --test`): a program runs only when its resolved absolute path, its
 * sha256, the full argv, the folder and the sha256 of every file an argument
 * names were approved; anything else is refused before a process starts.
 * Those cases (approved vs not, a changed byte, another path, a symlink
 * pointed elsewhere, any other argv or folder, a changed script) are its
 * tests. Here: what the app does with that gate.
 *
 *   • Not approved and declined → `mcp_stdio_spawn` is never called.
 *   • Approved in the dialog → the dialog gets the exact command, argv and
 *     folder, and the UI's language (Hebrew or English).
 *   • A spawn the Rust side refuses (changed since approval) starts nothing
 *     and reads as that refusal, in the user's language.
 *   • Settings: "Check approval" and "Withdraw approval" send the exact
 *     command and never start anything; the statuses and the pinning note
 *     are in Hebrew and English.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { stdioRefusal, stdioTransport, tauriStdioBridge } from "../agents/mcp/transports/stdio";
import { McpClient } from "../agents/mcp/client";
import { McpServers, type StdioApprovals } from "../ui/settings/McpServers";
import { addServer, updateServer } from "../agents/mcp/servers";
import { applyLocale, loadLocale, t } from "../i18n";
import "../ui/mcpServersStrings";

type Call = [string, Record<string, unknown> | undefined];

/** A Tauri invoke that answers like src-tauri/src/mcp_stdio.rs does for one allow-list state. */
function fakeTauri(o: { approved: boolean; userSays?: boolean; spawnRefusal?: string }) {
  const calls: Call[] = [];
  let unlistened = 0;
  const invoke = (async (cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args]);
    if (cmd === "mcp_stdio_approved") return o.approved;
    if (cmd === "mcp_stdio_approve") return o.userSays ?? false;
    if (cmd === "mcp_stdio_spawn") {
      if (o.spawnRefusal) throw o.spawnRefusal;
      return 1;
    }
    return null;
  }) as never;
  const listen = (async () => () => void unlistened++) as never;
  return { calls, invoke, listen, unlistened: () => unlistened };
}

const SPEC = { command: "/opt/mcp/bin/server", args: ["--root", "/home/u/notes"], cwd: "/home/u" };

beforeEach(() => {
  localStorage.clear();
  applyLocale("en");
});
afterEach(() => {
  cleanup();
  applyLocale("en");
});

describe("the bridge asks the allow-list before anything starts", () => {
  it("not approved and declined: the spawn command is never called", async () => {
    const f = fakeTauri({ approved: false, userSays: false });
    const tr = stdioTransport({ id: "x", label: "X" }, SPEC, tauriStdioBridge({ invoke: f.invoke, listen: f.listen, lang: () => "en" }), { reach: "local" });
    const err = await new McpClient(tr).listTools().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(stdioRefusal((err as Error).message)).toBe("not-approved");
    expect(f.calls.map((c) => c[0])).toEqual(["mcp_stdio_approved", "mcp_stdio_approve"]);
    expect(f.calls.some((c) => c[0] === "mcp_stdio_spawn")).toBe(false);
  });

  it("approving sends the dialog the exact command, argv and folder, and the UI's language", async () => {
    for (const lang of ["he", "en"]) {
      const f = fakeTauri({ approved: false, userSays: true });
      const bridge = tauriStdioBridge({ invoke: f.invoke, listen: f.listen, lang: () => lang });
      await bridge.spawn({ id: "x", label: "Files" }, SPEC, () => {});
      expect(f.calls[1]).toEqual(["mcp_stdio_approve", { server: "Files", command: SPEC.command, args: SPEC.args, cwd: SPEC.cwd, lang }]);
      expect(f.calls[2]).toEqual(["mcp_stdio_spawn", { command: SPEC.command, args: SPEC.args, cwd: SPEC.cwd }]);
    }
  });

  it("the document's language reaches the dialog when none is given", async () => {
    document.documentElement.lang = "he";
    const f = fakeTauri({ approved: false, userSays: true });
    await tauriStdioBridge({ invoke: f.invoke, listen: f.listen }).spawn({ id: "x", label: "X" }, SPEC, () => {});
    expect((f.calls[1][1] as { lang: string }).lang).toBe("he");
  });

  it("an approved command whose program changed since is refused by the spawn: nothing starts, the refusal is named", async () => {
    // mcp_stdio_approved said yes (a race), but the pin no longer matches when it starts.
    const f = fakeTauri({ approved: true, spawnRefusal: "changed since approval: the program or a file it is given is not the one you approved; approve it again" });
    const err = await tauriStdioBridge({ invoke: f.invoke, listen: f.listen })
      .spawn({ id: "x", label: "X" }, SPEC, () => {})
      .catch((e: Error) => e);
    expect(stdioRefusal(String((err as Error).message))).toBe("changed");
    expect(f.unlistened()).toBe(1);
    expect(f.calls.some((c) => c[0] === "mcp_stdio_write")).toBe(false);
  });

  it("refusals are told apart from other errors", () => {
    expect(stdioRefusal("not approved: x")).toBe("not-approved");
    expect(stdioRefusal("Error: changed since approval: x")).toBe("changed");
    expect(stdioRefusal("could not start /x: No such file")).toBeNull();
  });
});

function approvalsFake(answer: boolean, revoked = true) {
  const seen: Array<[string, unknown]> = [];
  const a: StdioApprovals = {
    approved: async (s) => (seen.push(["approved", s]), answer),
    revoke: async (s) => (seen.push(["revoke", s]), revoked),
  };
  return { a, seen };
}

function oneStdioServer() {
  addServer({ id: "files", label: "Files", transport: "stdio", command: SPEC.command, args: SPEC.args, cwd: SPEC.cwd, defaultPermission: "ask" });
  updateServer("files", { enabled: true });
}

describe("Settings → MCP servers: the allow-list entry of a program", () => {
  it("Check approval and Withdraw approval send the exact command and start nothing (English)", async () => {
    oneStdioServer();
    const { a, seen } = approvalsFake(true);
    let listed = 0;
    render(<McpServers desktop approvals={a} list={async () => (listed++, [])} />);
    await act(async () => fireEvent.click(screen.getByTestId("mcp-approval-check-files")));
    await waitFor(() => expect(screen.getByTestId("mcp-approval-files").textContent).toBe(t("mcpServers.approval.yes")));
    await act(async () => fireEvent.click(screen.getByTestId("mcp-approval-revoke-files")));
    await waitFor(() => expect(screen.getByTestId("mcp-approval-files").textContent).toBe("Approval withdrawn. Nothing runs until you approve it again."));
    expect(seen).toEqual([
      ["approved", SPEC],
      ["revoke", SPEC],
    ]);
    expect(listed).toBe(0);
  });

  it("Withdraw approval says so when nothing was on the list (review 10, L4)", async () => {
    oneStdioServer();
    const { a } = approvalsFake(true, false);
    render(<McpServers desktop approvals={a} list={async () => []} />);
    await act(async () => fireEvent.click(screen.getByTestId("mcp-approval-revoke-files")));
    await waitFor(() => expect(screen.getByTestId("mcp-approval-files").textContent).toBe("Nothing to withdraw: this program, with these arguments and this folder, was not on the allow-list."));
  });

  it("a program that is not on the allow-list (or changed) says so, in Hebrew", async () => {
    await loadLocale("he");
    applyLocale("he");
    oneStdioServer();
    const { a } = approvalsFake(false);
    render(<McpServers desktop approvals={a} list={async () => []} />);
    expect(screen.getByTestId("mcp-approval-check-files").textContent).toBe("בדיקת האישור");
    await act(async () => fireEvent.click(screen.getByTestId("mcp-approval-check-files")));
    await waitFor(() => expect(screen.getByTestId("mcp-approval-files").textContent).toBe("לא מאושר, או שהתוכנה או קובץ שהיא מקבלת השתנו מאז. לפני שהיא רצה תתבקש לאשר מחדש."));
  });

  it("Show tools on a program the Rust side refused reads as that refusal, in the user's language", async () => {
    await loadLocale("he");
    applyLocale("he");
    oneStdioServer();
    render(
      <McpServers
        desktop
        approvals={approvalsFake(true).a}
        list={async () => {
          throw new Error("changed since approval: the program or a file it is given is not the one you approved; approve it again");
        }}
      />,
    );
    await act(async () => fireEvent.click(screen.getByTestId("mcp-show-tools-files")));
    await waitFor(() => expect(screen.getByText("לא הופעל: התוכנה, או קובץ שהיא מקבלת, השתנו מאז שאישרת. כדי להריץ צריך לאשר מחדש.")).toBeTruthy());
  });

  it("the web app shows no approval controls (stdio is desktop only); the form says what an approval pins", () => {
    oneStdioServer();
    render(<McpServers desktop={false} approvals={approvalsFake(true).a} />);
    expect(screen.queryByTestId("mcp-approval-check-files")).toBeNull();
    fireEvent.click(screen.getByTestId("mcp-form-stdio"));
    expect(screen.getByText(/exact program file \(its full path and sha256\)/)).toBeTruthy();
  });
});
