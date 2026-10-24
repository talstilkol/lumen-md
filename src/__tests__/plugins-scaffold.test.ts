/** Plan 11.2.5 — create-lumen-plugin scaffolds a plugin that packs into a valid bundle and runs in the sandbox. */
import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseBundle } from "../plugins/runtime/bundle";
import { createSandbox } from "../plugins/runtime/sandbox";
import { grantsFrom } from "../plugins/runtime/capabilities";

const root = resolve(__dirname, "../..");

describe("create-lumen-plugin", () => {
  it("scaffold → pack → install format → runs with its capabilities", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-scaffold-"));
    try {
      execFileSync("node", [join(root, "packages/create-lumen-plugin/bin.js"), "hello-words"], { cwd: dir, stdio: "pipe" });
      const pdir = join(dir, "hello-words");
      execFileSync("node", ["pack.mjs"], { cwd: pdir, stdio: "pipe" });
      const [file] = readdirSync(join(pdir, "dist"));
      const b = parseBundle(readFileSync(join(pdir, "dist", file), "utf8"));
      expect(b.manifest).toMatchObject({ id: "dev.example.hello-words", name: "Hello Words", main: "main.js" });
      const calls: [string, unknown[]][] = [];
      const sb = await createSandbox({
        manifest: b.manifest,
        code: b.main,
        grants: grantsFrom(b.manifest.capabilities.map((c) => c.id)),
        host: {
          call: async (m, a) => {
            calls.push([m, a]);
            return m === "document.getText" ? "שלום עולם hello" : undefined;
          },
          log: () => undefined,
          fatal: (e) => {
            throw new Error(e);
          },
        },
      });
      await vi.waitFor(() => expect(calls[0]?.[0]).toBe("commands.register"));
      await sb.dispatch("command:run", {});
      expect(calls.map((c) => c[0])).toEqual(["commands.register", "document.getText", "notifications.show"]);
      expect(calls[2][1]).toEqual(["3 words", "info"]);
      sb.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
