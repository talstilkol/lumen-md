/**
 * A stand-in for the app's Rust vault commands (src-tauri/vault): the same
 * command names, argument shapes, raw byte transport and "CODE: message"
 * errors, over the in-memory vault backend. The Rust semantics themselves are
 * tested by `cargo test` in src-tauri/vault.
 */
import { createMemoryBackend, VaultError, type VaultBackend } from "../../storage/vault";
import type { TauriInvoke } from "../../storage/vault/tauri";

export interface FakeTauriVault {
  invoke: TauriInvoke;
  fs: VaultBackend;
  /** The folder the "native dialog" returns next (null = cancelled). */
  nextPick: string | null;
  root: string | null;
  backups: Map<string, Uint8Array>;
  calls: string[];
}

function asRustError(e: unknown): string {
  if (e instanceof VaultError) return `${e.code}: ${e.message}`;
  return `EIO: ${(e as Error).message}`;
}

export function fakeTauriVault(root: string | null = null): FakeTauriVault {
  const self: FakeTauriVault = {
    fs: createMemoryBackend({ id: "rust" }),
    nextPick: "/home/tal/Notes",
    root,
    backups: new Map(),
    calls: [],
    invoke: (async (cmd: string, args?: Record<string, unknown> | Uint8Array, options?: { headers?: Record<string, string> }) => {
      self.calls.push(cmd);
      const a = (args ?? {}) as Record<string, string & boolean>;
      const need = () => {
        if (!self.root) throw "ENOVAULT: no vault folder chosen";
      };
      try {
        switch (cmd) {
          case "vault_root":
            return self.root;
          case "vault_pick_folder":
            if (self.nextPick) self.root = self.nextPick;
            return self.nextPick;
          case "vault_forget":
            self.root = null;
            return null;
          case "vault_backup": {
            const name = decodeURIComponent(options?.headers?.["x-backup-name"] ?? "");
            self.backups.set(name, args as Uint8Array);
            return `/appdata/backups/${name}`;
          }
        }
        need();
        switch (cmd) {
          case "vault_list":
            return await self.fs.list(a.dir);
          case "vault_stat":
            return await self.fs.stat(a.path);
          case "vault_read":
            return await (await self.fs.read(a.path)).arrayBuffer();
          case "vault_write": {
            if (!ArrayBuffer.isView(args)) throw "EINVAL: vault_write expects raw bytes";
            return await self.fs.write(decodeURIComponent(options?.headers?.["x-vault-path"] ?? ""), args);
          }
          case "vault_mkdir":
            return await self.fs.mkdir(a.path);
          case "vault_rename":
            return await self.fs.rename(a.from, a.to, { overwrite: a.overwrite });
          case "vault_remove":
            return await self.fs.remove(a.path);
        }
        throw `EINVAL: unknown command ${cmd}`;
      } catch (e) {
        if (typeof e === "string") throw e;
        throw asRustError(e);
      }
    }) as TauriInvoke,
  };
  return self;
}
