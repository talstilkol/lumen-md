---
title: Installing plugins
description: Install, update, change permissions of and remove plugins — from Lumen's registry or from a file.
---

Open the command palette and run **Plugins**.

- **Install.** From the list (Lumen's own registry), press **Install**. The permissions dialog lists every capability the plugin asks for and why. Nothing is ticked, so tick what you allow. **Tick all requested** is there when you trust it fully.
- **Install from file…** installs a `.lumenplugin.json` bundle. A bundle that is not signed by a key you trust is marked **unverified**. Install it only if you trust where it came from.
- **Permissions…** changes what an installed plugin may do. The plugin restarts with the new set.
- **On / off** stops a plugin without removing it.
- **Update** appears when the registry has a newer version. Permissions the new version still asks for are kept. New ones start unticked.
- **Uninstall** removes the plugin, its settings and its stored data.

Lumen checks the integrity of registry plugins against the hash the registry pins, and of signed bundles against your trusted keys (see [Plugin signing keys](/plugins/signing/)). Plugins run sandboxed (see [Sandbox and permissions](/plugins/sandbox/)).
