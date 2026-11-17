/*
 * Lumen's Tauri isolation app (plan W11.S18, research R3.13). Tauri runs this
 * classic script in a sandboxed iframe and passes every IPC message from the
 * webview to window.__TAURI_ISOLATION_HOOK__ before it reaches Rust. A
 * message the hook throws on is not sent. This is a second wall behind
 * the capability file and the Rust commands' own checks, for an XSS or a
 * hostile dependency in the webview.
 *
 *   - Only the app's own commands (src-tauri/src/lib.rs generate_handler!)
 *     and the plugin commands its capability grants pass.
 *   - Updater, shell, fs, process, http and opener plugin commands never
 *     pass from the webview: updates go through the app's own
 *     lumen_check_update / lumen_install_update, which take no URL.
 *   - A path a vault command names must stay inside the vault: relative, no
 *     "..", no drive letter, no backslash, no NUL.
 *
 * src/__tests__/tauriIsolation.test.ts keeps COMMANDS equal to lib.rs.
 */
(function () {
  "use strict";

  var COMMANDS = [
    "secret_available", "secret_get", "secret_set",
    "vault_root", "vault_pick_folder", "vault_use", "vault_forget", "vault_list", "vault_stat", "vault_read", "vault_write", "vault_snapshot", "vault_mkdir", "vault_rename", "vault_remove", "vault_backup",
    "whisper_status", "whisper_transcribe",
    "shell_ready", "external_read", "external_write", "external_close", "window_new", "tabs_sync", "tab_drag_out", "tab_take", "tab_pending", "tab_accept", "tab_cancel", "tray_set_menu", "capture_format",
    "lumen_check_update", "lumen_install_update", "lumen_set_update_channel",
    "open_presenter_window", "close_presenter_window",
    "zotero_local_get",
    "lan_discovery_host", "lan_discovery_answer", "lan_discovery_stop", "lan_discovery_browse", "lan_discovery_fetch_offer", "lan_discovery_send_answer"
  ];

  /* The plugins the capability file grants (core:default, dialog:default, deep-link:default). */
  var PLUGINS = ["event", "window", "webview", "app", "path", "resources", "image", "menu", "tray", "dialog", "deep-link"];
  /* Never from the webview, whatever a capability file says. */
  var NEVER = ["updater", "shell", "fs", "process", "http", "opener"];

  /* Arguments that name a path inside the vault, per command. */
  var PATH_ARGS = { vault_list: ["dir"], vault_stat: ["path"], vault_read: ["path"], vault_mkdir: ["path"], vault_rename: ["from", "to"], vault_remove: ["path"] };
  /* Raw-body commands carry their path in a header (percent-encoded). */
  var PATH_HEADERS = { vault_write: ["x-vault-path"] };

  function refuse(why) {
    throw new Error("Lumen IPC isolation: " + why);
  }

  /* A path inside the vault root: "" (the root) or a relative path with no way out. */
  function insideVault(p) {
    if (typeof p !== "string") return false;
    if (p === "") return true;
    if (p.indexOf("\u0000") >= 0 || p.indexOf("\\") >= 0) return false;
    if (p.charAt(0) === "/" || /^[A-Za-z]:/.test(p) || /^~/.test(p)) return false;
    var parts = p.split("/");
    for (var i = 0; i < parts.length; i++) if (parts[i] === "..") return false;
    return true;
  }

  function header(options, name) {
    var h = options && options.headers;
    if (!h) return undefined;
    if (typeof h.get === "function") return h.get(name);
    for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k) && k.toLowerCase() === name) return h[k];
    return undefined;
  }

  /** Check one IPC message; returns it unchanged, or throws. */
  function check(message) {
    var cmd = message && message.cmd;
    if (typeof cmd !== "string" || !cmd) refuse("a message without a command");
    var m = /^plugin:([a-z0-9-]+)\|[A-Za-z0-9_-]+$/.exec(cmd);
    if (m) {
      if (NEVER.indexOf(m[1]) >= 0) refuse(cmd + " is not allowed from the webview");
      if (PLUGINS.indexOf(m[1]) < 0) refuse("the " + m[1] + " plugin is not granted");
      return message;
    }
    if (COMMANDS.indexOf(cmd) < 0) refuse("unknown command " + cmd);
    var args = (message.payload && typeof message.payload === "object" && !(message.payload instanceof Uint8Array) && !(message.payload instanceof ArrayBuffer)) ? message.payload : {};
    var names = PATH_ARGS[cmd] || [];
    for (var i = 0; i < names.length; i++) if (!insideVault(args[names[i]])) refuse(cmd + ": " + names[i] + " is outside the vault");
    var hs = PATH_HEADERS[cmd] || [];
    for (var j = 0; j < hs.length; j++) {
      var raw = header(message.options, hs[j]);
      var decoded;
      try {
        decoded = decodeURIComponent(String(raw));
      } catch (e) {
        refuse(cmd + ": " + hs[j] + " is not a valid path");
      }
      if (raw === undefined || !insideVault(decoded)) refuse(cmd + ": " + hs[j] + " is outside the vault");
    }
    return message;
  }

  window.__TAURI_ISOLATION_HOOK__ = function (message) {
    return check(message);
  };
  window.__LUMEN_ISOLATION__ = { COMMANDS: COMMANDS, PLUGINS: PLUGINS, NEVER: NEVER, check: check, insideVault: insideVault };
})();
