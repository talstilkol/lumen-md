/**
 * Settings → MCP servers → a server reached by address: "Sign in" (plan
 * W13.A1; review 14, Low 1). Loaded with React.lazy by McpServers, so the
 * OAuth code (agents/mcp/oauthFlow.ts) travels in its own chunk.
 *
 * Where sign-in cannot run, the card says why instead of offering a button
 * that fails: on the web ("desktop app only": a page cannot listen for the
 * loopback redirect), and on the desktop until the listener's command is on
 * the isolation allow-list ("needs desktop command"). While the browser is
 * open the card says so and offers Cancel; the result is announced.
 */
import { useEffect, useId, useRef, useState } from "react";
import { t } from "../../i18n";
import "../mcpServersStrings";
import { platformBridge, signIn, SignInUnavailable, type LoopbackBridge } from "../../agents/mcp/signIn";
import { updateServer, type McpServerConfig } from "../../agents/mcp/servers";
import type { Fetch } from "../../agents/mcp/oauthFlow";
import { explainError } from "../../lib/userError";

const muted: React.CSSProperties = { fontSize: 12, color: "hsl(var(--fg-muted))", margin: 0 };

export default function McpSignIn({ server, bridge, fetchImpl, onSignedIn }: { server: McpServerConfig; bridge?: LoopbackBridge; fetchImpl?: Fetch; onSignedIn?: () => void }) {
  const [b] = useState(() => bridge ?? platformBridge());
  const [phase, setPhase] = useState<{ kind: "idle" } | { kind: "waiting" } | { kind: "done"; issuer: string } | { kind: "error"; message: string }>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);
  const noteId = useId();
  useEffect(() => () => abort.current?.abort(), []);
  const status = b.status();

  if (!status.ok) {
    return (
      <p style={muted} data-testid={`mcp-signin-unavailable-${server.id}`} data-reason={status.reason}>
        {t(status.reason === "web" ? "mcpServers.signIn.desktopOnly" : "mcpServers.signIn.needsCommand")}
      </p>
    );
  }

  const start = async () => {
    const ac = new AbortController();
    abort.current = ac;
    setPhase({ kind: "waiting" });
    try {
      const cred = await signIn(server, { bridge: b, ...(fetchImpl ? { fetchImpl } : {}), signal: ac.signal });
      updateServer(server.id, { issuer: cred.issuer });
      setPhase({ kind: "done", issuer: cred.issuer });
      onSignedIn?.();
    } catch (e) {
      if (ac.signal.aborted) return setPhase({ kind: "idle" });
      setPhase({ kind: "error", message: e instanceof SignInUnavailable ? t("mcpServers.signIn.needsCommand") : explainError(e) });
    } finally {
      if (abort.current === ac) abort.current = null;
    }
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid={`mcp-signin-${server.id}`}>
      {phase.kind === "waiting" ? (
        <button type="button" data-testid={`mcp-signin-cancel-${server.id}`} onClick={() => abort.current?.abort()}>
          {t("mcpServers.signIn.cancel")}
        </button>
      ) : (
        <button type="button" data-testid={`mcp-signin-start-${server.id}`} aria-describedby={noteId} onClick={() => void start()}>
          {server.issuer ? t("mcpServers.signIn.again") : t("mcpServers.signIn.start")}
        </button>
      )}
      <p id={noteId} style={muted}>
        {t("mcpServers.signIn.note")}
      </p>
      <p role="status" style={muted} data-testid={`mcp-signin-status-${server.id}`}>
        {phase.kind === "waiting" ? t("mcpServers.signIn.waiting") : phase.kind === "done" ? <bdi>{t("mcpServers.signIn.done", { issuer: phase.issuer })}</bdi> : ""}
      </p>
      {phase.kind === "error" && (
        <p role="alert" style={{ ...muted, color: "hsl(var(--danger))" }} data-testid={`mcp-signin-error-${server.id}`}>
          <bdi>{t("mcpServers.signIn.failed", { error: phase.message })}</bdi>
        </p>
      )}
    </div>
  );
}
