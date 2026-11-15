// @vitest-environment node
/**
 * Review Z7-L1 (#938): applyEntityOp checked every file, then wrote them with plain writes. An autosave that landed
 * between the check and the write was replaced. Each file is now written by compare-and-swap under the path's lock,
 * and on the first refusal the files already written go back.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setVaultBackend } from "../../storage/vault";
import { createMemoryBackend } from "../../storage/vault/memory";
import type { VaultBackend } from "../../storage/vault/types";
import * as workspace from "../../storage/workspace";
import { applyEntityOp, EntityWriteConflict } from "../../entities/vaultIo";
import type { OpResult } from "../../entities/review";

let previous: VaultBackend | null = null;
let backend: VaultBackend;
beforeEach(() => {
  backend = createMemoryBackend();
  previous = setVaultBackend(backend);
});
afterEach(() => {
  setVaultBackend(previous);
});

const op = (files: Record<string, string | null>, removed: string[] = []): OpResult =>
  ({
    files: new Map(Object.entries(files)),
    undo: new Map(),
    written: Object.keys(files).filter((p) => files[p] !== null),
    removed,
  }) as unknown as OpResult;

describe("Z7-L1: applyEntityOp is a compare-and-swap per file", () => {
  it("an autosave after the check is kept; the files already written go back; the op fails", async () => {
    await workspace.writeWorkspaceFile("a.md", "A [[Old]]");
    await workspace.writeWorkspaceFile("b.md", "B [[Old]]");
    await workspace.writeWorkspaceFile("c.md", "C [[Old]]");
    const basis = new Map([
      ["a.md", "A [[Old]]"],
      ["b.md", "B [[Old]]"],
      ["c.md", "C [[Old]]"],
    ]);
    // The user's autosave of b.md lands right after the operation's up-front check of b.md has read it.
    const read = backend.read.bind(backend);
    let reads = 0;
    backend.read = async (p: string) => {
      const out = await read(p);
      if (p === "b.md" && ++reads === 1) await workspace.writeWorkspaceFile("b.md", "B [[Old]] typed by the user");
      return out;
    };
    const r = op({ "a.md": "A [[New]]", "b.md": "B [[New]]", "c.md": "C [[New]]" });
    await expect(applyEntityOp(basis, r)).rejects.toBeInstanceOf(EntityWriteConflict);
    backend.read = read;
    expect(await workspace.readWorkspaceFile("b.md")).toBe("B [[Old]] typed by the user");
    expect(await workspace.readWorkspaceFile("a.md")).toBe("A [[Old]]");
    expect(await workspace.readWorkspaceFile("c.md")).toBe("C [[Old]]");
  });

  it("a clean operation writes every file and removes the removed ones", async () => {
    await workspace.writeWorkspaceFile("a.md", "A");
    await workspace.writeWorkspaceFile("gone.md", "G");
    const basis = new Map([
      ["a.md", "A"],
      ["gone.md", "G"],
    ]);
    await applyEntityOp(basis, op({ "a.md": "A2", "new.md": "N" }, ["gone.md"]));
    expect(await workspace.readWorkspaceFile("a.md")).toBe("A2");
    expect(await workspace.readWorkspaceFile("new.md")).toBe("N");
    expect(await workspace.workspaceHasFile("gone.md")).toBe(false);
  });

  it("a file created at a path the operation expected empty is not replaced", async () => {
    const basis = new Map<string, string>();
    const write = backend.write.bind(backend);
    let first = true;
    // Someone creates new.md between the check and the write.
    const stat = backend.stat.bind(backend);
    backend.stat = async (p: string) => {
      const out = await stat(p);
      if (p === "new.md" && first) {
        first = false;
        await write("new.md", "theirs");
      }
      return out;
    };
    await expect(applyEntityOp(basis, op({ "new.md": "mine" }))).rejects.toBeInstanceOf(EntityWriteConflict);
    backend.stat = stat;
    expect(await workspace.readWorkspaceFile("new.md")).toBe("theirs");
  });
});
