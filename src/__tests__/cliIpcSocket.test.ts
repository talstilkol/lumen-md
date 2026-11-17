// @vitest-environment node
/**
 * Review 14 Low 2: where `lumen` and the app meet (mcp-server/src/ipc/endpoint.ts). The /tmp fallback
 * for a long socket path was a fixed name in the shared temp folder, so another user could create it
 * first; it is now inside a per-user 0700 folder, the server refuses a socket folder that is not this
 * user's or that others can write to, and the CLI sends its token only to a socket this user owns.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkSocketDir, endpointFor, ownedSocket } from "../../mcp-server/src/ipc/endpoint";

const uid = process.getuid?.() ?? 0;
const tmp: string[] = [];
const servers: Server[] = [];
const dir = () => {
  const d = mkdtempSync(join(tmpdir(), "lumen-ipc-"));
  tmp.push(d);
  return d;
};
const listen = (p: string) =>
  new Promise<void>((ok) => {
    const s = createServer();
    servers.push(s);
    s.listen(p, () => ok());
  });

afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the lumen socket (review 14 Low 2; Unix sockets)", () => {
  it("a long config path falls back to a per-user folder under the temp folder, never a bare name in it", () => {
    const long = "/home/" + "x".repeat(120);
    const p = endpointFor({ env: { XDG_CONFIG_HOME: long }, platform: "linux", uid: 1234 });
    expect(dirname(p)).toBe(join(tmpdir(), "lumen-cli-1234"));
    expect(p).toMatch(/lumen-cli-1234\/[0-9a-f]{12}\.sock$/);
    expect(endpointFor({ env: { XDG_CONFIG_HOME: long }, platform: "linux", uid: 99 })).not.toBe(p);
    // A short runtime folder is used as before.
    expect(endpointFor({ env: { XDG_RUNTIME_DIR: "/run/user/1234" }, platform: "linux", uid: 1234 })).toBe("/run/user/1234/lumen-cli.sock");
  });

  it("a socket folder must be this user's, not a link, and writable by no one else", async () => {
    const d = dir();
    chmodSync(d, 0o700);
    await expect(checkSocketDir(d)).resolves.toBeUndefined();
    chmodSync(d, 0o777);
    await expect(checkSocketDir(d)).rejects.toThrow(/other users/);
    chmodSync(d, 0o770);
    await expect(checkSocketDir(d)).rejects.toThrow(/other users/);
    chmodSync(d, 0o755);
    await expect(checkSocketDir(d)).resolves.toBeUndefined();
    await expect(checkSocketDir(d, uid + 1)).rejects.toThrow(/another user/);
    const link = join(dir(), "link");
    symlinkSync(d, link);
    await expect(checkSocketDir(link)).rejects.toThrow(/not a folder/);
  });

  it("the CLI talks only to a socket of this user's in such a folder", async () => {
    const d = join(dir(), "s");
    mkdirSync(d, { mode: 0o700 });
    const sock = join(d, "lumen-cli.sock");
    expect(await ownedSocket(sock)).toBe(false); // nothing there
    await listen(sock);
    expect(await ownedSocket(sock)).toBe(true);
    expect(await ownedSocket(sock, uid + 1)).toBe(false); // someone else's
    chmodSync(d, 0o777);
    expect(await ownedSocket(sock)).toBe(false); // a folder anyone can write to
    chmodSync(d, 0o700);
    const plain = join(d, "file.sock");
    mkdirSync(plain);
    expect(await ownedSocket(plain)).toBe(false); // not a socket
  });
});
