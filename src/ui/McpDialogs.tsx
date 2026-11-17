/**
 * The MCP client's two dialogs (plan W7.18, W10.C2):
 *
 *   • ElicitationDialog — a server asks the user something (MRTR
 *     `input_required`). It meets the 2026-07-28 spec's client MUSTs: the
 *     title names the server (as the user named it); Decline and Cancel are
 *     always there (Escape and a click outside are Cancel); a form's answers
 *     are edited and reviewed before Send; a URL is shown in full as text
 *     with its domain highlighted and Punycode / look-alike warnings, is
 *     never fetched (no link, no image, no preview), and opens only on the
 *     user's click, outside Lumen (the system browser). A form field that
 *     asks for a secret is not shown and the form cannot be sent.
 *   • ToolCallDialog — a tool call that needs the user: why (new tool,
 *     changed definition, or "ask" permission), the exact arguments, and
 *     the scope of the yes: once, this session, or this vault.
 */
import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { t } from "../i18n";
import "./PromptDialog.css";
import "./mcpServersStrings";
import { describeUrl, initialValues, openElicitationUrl, secretFields, validateForm, type ElicitationAsk, type ElicitationResult, type FormField } from "../agents/mcp/elicitation";
import type { ApprovalScope } from "../agents/mcp/approvals";
import type { CallAnswer, CallInfo } from "../agents/mcp/tools";
import type { McpServerConfig } from "../agents/mcp/servers";
import { Modal } from "./Modal";

const box: React.CSSProperties = { maxWidth: 560, width: "min(560px, 94vw)" };
const mono: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)", fontSize: 12, wordBreak: "break-all", whiteSpace: "pre-wrap", direction: "ltr", textAlign: "start", unicodeBidi: "isolate" };
const warn: React.CSSProperties = { color: "hsl(var(--destructive, 0 70% 45%))", fontSize: 13, margin: "6px 0" };

function Field({ f, value, error, onChange }: { f: FormField; value: unknown; error?: string; onChange: (v: unknown) => void }) {
  const id = `mcp-el-${f.key}`;
  const label = (
    <label htmlFor={id} style={{ display: "block", fontWeight: 600, fontSize: 13 }}>
      {f.title}
      {f.required ? " *" : ""}
    </label>
  );
  const help = f.description ? <div style={{ fontSize: 12, opacity: 0.8 }}>{f.description}</div> : null;
  const err = error ? (
    <div role="alert" style={warn} data-testid={`mcp-el-error-${f.key}`}>
      {t(`mcpServers.elicit.error.${error}`)}
    </div>
  ) : null;
  if (f.type === "boolean")
    return (
      <div style={{ margin: "8px 0" }}>
        <label htmlFor={id} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 600, fontSize: 13 }}>
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {f.title}
        </label>
        {help}
        {err}
      </div>
    );
  if (f.type === "enum")
    return (
      <div style={{ margin: "8px 0" }}>
        {label}
        <select id={id} className="prompt-input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {f.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {help}
        {err}
      </div>
    );
  if (f.type === "multi") {
    const list = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset style={{ margin: "8px 0", border: "none", padding: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 13 }}>{f.title}</legend>
        {f.options!.map((o) => (
          <label key={o.value} style={{ display: "flex", gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={list.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))} />
            {o.label}
          </label>
        ))}
        {help}
        {err}
      </fieldset>
    );
  }
  return (
    <div style={{ margin: "8px 0" }}>
      {label}
      <input
        id={id}
        className="prompt-input"
        type={f.type === "number" || f.type === "integer" ? "number" : f.format === "email" ? "email" : f.format === "date" ? "date" : "text"}
        value={String(value ?? "")}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        data-testid={`mcp-el-field-${f.key}`}
      />
      {help}
      {err}
    </div>
  );
}

export function ElicitationDialog({ ask, onResolve, openUrl = openElicitationUrl }: { ask: ElicitationAsk; onResolve: (r: ElicitationResult) => void; openUrl?: (url: string) => Promise<void> | void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const req = ask.request;
  const fields = req.mode === "form" ? req.fields : [];
  const secrets = useMemo(() => secretFields(fields), [fields]);
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const cancel = () => onResolve({ action: "cancel" });
  const view = req.mode === "url" ? describeUrl(req.url) : null;

  const send = async () => {
    if (req.mode === "url") {
      try {
        await openUrl(req.url);
      } catch (e) {
        setFailed(String((e as Error)?.message ?? e));
        return;
      }
      onResolve({ action: "accept" });
      return;
    }
    if (secrets.length) return;
    const v = validateForm(fields, values);
    setErrors(v.errors);
    if (Object.keys(v.errors).length) return;
    onResolve({ action: "accept", content: v.content });
  };

  return (
    <Modal onClose={cancel} className="prompt-backdrop" aria-labelledby="mcp-el-title" data-testid="mcp-elicitation" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div className="prompt-dialog" ref={ref} style={box}>
        <div id="mcp-el-title" className="prompt-title">
          {t("mcpServers.elicit.title", { server: ask.server })}
        </div>
        <p className="prompt-message" data-testid="mcp-el-message" style={{ whiteSpace: "pre-wrap" }}>
          {req.message || t("mcpServers.elicit.noMessage")}
        </p>
        {view && (
          <div data-testid="mcp-el-url">
            <p style={{ fontSize: 13 }}>{t("mcpServers.elicit.urlIntro")}</p>
            <div style={{ fontSize: 13 }}>
              {t("mcpServers.elicit.site")}{" "}
              <bdi style={{ ...mono, display: "inline" }}>
                {view.subdomain ? `${view.subdomain}.` : ""}
                <strong data-testid="mcp-el-domain" style={{ fontSize: 15, background: "hsl(var(--accent) / 0.15)", padding: "0 3px" }}>
                  {view.domain}
                </strong>
              </bdi>
            </div>
            <div style={{ ...mono, margin: "6px 0", padding: 6, border: "1px solid hsl(var(--border))", borderRadius: 4 }} data-testid="mcp-el-fullurl">
              {view.full}
            </div>
            {view.warnings.map((w) => (
              <p key={w} role="alert" style={warn} data-testid={`mcp-el-warn-${w}`}>
                {t(`mcpServers.elicit.warn.${w}`)}
              </p>
            ))}
            <p style={{ fontSize: 12, opacity: 0.8 }}>{t("mcpServers.elicit.urlOutside")}</p>
          </div>
        )}
        {req.mode === "form" && (
          <div>
            {secrets.length > 0 && (
              <p role="alert" style={warn} data-testid="mcp-el-secret">
                {t("mcpServers.elicit.secret", { fields: secrets.join(", ") })}
              </p>
            )}
            {fields
              .filter((f) => !secrets.includes(f.key))
              .map((f) => (
                <Field key={f.key} f={f} value={values[f.key]} error={errors[f.key]} onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))} />
              ))}
            {fields.length > 0 && <p style={{ fontSize: 12, opacity: 0.8 }}>{t("mcpServers.elicit.review")}</p>}
          </div>
        )}
        {failed && (
          <p role="alert" style={warn}>
            {failed}
          </p>
        )}
        <div className="prompt-actions">
          <button type="button" className="prompt-btn prompt-btn-cancel" onClick={cancel} data-testid="mcp-el-cancel">
            {t("mcpServers.elicit.cancel")}
          </button>
          <button type="button" className="prompt-btn prompt-btn-cancel" onClick={() => onResolve({ action: "decline" })} data-testid="mcp-el-decline">
            {t("mcpServers.elicit.decline")}
          </button>
          <button type="button" className="prompt-btn prompt-btn-ok" onClick={() => void send()} disabled={req.mode === "form" && secrets.length > 0} data-testid="mcp-el-accept">
            {req.mode === "url" ? t("mcpServers.elicit.open") : t("mcpServers.elicit.send")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ToolCallDialog({ server, tool, args, info, onResolve }: { server: McpServerConfig; tool: string; args: Record<string, unknown>; info: CallInfo; onResolve: (a: CallAnswer) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const no = () => onResolve(false);
  const pick = (s: ApprovalScope) => onResolve(s);
  // R8-L11: the whole payload, scrollable: what is approved is what is shown.
  const shownArgs = JSON.stringify(args, null, 2) ?? "";
  return (
    <Modal onClose={no} className="prompt-backdrop" aria-labelledby="mcp-call-title" data-testid="mcp-call" onMouseDown={(e) => e.target === e.currentTarget && no()}>
      <div className="prompt-dialog" ref={ref} style={box}>
        <div id="mcp-call-title" className="prompt-title">
          {t("mcpServers.call.title", { server: server.label, tool })}
        </div>
        <p className="prompt-message" data-testid={`mcp-call-why-${info.status}`} style={info.status === "changed" ? warn : undefined}>
          {t(`mcpServers.call.why.${info.status}`)}
        </p>
        {info.status !== "ask" && info.tool.description ? (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{t("mcpServers.call.description")}</div>
            <div style={{ ...mono, maxHeight: 120, overflow: "auto" }} data-testid="mcp-call-description">
              {info.tool.description.slice(0, 2000)}
            </div>
          </div>
        ) : null}
        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>{t("mcpServers.call.args")}</div>
        <div style={{ ...mono, maxHeight: 240, overflow: "auto" }} tabIndex={0} role="region" aria-label={t("mcpServers.call.args")} data-testid="mcp-call-args">
          {shownArgs}
        </div>
        <div className="prompt-actions" style={{ flexWrap: "wrap" }}>
          <button type="button" className="prompt-btn prompt-btn-cancel" onClick={no} data-testid="mcp-call-deny">
            {t("mcpServers.call.deny")}
          </button>
          <button type="button" className="prompt-btn prompt-btn-cancel" onClick={() => pick("vault")} data-testid="mcp-call-vault">
            {t("mcpServers.call.vault")}
          </button>
          <button type="button" className="prompt-btn prompt-btn-cancel" onClick={() => pick("session")} data-testid="mcp-call-session">
            {t("mcpServers.call.session")}
          </button>
          <button type="button" className="prompt-btn prompt-btn-ok" onClick={() => pick("once")} data-testid="mcp-call-once">
            {t("mcpServers.call.once")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function mount<T>(render: (done: (v: T) => void) => React.ReactElement): Promise<T> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(
      render((v) => {
        try {
          root.unmount();
        } catch {
          /* why: already unmounted by an earlier close */
        }
        host.remove();
        resolve(v);
      }),
    );
  });
}

/** Ask the user about one elicitation (the MCP client's default `elicit`). */
export function askElicitation(ask: ElicitationAsk): Promise<ElicitationResult> {
  return mount<ElicitationResult>((done) => <ElicitationDialog ask={ask} onResolve={done} />);
}

/** Ask the user about one tool call (the MCP client's default `confirmCall`). */
export function askMcpCall(server: McpServerConfig, tool: string, args: Record<string, unknown>, info: CallInfo): Promise<CallAnswer> {
  return mount<CallAnswer>((done) => <ToolCallDialog server={server} tool={tool} args={args} info={info} onResolve={done} />);
}
