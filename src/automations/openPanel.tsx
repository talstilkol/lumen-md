/**
 * Opens the automations manager (plan W5.24) from the palette, over the
 * vault's rules file and run log (./app.ts). "New rule…" closes the panel,
 * walks the rule builder and opens the panel again with the new rule in it.
 */
import { createRoot, type Root } from "react-dom/client";
import type { AutomationsApi } from "./AutomationsPanel";

let mounted: { root: Root; host: HTMLElement } | null = null;

export function closeAutomationsPanel(): void {
  if (!mounted) return;
  mounted.root.unmount();
  mounted.host.remove();
  mounted = null;
}

const isoToday = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function openAutomationsPanel(doc: { workspaceName?: string | null; content: string }, newRule: () => Promise<void>): Promise<void> {
  // Both load on first use: the panel (and its strings) and the app layer.
  const [app, { AutomationsPanel }] = await Promise.all([import("./app"), import("./AutomationsPanel")]);
  const api: AutomationsApi = {
    loadRules: app.loadRules,
    readLog: app.readLog,
    setRuleEnabled: app.setRuleEnabled,
    deleteRule: app.deleteRule,
    restoreRule: app.restoreRule,
    dryRun: app.dryRun,
    undoRunById: app.undoRunById,
  };
  closeAutomationsPanel();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted = { root, host };
  root.render(
    <AutomationsPanel
      api={api}
      doc={{ path: doc.workspaceName ?? null, text: doc.content }}
      today={isoToday()}
      onClose={closeAutomationsPanel}
      onNewRule={() => {
        closeAutomationsPanel();
        void newRule().finally(() => void openAutomationsPanel(doc, newRule));
      }}
    />,
  );
}
