/**
 * Installed marketplace templates (OPFS `templates/<id>.md`) must surface
 * in ⌘K next to the built-in TEMPLATES. We mock the workspace layer so the
 * test is hermetic (no OPFS in jsdom).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const ws = vi.hoisted(() => ({
  files: new Map<string, string>(),
}));

vi.mock("../storage/workspace", () => ({
  isOPFSAvailable: () => true,
  listWorkspace: vi.fn(async () =>
    [...ws.files.keys()].map((path) => ({
      path,
      name: path.split("/").pop() ?? path,
      size: ws.files.get(path)!.length,
      modified: 0,
    })),
  ),
  readWorkspaceFile: vi.fn(async (path: string) => {
    const body = ws.files.get(path);
    if (body === undefined) throw new Error(`ENOENT ${path}`);
    return body;
  }),
  writeWorkspaceFile: vi.fn(async (path: string, body: string) => {
    ws.files.set(path, body);
  }),
}));

import {
  installTemplate,
  listInstalledTemplates,
  type MarketplaceTemplate,
} from "../storage/templateMarketplace";
import {
  buildInstalledTemplateCommands,
  useInstalledTemplates,
} from "../commands/installedTemplates";

const TPL: MarketplaceTemplate = {
  id: "weekly-review",
  name: "Weekly Review",
  category: "Reflection",
  author: "Lumen Team",
  description: "",
  icon: "🗓️",
  version: "1.0.0",
  url: "templates/weekly-review.md",
  rating: 5,
  downloads: 0,
  tags: [],
};

beforeEach(() => {
  ws.files.clear();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, text: async () => "# Weekly review\n" })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listInstalledTemplates", () => {
  it("lists only top-level .md files under templates/, using the install-time name", async () => {
    ws.files.set("notes/a.md", "x");
    ws.files.set("templates/nested/deep.md", "x");
    ws.files.set("templates/readme.txt", "x");
    ws.files.set("templates/my-own_thing.md", "# mine");
    await installTemplate(TPL);
    const list = await listInstalledTemplates();
    expect(list).toEqual([
      { id: "my-own_thing", name: "My own thing", path: "templates/my-own_thing.md" },
      { id: "weekly-review", name: "Weekly Review", path: "templates/weekly-review.md" },
    ]);
  });
});

describe("buildInstalledTemplateCommands", () => {
  it("creates one ⌘K command per installed template that applies its body", async () => {
    ws.files.set("templates/weekly-review.md", "# Weekly review\n");
    const apply = vi.fn();
    const cmds = buildInstalledTemplateCommands(
      [{ id: "weekly-review", name: "Weekly Review", path: "templates/weekly-review.md" }],
      { groupLabel: "Templates", hint: "Installed", apply },
    );
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({
      id: "template.installed.weekly-review",
      label: "Templates: Weekly Review",
      group: "Templates",
      hint: "Installed",
    });
    cmds[0].action();
    await waitFor(() => expect(apply).toHaveBeenCalledWith("Weekly Review", "# Weekly review\n"));
  });

  it("reports read failures through onError", async () => {
    const onError = vi.fn();
    const [cmd] = buildInstalledTemplateCommands(
      [{ id: "gone", name: "Gone", path: "templates/gone.md" }],
      { groupLabel: "Templates", hint: "", apply: vi.fn(), onError },
    );
    cmd.action();
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});

describe("useInstalledTemplates", () => {
  it("loads asynchronously and refreshes after an install", async () => {
    const { result } = renderHook(() => useInstalledTemplates());
    await waitFor(() => expect(result.current).toEqual([]));
    await act(async () => {
      await installTemplate(TPL);
    });
    await waitFor(() =>
      expect(result.current.map((t) => t.id)).toEqual(["weekly-review"]),
    );
  });
});
