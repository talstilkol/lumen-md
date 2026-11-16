/** R8-L6: a template whose chunk fails to load shows an error toast instead of doing nothing. */
import { describe, expect, it, vi } from "vitest";

const toasts = vi.hoisted(() => [] as Array<{ message: string; type?: string }>);
vi.mock("../editor/templates", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});
vi.mock("../ui/AiToast", () => ({ showAiToast: (message: string, type?: string) => toasts.push({ message, type }) }));

import { buildTemplateCommands } from "../commands/domains/file";
import type { CommandContext } from "../commands/domains/context";

describe("built-in template commands", () => {
  it("a failed chunk load ends in an error toast, not an unhandled rejection", async () => {
    const cmds = buildTemplateCommands({ installedTemplates: [] } as unknown as CommandContext);
    const first = cmds.find((c) => c.id.startsWith("template.") && c.id !== "template.importFromFile")!;
    first.action();
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0]!.type).toBe("error");
  });
});
