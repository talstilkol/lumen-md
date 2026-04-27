/**
 * __PLUGIN_TITLE__ — Lumen plugin entrypoint.
 *
 * Plugins receive the Lumen plugin API as a single argument and call
 * register* helpers to add commands, custom blocks, sidebar panels, etc.
 *
 * The plugin module must export a default function with this shape:
 *
 *   export default function activate(api: LumenPluginAPI): () => void { ... }
 *
 * The returned function (optional) is called when the plugin is unloaded.
 * Use it to clean up listeners, timers, or DOM you injected.
 */

import type { LumenPluginAPI } from "./types";
import { ExampleBlock } from "./block";

export default function activate(api: LumenPluginAPI): () => void {
  // 1. Register a custom code-fence renderer.
  //    Anything inside ```my-block ... ``` gets rendered with our component.
  const unregBlock = api.registerBlock("__PLUGIN_NAME__", ExampleBlock);

  // 2. Register a command palette entry.
  const unregCmd = api.registerCommand({
    id: "__PLUGIN_NAME__.hello",
    label: "__PLUGIN_TITLE__: Say hello",
    hint: "Demo command from your plugin",
    icon: "✨",
    action: () => api.toast("Hello from __PLUGIN_TITLE__!", "info"),
  });

  // Cleanup on disable.
  return () => {
    unregBlock();
    unregCmd();
  };
}
