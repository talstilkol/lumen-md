/**
 * Plan W11.S18 (research R3.13): every Tauri capability file against its
 * snapshot, and the isolation app that lets only the app's own IPC commands
 * through, keeps vault paths inside the vault, and refuses updater and
 * shell commands from the webview.
 *
 * The isolation script runs here in a Node vm with a bare `window` object,
 * the same classic script Tauri loads in its sandboxed iframe. The messages
 * are built in the test in the shape Tauri passes ({ cmd, payload, options }).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
// @ts-expect-error — plain .mjs module without type declarations
import { FORBIDDEN, enable, isolationCommands, normalise, problems, readCapabilities, rustCommands } from "../../scripts/tauri-isolation.mjs";

type Iso = { check: (m: unknown) => unknown; COMMANDS: string[]; insideVault: (p: unknown) => boolean };
function loadIsolation() {
  const window: Record<string, unknown> = {};
  runInNewContext(readFileSync("src-tauri/isolation/index.js", "utf8"), { window, decodeURIComponent, Uint8Array, ArrayBuffer });
  return { hook: window.__TAURI_ISOLATION_HOOK__ as (m: unknown) => unknown, iso: window.__LUMEN_ISOLATION__ as Iso };
}

describe("capability files (snapshot)", () => {
  it("each file matches its committed snapshot, and none grants updater, shell, fs, process, http or opener", () => {
    expect(problems(".")).toEqual([]);
    const caps = readCapabilities(".");
    expect(Object.keys(caps)).toEqual(Object.keys(JSON.parse(readFileSync("security/tauri-capabilities.snapshot.json", "utf8"))));
    for (const cap of Object.values(caps) as Array<{ permissions: string[] }>) for (const p of cap.permissions) for (const f of FORBIDDEN) expect(p.startsWith(f), p).toBe(false);
  });

  it("a changed or widened capability fails until it is reviewed and the snapshot rewritten", () => {
    const snap = JSON.parse(readFileSync("security/tauri-capabilities.snapshot.json", "utf8"));
    const widened = normalise({ ...JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8")), permissions: ["core:default", "updater:default"] });
    expect(JSON.stringify(widened)).not.toBe(JSON.stringify(snap["default.json"]));
    expect(widened.permissions.some((p: string) => FORBIDDEN.some((f: string) => p.startsWith(f)))).toBe(true);
  });
});

describe("the isolation app", () => {
  const { hook, iso } = loadIsolation();

  it("allows exactly the app's own commands (lib.rs generate_handler!)", () => {
    const rs = rustCommands(".");
    expect(rs.length).toBeGreaterThan(30);
    expect([...isolationCommands(".")].sort()).toEqual([...rs].sort());
    expect([...iso.COMMANDS].sort()).toEqual([...rs].sort());
    for (const cmd of ["secret_available", "lumen_check_update", "tabs_sync", "plugin:dialog|open", "plugin:window|show", "plugin:event|listen"]) expect(hook({ cmd, payload: {} }), cmd).toEqual({ cmd, payload: {} });
  });

  it("refuses an IPC command not on the list", () => {
    expect(() => hook({ cmd: "vault_format_disk", payload: {} })).toThrow(/unknown command vault_format_disk/);
    expect(() => hook({ cmd: "plugin:sql|execute", payload: {} })).toThrow(/sql plugin is not granted/);
    expect(() => hook({})).toThrow(/without a command/);
  });

  it("refuses every updater and shell command from the webview (and fs, process, http, opener)", () => {
    for (const cmd of ["plugin:updater|check", "plugin:updater|download_and_install", "plugin:shell|open", "plugin:shell|execute", "plugin:fs|read_file", "plugin:process|restart", "plugin:http|fetch", "plugin:opener|open_url"]) expect(() => hook({ cmd, payload: {} }), cmd).toThrow(/is not allowed from the webview/);
  });

  it("refuses a vault path outside the vault, in arguments and in a raw write's header", () => {
    const root = "/Users/me/Vault";
    expect(hook({ cmd: "vault_read", payload: { root, path: "notes/a.md" } })).toBeTruthy();
    expect(hook({ cmd: "vault_list", payload: { root, dir: "" } })).toBeTruthy();
    for (const path of ["../secrets", "notes/../../x", "/etc/passwd", "C:/Windows/x", "notes\\..\\x", "~/x", "a\u0000b", 5]) expect(() => hook({ cmd: "vault_read", payload: { root, path } }), String(path)).toThrow(/outside the vault/);
    expect(() => hook({ cmd: "vault_rename", payload: { root, from: "a.md", to: "../a.md", overwrite: false } })).toThrow(/to is outside/);
    const write = (p: string | undefined) => ({ cmd: "vault_write", payload: new Uint8Array([1, 2]), options: { headers: { "X-Vault-Root": encodeURIComponent(root), ...(p === undefined ? {} : { "x-vault-path": p }) } } });
    expect(hook(write(encodeURIComponent("שלום/a.md")))).toBeTruthy();
    expect(() => hook(write(encodeURIComponent("../../a.md")))).toThrow(/x-vault-path is outside/);
    expect(() => hook(write(undefined))).toThrow(/x-vault-path is outside/);
    expect(() => hook(write("%E0%A4%A"))).toThrow(/not a valid path/);
  });
});

describe("turning the pattern on (owner, with network)", () => {
  it("sets app.security.pattern to the isolation app and adds tauri's isolation feature, once", () => {
    const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
    const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
    // Not on yet: the feature's crates (aes-gcm) are not in Cargo.lock, which needs the network.
    expect(conf.app.security.pattern).toBeUndefined();
    expect(readFileSync("src-tauri/Cargo.lock", "utf8")).not.toMatch(/^name = "aes-gcm"$/m);
    const on = enable(conf, cargo);
    expect(on.conf.app.security.pattern).toEqual({ use: "isolation", options: { dir: "isolation" } });
    expect(on.conf.app.security.csp).toBe(conf.app.security.csp);
    expect(on.cargo).toMatch(/^tauri = \{ version = "2", features = \["tray-icon", "isolation"\] \}$/m);
    expect(enable(on.conf, on.cargo).cargo).toBe(on.cargo);
  });
});
