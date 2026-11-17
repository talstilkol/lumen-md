---
title: Desktop app updates
description: How the Lumen desktop app checks for, verifies and installs updates, and what it sends.
type: how-to
---

The desktop app (Windows, macOS, Linux) updates itself from the project's
GitHub releases.

- **Check:** command palette → **Check for updates…**. A stable build never
  checks on its own. A beta build checks once a day at launch, unless you
  turn that off under [feature flags](/getting-started/beta/).
- **Channel:** command palette → **Update channel: switch between stable and beta** switches between stable
  and beta releases ([beta channel](/getting-started/beta/)).
- **What is sent:** one request to the release server with the app version
  and platform. No notes, no account, no identifier. It appears in the
  privacy log.
- **Local only:** when the privacy policy is *local only*, nothing is
  checked. The command says so instead.
- **Verification:** every update is signed. The app checks the signature
  against the key built into it and refuses a file that doesn't match, or an
  older version presented as new.
- **Install:** after you confirm, Lumen downloads, verifies, installs and restarts.

A build without the update key (local and development builds) has no
updater. *Check for updates…* says it isn't configured, and new versions are
installed by hand.

## Signed installers

Release installers are code-signed once the project's signing certificates
are in place (Windows Authenticode, Apple Developer ID). Until then Windows
SmartScreen and macOS Gatekeeper show a warning on first launch.

**Windows: SignPath Foundation (plan W11.S15).** Smart App Control blocks
unsigned apps, and Microsoft's own Artifact Signing isn't open to an
individual in Israel. SignPath Foundation signs OSI-licensed open-source
projects for free, with its certificate. Lumen is MIT, which is
OSI-approved. No EV certificate is needed. The application is an owner step
(W11.O1).

- `npm run release` passes SignPath to Tauri as the Windows `signCommand`
  (`scripts/windows/signpath-sign.mjs`) when the four `SIGNPATH_*` values are
  set. Each signing request then waits for its approval at SignPath.
- After the build, every Windows installer is checked
  (`scripts/windows/verify-signature.mjs`): it must carry an Authenticode
  signature, and on Windows `signtool verify /pa` must accept it.
- `release/signing.json` says "Windows: signed" only when both hold.
  Without the SignPath details the release goes out with an unsigned
  installer, and the record says so.

Anyone can check an installer:

```bash
node scripts/windows/verify-signature.mjs Lumen_<version>_x64-setup.exe   # exit 1 when unsigned
signtool verify /pa /v Lumen_<version>_x64-setup.exe                      # on Windows
```

## What the app is allowed to do

The window has no general file-system permission. It reaches only the vault
folder you picked, through Lumen's own commands. No shell, no arbitrary
HTTP from the native side, and no source maps in the shipped files.

**What is written, and what is not on yet (plan W11.S18):**

- Every capability file is meant to match a reviewed snapshot
  (`security/tauri-capabilities.snapshot.json`), and a capability that grants
  an updater, shell, file-system, process, HTTP or opener permission to the
  window should fail the check. The check is a unit test
  (`src/__tests__/tauriIsolation.test.ts`), run by hand: there is no CI that
  runs it on every change yet. **It is red today**: the default capability
  changed (a global-shortcut permission) and its snapshot was not reviewed
  again. The owner reviews it and refreshes the snapshot.
- An **isolation app** (`src-tauri/isolation/`) is written to check every
  message from the window before it reaches the native side, as a second wall
  behind the capability: only Lumen's own commands, a vault path only inside
  the vault, never an updater or shell command. **It is not turned on**:
  `tauri.conf.json` does not use the isolation pattern. Its allow-list also
  lacks 12 commands the desktop app has since gained (checked 17 November 2026):
  `vault_write_if` and `vault_remove_if` (compare-and-swap saves),
  `vault_roots_nested`, `latex_status` and `latex_pdf`, and the local MCP
  bridge's `mcp_stdio_approved`, `mcp_stdio_approve`, `mcp_stdio_revoke`,
  `mcp_stdio_spawn`, `mcp_stdio_write`, `mcp_stdio_close` and `mcp_open_url`.
  Turning it on as it is would break saving on the desktop. Which of the MCP
  commands the window may send at all is a security review of its own (one
  of them starts a process), not a line to copy into the list. The same test
  is red on that too.

Until the allow-list is updated, the test is green and the pattern is on
(`node scripts/tauri-isolation.mjs --enable`, which also needs a dependency
update with network access), the capability file is the only wall.
