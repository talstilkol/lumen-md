/**
 * "Ask an external agent…" (plan W11.I23), desktop only: Claude Code, Codex
 * or OpenCode, hosted over ACP (agents/acp/host.ts) and started through the
 * same native-approved process bridge as stdio MCP servers (the Rust side
 * runs only a command the user allowed in a native dialog, and never
 * `npx -y`). Every file the agent writes is staged and waits in the review
 * panel; the agent reads only inside the vault; airplane mode refuses it;
 * its cloud model needs the user's consent first.
 *
 * While it works, a live panel (agents/acp/AcpSessionPanel.tsx) shows what
 * it says and runs, with Stop and "Review changes".
 *
 * Loaded on demand from the palette.
 */
import { t } from "../../i18n";
import { showAiToast } from "../../ui/AiToast";
import "./acpActionsStrings";
import type { AcpProcessBridge } from "../../agents/acp/host";
import type { AcpPanelHandle } from "../../agents/acp/AcpSessionPanel";

/** What the flow needs from the app; tests pass their own. */
export interface AcpFlowDeps {
  bridge: () => AcpProcessBridge;
  vaultRoot: () => Promise<string>;
  read: (path: string) => Promise<string | null>;
  ui: {
    select: (o: { title?: string; message: string; choices: Array<{ value: string; label: string }> }) => Promise<string | null | undefined>;
    confirm: (o: { title?: string; message: string }) => Promise<boolean>;
    prompt: (o: { title?: string; message: string }) => Promise<string | null | undefined>;
  };
  openPanel: (init: { agent: string; prompt: string; onStop: () => void }) => AcpPanelHandle;
}

async function appDeps(): Promise<AcpFlowDeps> {
  const [{ tauriStdioBridge }, { uiSelect, uiConfirm, uiPrompt }, { desktopVaultRoot }, { readWorkspaceFile, workspaceHasFile }, { openAcpPanel }] = await Promise.all([
    import("../../agents/mcp/transports/stdio"),
    import("../../ui/PromptDialog"),
    import("../../storage/vault/location"),
    import("../../storage/workspace"),
    import("../../agents/acp/AcpSessionPanel"),
  ]);
  return {
    bridge: tauriStdioBridge,
    vaultRoot: () => desktopVaultRoot(),
    read: async (path) => ((await workspaceHasFile(path)) ? readWorkspaceFile(path) : null),
    ui: { select: (o) => uiSelect(o), confirm: (o) => uiConfirm(o), prompt: (o) => uiPrompt(o) },
    openPanel: openAcpPanel,
  };
}

const OWN_ERRORS = ["AcpError", "McpClientError", "AirplaneBlockedError"];

export async function askExternalAgentFlow(deps?: AcpFlowDeps): Promise<void> {
  const [{ ACP_AGENTS, acpAgent }, { startAcpSession }, { explainError }, d] = await Promise.all([
    import("../../agents/acp/agents"),
    import("../../agents/acp/host"),
    import("../../lib/userError"),
    deps ?? appDeps(),
  ]);
  const id = await d.ui.select({ title: t("ai.acp.title"), message: t("ai.acp.pick"), choices: ACP_AGENTS.map((a) => ({ value: a.id, label: `${a.label} (${a.command})` })) });
  const agent = id ? acpAgent(id) : undefined;
  if (!agent) return;
  const vaultRoot = await d.vaultRoot().catch(() => "");
  if (!vaultRoot) {
    showAiToast(t("ai.acp.noVault"), "info");
    return;
  }
  const consentCloud = agent.reach !== "remote" || (await d.ui.confirm({ title: t("ai.acp.title"), message: t("ai.acp.consent", { agent: agent.label }) }));
  if (!consentCloud) return;
  const text = await d.ui.prompt({ title: agent.label, message: t("ai.acp.prompt") });
  if (!text?.trim()) return;
  let session: Awaited<ReturnType<typeof startAcpSession>> | null = null;
  let stopRequested = false;
  let offStaged: (() => void) | null = null;
  const panel = d.openPanel({
    agent: agent.label,
    prompt: text,
    onStop: () => {
      stopRequested = true;
      panel.set({ state: "stopping" });
      // Withdraws the run's pending writes and tells the agent; the prompt then ends with "cancelled".
      void session?.cancel().catch(() => undefined);
    },
  });
  try {
    session = await startAcpSession({
      agent,
      vaultRoot,
      bridge: d.bridge(),
      consentCloud,
      read: d.read,
      // The agent's own read / search / think tools: asked once each; every other kind is refused by the host.
      askPermission: (req) => d.ui.confirm({ title: agent.label, message: t("ai.acp.permission", { tool: String(req.toolCall.title ?? req.toolCall.kind ?? "?") }) }),
      onUpdate: (u) => panel.update(u),
    });
    if (stopRequested) await session.cancel().catch(() => undefined);
    // The first file the agent writes opens the review panel, where it waits for approval.
    const runId = session.runId;
    const { onStagedChanges } = await import("../../agents/staging");
    let opened = false;
    offStaged = onStagedChanges((list) => {
      if (!opened && list.some((c) => c.runId === runId && c.status === "pending")) {
        opened = true;
        window.dispatchEvent(new Event("lumen-open-agent-review"));
      }
    });
    const stop = await session.prompt(text);
    panel.set({ state: "done", detail: stop });
    showAiToast(t("ai.acp.done", { agent: agent.label, reason: stop }), "success");
  } catch (e) {
    // Lumen's own refusals (not approved, airplane mode, no consent, another ACP version) say what to do: shown as written.
    const why = e instanceof Error && OWN_ERRORS.includes(e.name) ? e.message : explainError(e);
    panel.set({ state: "failed", detail: why });
    showAiToast(t("ai.acp.failed", { agent: agent.label, error: why }), "error");
  } finally {
    offStaged?.();
    await session?.close().catch(() => undefined);
  }
}
