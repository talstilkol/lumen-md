/**
 * Public surface of the Lumen plugin API. The host installs your plugin
 * by passing an instance of LumenPluginAPI to your `activate(api)`.
 *
 * This file is duplicated from the host repo so plugin authors get types
 * without needing a direct dependency on Lumen itself.
 */

import type { ComponentType } from "react";

export interface LumenBlockProps {
  /** Raw text inside the code fence. */
  source: string;
  /** Anything after the language tag, e.g. `csv title="…"` → `title="…"`. */
  meta?: string;
}

export interface LumenCommand {
  id: string;
  label: string;
  hint?: string;
  icon?: string;
  action: () => void | Promise<void>;
}

export interface LumenPluginAPI {
  /** Register a custom code-fence renderer. Returns an unregister fn. */
  registerBlock(
    lang: string,
    component: ComponentType<LumenBlockProps>,
  ): () => void;

  /** Register a command palette entry. Returns an unregister fn. */
  registerCommand(cmd: LumenCommand): () => void;

  /** Show a toast (info / success / warning / error). */
  toast(message: string, kind?: "info" | "success" | "warning" | "error"): void;

  /** Read the current document content. */
  getDocContent(): string;

  /** Set the current document content (raw markdown). */
  setDocContent(content: string): void;

  /** Subscribe to document-content changes. Returns an unsubscribe fn. */
  onDocChange(cb: (content: string) => void): () => void;
}
