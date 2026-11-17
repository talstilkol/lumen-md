/**
 * Settings → MCP servers (plan W7.18, W10.C2/C3): the outside servers the
 * local agents may use.
 *
 *   • Add a server by address (Streamable HTTP) or by program (stdio, the
 *     desktop app only). A new server is off; nothing connects until the
 *     user turns it on and, for a program, approves its exact command in
 *     the app's native dialog.
 *   • Per server: on/off, the default permission, "offline" (the user says
 *     the program makes no network requests: otherwise it counts as remote
 *     and is blocked in airplane mode), remove, and its log (stderr).
 *   • "Show tools" connects once, on that click: each tool's permission
 *     (read / ask / block), and whether its definition is the one the user
 *     approved, new, or changed since (approvals.ts). "Approve these
 *     definitions" pins them; it does not allow any call by itself.
 *   • Suggested servers (C3) list licence, what they reach and how to
 *     install; "Use" fills the form and connects nothing.
 *   • A program's approval (desktop, W13.X1) is an allow-list entry pinned
 *     to its full path, its sha256 and the exact arguments: "Check approval"
 *     says whether this exact command is still on it (a changed program is
 *     not), "Withdraw approval" takes it off. Neither starts anything.
 */
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { t } from "../../i18n";
import { formatTime } from "../../i18n/format";
import "../mcpServersStrings";
import { addServer, readServers, removeServer, serverFormError, setPin, setToolPermission, updateServer, type McpServerConfig, type ToolPermission } from "../../agents/mcp/servers";
import { SUGGESTED, formFromSuggestion, type SuggestedServer } from "../../agents/mcp/suggested";
import { serverLog, subscribeServerLog } from "../../agents/mcp/log";
import { toolApprovals } from "../../agents/mcp/approvals";
import type { ListedTool } from "../../agents/mcp/registry";
import { stdioRefusal, type StdioSpec } from "../../agents/mcp/transports/stdio";
import { btn, btnPrimary, card, chip, field, heading, muted, row } from "./formStyles";

type Draft = { id: string; label: string; transport: "http" | "stdio"; url: string; command: string; args: string; cwd: string; offline: boolean; defaultPermission: ToolPermission };

const EMPTY: Draft = { id: "", label: "", transport: "http", url: "", command: "", args: "", cwd: "", offline: false, defaultPermission: "ask" };

const input: React.CSSProperties = { ...field, flex: "1 1 200px" };

function draftOf(cfg: Omit<McpServerConfig, "enabled" | "tools">): Draft {
  return { ...EMPTY, id: cfg.id, label: cfg.label, transport: cfg.transport, url: cfg.url ?? "", command: cfg.command ?? "", args: (cfg.args ?? []).join("\n"), cwd: cfg.cwd ?? "", offline: !!cfg.offline, defaultPermission: cfg.defaultPermission };
}

function configOf(d: Draft): Omit<McpServerConfig, "enabled" | "tools"> {
  const base = { id: d.id.trim(), label: d.label.trim(), transport: d.transport, defaultPermission: d.defaultPermission };
  if (d.transport === "http") return { ...base, url: d.url.trim() };
  return {
    ...base,
    command: d.command.trim(),
    args: d.args.split("\n").map((a) => a.trim()).filter(Boolean),
    ...(d.cwd.trim() ? { cwd: d.cwd.trim() } : {}),
    ...(d.offline ? { offline: true } : {}),
  };
}

/** The desktop allow-list, read and withdrawn (src-tauri/src/mcp_stdio.rs). Never asks, never starts. */
export interface StdioApprovals {
  approved(spec: StdioSpec): Promise<boolean>;
  revoke(spec: StdioSpec): Promise<boolean>;
}

const tauriApprovals: StdioApprovals = {
  async approved(spec) {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke("mcp_stdio_approved", { command: spec.command, args: spec.args, cwd: spec.cwd ?? null })) === true;
  },
  async revoke(spec) {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke("mcp_stdio_revoke", { command: spec.command, args: spec.args, cwd: spec.cwd ?? null })) === true;
  },
};

const specOf = (s: McpServerConfig): StdioSpec => ({ command: s.command ?? "", args: s.args ?? [], ...(s.cwd ? { cwd: s.cwd } : {}) });

/** An error from connecting, in the user's words when it is the allow-list's refusal. */
function connectError(message: string): string {
  const why = stdioRefusal(message);
  return why ? t(why === "changed" ? "mcpServers.stdio.changed" : "mcpServers.stdio.notApproved") : message;
}

function StdioApproval({ server, approvals }: { server: McpServerConfig; approvals: StdioApprovals }) {
  const [state, setState] = useState<"unknown" | "yes" | "no" | "revoked" | "notRevoked" | string>("unknown");
  const run = (f: () => Promise<"yes" | "no" | "revoked" | "notRevoked">) =>
    void f().then(setState, (e) => setState(String((e as Error)?.message ?? e)));
  return (
    <div style={row}>
      <button type="button" style={btn} data-testid={`mcp-approval-check-${server.id}`} onClick={() => run(async () => ((await approvals.approved(specOf(server))) ? "yes" : "no"))}>
        {t("mcpServers.approval.check")}
      </button>
      {/* Review 10, L4: false means nothing matched this command (nothing was withdrawn). */}
      <button type="button" style={btn} data-testid={`mcp-approval-revoke-${server.id}`} onClick={() => run(async () => ((await approvals.revoke(specOf(server))) ? "revoked" : "notRevoked"))}>
        {t("mcpServers.approval.revoke")}
      </button>
      {state !== "unknown" && (
        <span role="status" style={muted} data-testid={`mcp-approval-${server.id}`}>
          {state === "yes"
            ? t("mcpServers.approval.yes")
            : state === "no"
              ? t("mcpServers.approval.no")
              : state === "revoked"
                ? t("mcpServers.approval.revoked")
                : state === "notRevoked"
                  ? t("mcpServers.approval.notRevoked")
                  : state}
        </span>
      )}
    </div>
  );
}

function ServerLog({ id }: { id: string }) {
  const lines = useSyncExternalStore(subscribeServerLog, () => serverLog(id));
  // empty-action: the card's "Show tools" button connects to the server, which fills its log
  if (!lines.length) return <p style={muted}>{t("mcpServers.log.empty")}</p>;
  return (
    <pre data-testid={`mcp-log-${id}`} style={{ maxHeight: 160, overflow: "auto", fontSize: 11, direction: "ltr", textAlign: "start", whiteSpace: "pre-wrap" }}>
      {lines.map((l) => `${formatTime(l.ts, { timeStyle: "medium" })} ${l.stream === "stderr" ? "!" : "·"} ${l.text}`).join("\n")}
    </pre>
  );
}

function Tools({ server, list, onChange }: { server: McpServerConfig; list: ListedTool[]; onChange: () => void }) {
  return (
    <div data-testid={`mcp-tools-${server.id}`}>
      {list.map((x) => (
        <div key={x.tool.name} style={{ ...row, margin: "4px 0" }}>
          <code style={{ direction: "ltr" }}>{x.tool.name}</code>
          <span style={{ ...muted, color: x.pin === "changed" ? "hsl(var(--destructive, 0 70% 45%))" : undefined }} data-testid={`mcp-pin-${x.tool.name}`}>
            {t(`mcpServers.tools.${x.pin}`)}
          </span>
          <select
            style={field}
            aria-label={t("mcpServers.tools.permission", { tool: x.tool.name })}
            value={x.permission}
            onChange={(e) => {
              setToolPermission(server.id, x.tool.name, e.target.value as ToolPermission);
              onChange();
            }}
          >
            <option value="read" disabled={x.tool.annotations?.readOnlyHint !== true}>
              {t("mcpServers.perm.read")}
            </option>
            <option value="ask">{t("mcpServers.perm.ask")}</option>
            <option value="block">{t("mcpServers.perm.block")}</option>
          </select>
        </div>
      ))}
      {list.some((x) => x.pin !== "pinned") && (
        <button
          type="button"
          style={btn}
          data-testid={`mcp-pin-all-${server.id}`}
          onClick={() => {
            for (const x of list) setPin(server.id, x.tool.name, x.hash);
            onChange();
          }}
        >
          {t("mcpServers.tools.pinAll")}
        </button>
      )}
    </div>
  );
}

/** A suggestion's name, in the user's language (the list's English label otherwise). */
const suggestionName = (s: SuggestedServer): string => {
  const k = `mcpServers.s.${s.id}.name`;
  const v = t(k);
  return v && v !== k ? v : s.label;
};

const REACHES = { network: "network", "this computer": "computer", "your files": "files" } as const;

/**
 * One suggested server (C3): what it is, its licence, what it reaches, that each tool asks first,
 * how it runs, where to get it and how to install it. "Use" only fills the form below.
 */
function SuggestionCard({ s, added, desktop, onUse }: { s: SuggestedServer; added: boolean; desktop: boolean; onUse: () => void }) {
  const name = suggestionName(s);
  const about = `mcp-s-${s.id}-about`;
  const opt = (k: string): string | null => {
    const v = t(k);
    return v && v !== k ? v : null;
  };
  const install = s.install ? opt(`mcpServers.s.${s.id}.install`) ?? s.install : null;
  return (
    <li style={card} data-testid={`mcp-suggested-${s.id}`}>
      <div style={row}>
        <strong dir="auto">{name}</strong>
        {s.builtin && <span style={chip}>{t("mcpServers.chip.builtin")}</span>}
      </div>
      <p id={about} style={{ ...muted, margin: "2px 0 6px" }} dir="auto">
        {opt(`mcpServers.s.${s.id}.about`) ?? s.label}
      </p>
      <div style={row} data-testid={`mcp-suggested-chips-${s.id}`}>
        <span style={chip}>{s.license === "unverified" ? t("mcpServers.licenseUnverified") : t("mcpServers.license", { license: s.license })}</span>
        <span style={chip}>{t(`mcpServers.reaches.${REACHES[s.reaches]}`)}</span>
        {s.defaultPermission === "ask" && <span style={chip}>{t("mcpServers.chip.asks")}</span>}
        <span style={chip}>{t(s.transport === "stdio" ? "mcpServers.chip.program" : "mcpServers.chip.address")}</span>
      </div>
      <p style={{ ...muted, marginTop: 6 }}>
        {t("mcpServers.sourceLabel")} <span dir="auto">{opt(`mcpServers.s.${s.id}.source`) ?? s.source}</span>
      </p>
      {install && (
        <p style={muted}>
          {t("mcpServers.installLabel")} <span dir="auto">{install}</span>
        </p>
      )}
      {s.transport === "stdio" && !desktop && <p style={muted}>{t("mcpServers.desktopOnly")}</p>}
      <div style={{ ...row, marginTop: 8 }}>
        <button type="button" style={btn} data-testid={`mcp-use-${s.id}`} aria-label={added ? `${name}: ${t("mcpServers.added")}` : t("mcpServers.useFor", { name })} aria-describedby={about} disabled={added} onClick={onUse}>
          {added ? t("mcpServers.added") : t("mcpServers.use")}
        </button>
      </div>
    </li>
  );
}

export function McpServers({
  list = (s: McpServerConfig) => import("../../agents/mcp/registry").then((m) => m.listServerTools(s)),
  desktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window,
  approvals = tauriApprovals,
}: {
  list?: (s: McpServerConfig) => Promise<ListedTool[]>;
  desktop?: boolean;
  approvals?: StdioApprovals;
}) {
  const [servers, setServers] = useState<McpServerConfig[]>(() => readServers());
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [tools, setTools] = useState<Record<string, ListedTool[] | string>>({});
  const [openLog, setOpenLog] = useState<string | null>(null);
  const refresh = () => setServers(readServers());
  const ids = useMemo(() => new Set(servers.map((s) => s.id)), [servers]);

  const save = () => {
    const cfg = configOf(draft);
    const err = serverFormError(cfg);
    if (err) return setFormError(err);
    if (ids.has(cfg.id)) return setFormError("taken");
    addServer(cfg); // off until the user turns it on
    setDraft(EMPTY);
    setFormError(null);
    refresh();
  };

  const showTools = async (s: McpServerConfig) => {
    setTools((x) => ({ ...x, [s.id]: "…" }));
    try {
      const listed = await list(s);
      setTools((x) => ({ ...x, [s.id]: listed }));
    } catch (e) {
      setTools((x) => ({ ...x, [s.id]: connectError(String((e as Error)?.message ?? e)) }));
    }
  };

  // C3: "Use" fills the form (a copy, with the name in the user's language) and connects nothing;
  // focus goes to the form's first field, and a status line says what happened.
  const formId = useRef<HTMLInputElement | null>(null);
  const [filled, setFilled] = useState<string | null>(null);
  const applySuggestion = (s: SuggestedServer) => {
    setDraft(draftOf({ ...formFromSuggestion(s), label: suggestionName(s) }));
    setFormError(null);
    setFilled(suggestionName(s));
    queueMicrotask(() => formId.current?.focus());
  };

  return (
    <div data-testid="mcp-servers">
      <p style={muted}>{t("mcpServers.intro")}</p>

      <h3 style={heading}>{t("mcpServers.yours")}</h3>
      {/* empty-action: the "Add a server" form and the suggested servers below */}
      {!servers.length && <p style={muted}>{t("mcpServers.none")}</p>}
      {servers.map((s) => {
        const listed = tools[s.id];
        return (
          <div key={s.id} style={card} data-testid={`mcp-server-${s.id}`}>
            <div style={row}>
              <strong>{s.label}</strong>
              <span style={muted}>{s.transport === "http" ? s.url : `${s.command ?? ""} ${(s.args ?? []).join(" ")}`}</span>
            </div>
            {s.transport === "stdio" && !desktop && <p style={muted}>{t("mcpServers.desktopOnly")}</p>}
            {s.transport === "stdio" && desktop && <StdioApproval server={s} approvals={approvals} />}
            <div style={row}>
              <label style={row}>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  data-testid={`mcp-enable-${s.id}`}
                  onChange={(e) => {
                    updateServer(s.id, { enabled: e.target.checked });
                    refresh();
                  }}
                />
                {t("mcpServers.enabled")}
              </label>
              {s.transport === "stdio" && (
                <label style={row}>
                  <input
                    type="checkbox"
                    checked={!!s.offline}
                    onChange={(e) => {
                      updateServer(s.id, { offline: e.target.checked });
                      refresh();
                    }}
                  />
                  {t("mcpServers.offline")}
                </label>
              )}
              <label style={row}>
                {t("mcpServers.default")}
                <select
                  style={field}
                  value={s.defaultPermission}
                  onChange={(e) => {
                    updateServer(s.id, { defaultPermission: e.target.value as ToolPermission });
                    refresh();
                  }}
                >
                  <option value="ask">{t("mcpServers.perm.ask")}</option>
                  <option value="read">{t("mcpServers.perm.read")}</option>
                  <option value="block">{t("mcpServers.perm.block")}</option>
                </select>
              </label>
            </div>
            <div style={row}>
              <button type="button" style={btn} data-testid={`mcp-show-tools-${s.id}`} onClick={() => void showTools(s)}>
                {t("mcpServers.showTools")}
              </button>
              <button type="button" style={btn} onClick={() => setOpenLog(openLog === s.id ? null : s.id)}>
                {t("mcpServers.log")}
              </button>
              <button
                type="button"
                style={btn}
                onClick={() => {
                  toolApprovals.revoke(s.id);
                  refresh();
                }}
              >
                {t("mcpServers.forget")}
              </button>
              <button
                type="button"
                style={btn}
                data-testid={`mcp-remove-${s.id}`}
                onClick={() => {
                  removeServer(s.id);
                  toolApprovals.revoke(s.id);
                  refresh();
                }}
              >
                {t("mcpServers.remove")}
              </button>
            </div>
            {typeof listed === "string" && <p style={muted}>{listed}</p>}
            {Array.isArray(listed) && <Tools server={s} list={listed} onChange={() => (refresh(), void showTools(readServers().find((x) => x.id === s.id) ?? s))} />}
            {openLog === s.id && <ServerLog id={s.id} />}
          </div>
        );
      })}

      <h3 style={heading}>{t("mcpServers.add")}</h3>
      <p role="status" style={muted} data-testid="mcp-filled">
        {filled ? t("mcpServers.filled", { name: filled }) : ""}
      </p>
      <form
        data-testid="mcp-add-form"
        style={card}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div style={row}>
          <label style={row}>
            {t("mcpServers.form.id")}
            <input ref={formId} style={input} value={draft.id} data-testid="mcp-form-id" onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
          </label>
          <label style={row}>
            {t("mcpServers.form.label")}
            <input style={input} value={draft.label} data-testid="mcp-form-label" onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          </label>
        </div>
        <div style={row} role="radiogroup" aria-label={t("mcpServers.form.transport")}>
          <label style={row}>
            <input type="radio" name="mcp-transport" checked={draft.transport === "http"} onChange={() => setDraft({ ...draft, transport: "http" })} />
            {t("mcpServers.form.http")}
          </label>
          <label style={row}>
            <input type="radio" name="mcp-transport" checked={draft.transport === "stdio"} data-testid="mcp-form-stdio" onChange={() => setDraft({ ...draft, transport: "stdio" })} />
            {t("mcpServers.form.stdio")}
          </label>
        </div>
        {draft.transport === "http" ? (
          <label style={row}>
            {t("mcpServers.form.url")}
            <input
              style={{ ...input, direction: "ltr" }}
              value={draft.url}
              data-testid="mcp-form-url"
              // i18n-allow: the URL scheme, the same in every language
              placeholder="https://"
              onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          </label>
        ) : (
          <>
            <label style={row}>
              {t("mcpServers.form.command")}
              <input style={{ ...input, direction: "ltr" }} value={draft.command} data-testid="mcp-form-command" onChange={(e) => setDraft({ ...draft, command: e.target.value })} />
            </label>
            <label style={{ display: "block" }}>
              {t("mcpServers.form.args")}
              <textarea style={{ ...field, width: "100%", direction: "ltr", display: "block" }} rows={3} value={draft.args} data-testid="mcp-form-args" onChange={(e) => setDraft({ ...draft, args: e.target.value })} />
            </label>
            <label style={row}>
              {t("mcpServers.form.cwd")}
              <input style={{ ...input, direction: "ltr" }} value={draft.cwd} onChange={(e) => setDraft({ ...draft, cwd: e.target.value })} />
            </label>
            <label style={row}>
              <input type="checkbox" checked={draft.offline} onChange={(e) => setDraft({ ...draft, offline: e.target.checked })} />
              {t("mcpServers.offline")}
            </label>
            <p style={muted}>{t("mcpServers.form.stdioNote")}</p>
            <p style={muted}>{t("mcpServers.form.stdioPinned")}</p>
          </>
        )}
        {formError && (
          <p role="alert" data-testid="mcp-form-error" style={{ color: "hsl(var(--destructive, 0 70% 45%))" }}>
            {t(`mcpServers.form.error.${formError}`)}
          </p>
        )}
        <button type="submit" style={btnPrimary} data-testid="mcp-form-save">
          {t("mcpServers.form.save")}
        </button>
      </form>

      <h3 style={heading} id="mcp-suggested-h">
        {t("mcpServers.suggested")}
      </h3>
      <p style={muted}>{t("mcpServers.suggestedNote")}</p>
      <ul aria-labelledby="mcp-suggested-h" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {SUGGESTED.map((s) => (
          <SuggestionCard key={s.id} s={s} added={ids.has(s.id)} desktop={desktop} onUse={() => applySuggestion(s)} />
        ))}
      </ul>
    </div>
  );
}
