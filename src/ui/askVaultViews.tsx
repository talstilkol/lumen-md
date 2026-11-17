/**
 * The parts of "Ask the vault" in the search dialog (W12.A1–A2): the scope
 * picker and the checked citations (paragraph, Pin link, unsupported claims).
 * Out of SearchDialog.tsx to keep it under 800 lines; loaded with it.
 */
import { t } from "../i18n";
import { readWorkspaceFile, writeWorkspaceFile } from "../storage/workspace";
import type { AskScopeChoice } from "../ai/askScope";
import type { ClaimSupport, VaultCitation } from "../ai/vaultCitations";
import type { RagResult } from "../ai/embeddings";
import { showAiToast } from "./AiToast";

/** What "Ask" may read: the vault (minus what .lumen/mcp.json denies), one folder, or one tag (W12.A2). */
export function AskScopePicker({ value, onChange }: { value: AskScopeChoice; onChange: (v: AskScopeChoice) => void }) {
  return (
    <div data-testid="ask-scope" role="group" aria-label={t("askScope.label")} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5, color: "hsl(var(--fg-muted))" }}>
      <label htmlFor="ask-scope-kind">{t("askScope.label")}</label>
      <select
        id="ask-scope-kind"
        value={value.kind}
        onChange={(e) => {
          const kind = e.target.value as AskScopeChoice["kind"];
          onChange(kind === "folder" ? { kind, folder: "" } : kind === "tag" ? { kind, tag: "" } : { kind: "vault" });
        }}
      >
        <option value="vault">{t("askScope.vault")}</option>
        <option value="folder">{t("askScope.folder")}</option>
        <option value="tag">{t("askScope.tag")}</option>
      </select>
      {value.kind !== "vault" && (
        <input
          aria-label={value.kind === "folder" ? t("askScope.folder") : t("askScope.tag")}
          dir="auto"
          value={value.kind === "folder" ? value.folder : value.tag}
          placeholder={value.kind === "folder" ? "work/" : "#project"} /* i18n-allow: an example folder path and tag, typed as they are in the vault */
          onChange={(e) => onChange(value.kind === "folder" ? { kind: "folder", folder: e.target.value } : { kind: "tag", tag: e.target.value })}
          style={{ flex: 1, minWidth: 0, fontSize: 11.5 }}
        />
      )}
    </div>
  );
}

/** Every citation checked against the note it names (T29), down to the paragraph (W12.A1). */
export function VaultCitationList({ checked, sources, onOpen }: { checked: { citations: VaultCitation[]; verifiedCount: number; claims: ClaimSupport[] }; sources: RagResult[]; onOpen: (src: RagResult) => void }) {
  return (
    <div data-testid="vault-citations" style={{ borderTop: "1px solid hsl(var(--border))", paddingTop: 8, marginTop: 4, fontSize: 11.5 }}>
      {checked.verifiedCount === 0 ? (
        <div role="alert" style={{ color: "hsl(var(--warn))", fontWeight: 600, marginBottom: 4 }}>{t("vaultCite.unsupported")}</div>
      ) : (
        <div style={{ color: "hsl(var(--fg-muted))", fontWeight: 600, marginBottom: 4 }}>
          {t("vaultCite.summary", { ok: checked.verifiedCount, total: checked.citations.length })}
        </div>
      )}
      {checked.citations.map((c, i) => (
        <button
          type="button"
          key={`${c.n}-${i}`}
          disabled={!c.path}
          data-verified={c.verified ? "1" : "0"}
          onClick={() => {
            const src = sources[c.n - 1];
            if (!src) return;
            onOpen(src);
            // W12.A1: the whole cited paragraph is selected (the highlight), not just a line.
            const p = c.paragraph;
            if (p) window.dispatchEvent(new CustomEvent("lumen-reveal-line", { detail: { line: p.startLine, endLine: p.endLine, content: src.content } }));
            else if (c.line) window.dispatchEvent(new CustomEvent("lumen-reveal-line", { detail: { line: c.line, content: src.content } }));
          }}
          style={{ display: "flex", gap: 6, alignItems: "baseline", width: "100%", textAlign: "start", padding: "3px 0", background: "none", border: 0, color: "inherit", cursor: c.path ? "pointer" : "default" }}
        >
          <span style={{ color: c.verified ? "hsl(var(--success))" : "hsl(var(--danger))", fontWeight: 700 }} aria-label={c.verified ? t("vaultCite.verified") : t("vaultCite.notVerified")}>
            {c.verified ? "✓" : "✗"}
          </span>
          <span style={{ color: "hsl(var(--accent))", whiteSpace: "nowrap" }}>
            [{c.n}] <bdi>{c.path ?? t("vaultCite.noSource")}</bdi>
            {c.paragraph ? ` ¶${c.paragraph.index + 1}` : c.line ? `:${c.line}` : ""}
          </span>
          {c.quote && <span dir="auto" style={{ color: "hsl(var(--fg-muted))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>“{c.quote}”</span>}
        </button>
      ))}
      {checked.citations.some((c) => c.verified && c.paragraph && !c.paragraph.blockId) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
          {checked.citations.map((c, i) =>
            c.verified && c.paragraph && !c.paragraph.blockId ? (
              <button
                type="button"
                key={`pin-${c.n}-${i}`}
                data-testid="vault-cite-pin"
                className="chart-block-tab"
                style={{ fontSize: 11 }}
                onClick={async () => {
                  // W12.A1 "Pin link": only now is a real ^id written into the note.
                  const src = sources[c.n - 1];
                  if (!src || !c.paragraph) return;
                  const { pinParagraphAnchor } = await import("../ai/paragraphPin");
                  const { paragraphLink } = await import("../ai/paragraphAnchors");
                  const current = await readWorkspaceFile(src.path).catch(() => src.content);
                  const pinned = pinParagraphAnchor(current, c.paragraph.anchor);
                  if (!pinned) return showAiToast(t("vaultCite.pinGone"), "error");
                  if (pinned.content !== current) await writeWorkspaceFile(src.path, pinned.content);
                  const link = paragraphLink(src.path, { blockId: pinned.id }) ?? "";
                  await navigator.clipboard?.writeText(link).catch(() => undefined);
                  showAiToast(t("vaultCite.pinned", { link }), "success");
                }}
              >
                {t("vaultCite.pin", { n: c.n })}
              </button>
            ) : null,
          )}
        </div>
      )}
      {checked.claims.some((c) => !c.supported) && (
        <div data-testid="vault-claims-unsupported" style={{ color: "hsl(var(--warn))", marginTop: 4 }}>
          {t("vaultCite.claimsUnsupported", { n: checked.claims.filter((c) => !c.supported).length, total: checked.claims.length })}
        </div>
      )}
    </div>
  );
}
