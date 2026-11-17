/**
 * Open the compare view (plan W13.R8) from anywhere: the version history
 * (plan 3.2), the sync conflict dialog (W1.9) or two notes picked in the
 * file tree. It mounts its own root, so no screen has to host it, and it
 * loads with this chunk only when first used.
 */
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { CompareSide } from "./CompareView";

let root: Root | null = null;
let host: HTMLElement | null = null;

export function closeCompare(): void {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}

export async function openCompare(left: CompareSide, right: CompareSide): Promise<void> {
  // The view (and its strings) load here, on first use.
  const { CompareView } = await import("./CompareView");
  closeCompare();
  host = document.createElement("div");
  host.dataset.compareHost = "";
  document.body.append(host);
  root = createRoot(host);
  root.render(createElement(CompareView, { left, right, onClose: closeCompare }));
}

