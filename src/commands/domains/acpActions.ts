/**
 * "Ask an external agent…" (plan W11.I23), desktop only: Claude Code, Codex
 * or OpenCode, hosted over ACP (agents/acp/host.ts) and started through the
 * same native-approved process bridge as stdio MCP servers (the Rust side
 * runs only a command the user allowed in a native dialog, and never
 * `npx -y`). Every file the agent writes is staged and waits in the review
 * panel; the agent reads only inside the vault; airplane mode refuses it;
 * its cloud model needs the user's consent first.
 *
 * Loaded on demand from the palette.
 */
import { t } from "../../i18n";
import { showAiToast } from "../../ui/AiToast";
import "./acpActionsStrings";

export async function askExternalAgentFlow(): Promise<void> {
  const [{ ACP_AGENTS, acpAgent }, { startAcpSession }, { tauriStdioBridge }, { uiSelect, uiConfirm, uiPrompt }, { desktopVaultRoot }, { explainError }] = await Promise.all([
    import("../../agents/acp/agents"),
    import("../../agents/acp/host"),
    import("../../agents/mcp/transports/stdio"),
    import("../../ui/PromptDialog"),
    import("../../storage/vault/location"),
    import("../../lib/userError"),
  ]);
  const id = await uiSelect({ title: t("ai.acp.title"), message: t("ai.acp.pick"), choices: ACP_AGENTS.map((a) => ({ value: a.id, label: `${a.label} (${a.command})` })) });
  const agent = id ? acpAgent(id) : undefined;
  if (!agent) return;
  const vaultRoot = await desktopVaultRoot().catch(() => "");
  if (!vaultRoot) {
    showAiToast(t("ai.acp.noVault"), "info");
    return;
  }
  const consentCloud = agent.reach !== "remote" || (await uiConfirm({ title: t("ai.acp.title"), message: t("ai.acp.consent", { agent: agent.label }) }));
  if (!consentCloud) return;
  const text = await uiPrompt({ title: agent.label, message: t("ai.acp.prompt") });
  if (!text?.trim()) return;
  const { readWorkspaceFile, workspaceHasFile } = await import("../../storage/workspace");
  let session: Awaited<ReturnType<typeof startAcpSession>> | null = null;
  try {
    session = await startAcpSession({
      agent,
      vaultRoot,
      bridge: tauriStdioBridge(),
      consentCloud,
      read: async (path) => ((await workspaceHasFile(path)) ? readWorkspaceFile(path) : null),
      // The agent's own read / search / think tools: asked once each; every other kind is refused by the host.
      askPermission: (req) => uiConfirm({ title: agent.label, message: t("ai.acp.permission", { tool: String(req.toolCall.title ?? req.toolCall.kind ?? "?") }) }),
    });
    showAiToast(t("ai.acp.running", { agent: agent.label }), "info");
    window.dispatchEvent(new Event("lumen-open-agent-review"));
    const stop = await session.prompt(text);
    showAiToast(t("ai.acp.done", { agent: agent.label, reason: stop }), "success");
  } catch (e) {
    showAiToast(t("ai.acp.failed", { agent: agent.label, error: explainError(e) }), "error");
  } finally {
    await session?.close().catch(() => undefined);
  }
}
