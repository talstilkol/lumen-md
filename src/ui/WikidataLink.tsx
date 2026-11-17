/**
 * "Search Wikidata" for an entity (plan W12.E10). Asks first — this once,
 * or always on this device (an app setting, never a vault file: review
 * Z7-M3) — and only then sends the entity's name, and nothing else, to
 * www.wikidata.org through the privacy ledger. Under the local-only AI
 * policy it sends nothing, whatever was agreed, and says why. Choosing an
 * item writes its QID to the note's `wikidata` property, refused when the
 * note changed since the dialog read it. Wikidata's data is CC0. Not shown
 * in airplane mode (the host and the command check it).
 */
import { useEffect, useState } from "react";
import { t } from "../i18n";
import { ledgerFetch } from "../ai/privacyLedger";
import { getAiPolicy } from "../ai/policy";
import { LEDGER_REASON, WIKIDATA_LICENCE, searchWikidata, setWikidataAlways, wikidataAlways, withQid, type WikidataHit } from "../entities/wikidata";
import "./entityGraphStrings";
import { Modal } from "./Modal";
import { EmptyState, learnHow } from "./EmptyState";
import { HelpButton } from "./HelpButton";

export interface WikidataVault {
  readWorkspaceFile(path: string): Promise<string>;
  writeWorkspaceFile(path: string, content: string): Promise<unknown>;
  workspaceHasFile(path: string): Promise<boolean>;
}

export interface WikidataLinkProps {
  /** The entity's name (what is searched) and its note. */
  name: string;
  path: string;
  onClose: () => void;
  vault?: WikidataVault;
  fetchImpl?: typeof fetch;
}

const btn: React.CSSProperties = { padding: "4px 10px", fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit", cursor: "pointer", textAlign: "start" };
type Phase = { at: "loading" } | { at: "localOnly" } | { at: "ask" } | { at: "searching" } | { at: "results"; hits: WikidataHit[] } | { at: "linked"; qid: string } | { at: "error"; message: string };

export function WikidataLink({ name, path, onClose, vault, fetchImpl }: WikidataLinkProps) {
  const [phase, setPhase] = useState<Phase>({ at: "loading" });
  const [read, setRead] = useState<string | null>(null);
  const ws = async (): Promise<WikidataVault> => vault ?? ((await import("../storage/workspace")) as unknown as WikidataVault);

  const search = async () => {
    setPhase({ at: "searching" });
    try {
      // Only after the user chose. Not marked as consented (Z7-M3): under local-only the ledger refuses it as well.
      if (getAiPolicy() === "local-only") return setPhase({ at: "localOnly" });
      setPhase({ at: "results", hits: await searchWikidata(name, fetchImpl ?? ledgerFetch({ force: { category: "cloud-text", reason: LEDGER_REASON } })) });
    } catch (e) {
      setPhase({ at: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const v = await ws();
      const note = await v.readWorkspaceFile(path);
      if (cancelled) return;
      setRead(note);
      // Z7-M3: local-only refuses before any question; the standing consent is this device's, not the vault's.
      if (getAiPolicy() === "local-only") setPhase({ at: "localOnly" });
      else if (wikidataAlways()) void search();
      else setPhase({ at: "ask" });
    })().catch((e) => !cancelled && setPhase({ at: "error", message: String(e?.message ?? e) }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened entity
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const always = () => {
    setWikidataAlways(true);
    void search();
  };
  const link = async (qid: string) => {
    try {
      const v = await ws();
      const now = await v.readWorkspaceFile(path);
      if (now !== read) throw new Error(t("entityGraph.wikidata.changed"));
      await v.writeWorkspaceFile(path, withQid(now, qid));
      setPhase({ at: "linked", qid });
    } catch (e) {
      setPhase({ at: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Modal onClose={onClose} className="cmd-palette-backdrop" onClick={onClose} aria-label={t("entityGraph.wikidata.title")} data-testid="wikidata-link">
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, padding: 18, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
        <span style={{ float: "inline-end", marginInlineStart: 8 }}><HelpButton topic="workspace/entity-graph" /></span>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          {t("entityGraph.wikidata.title")}: <span dir="auto">{name}</span>
        </h2>
        {phase.at === "ask" && (
          <>
            <p style={{ margin: 0 }}>{t("entityGraph.wikidata.ask", { name })}</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" style={btn} onClick={() => void search()}>
                {t("entityGraph.wikidata.once")}
              </button>
              <button type="button" style={btn} onClick={always}>
                {t("entityGraph.wikidata.always")}
              </button>
              <button type="button" style={btn} onClick={onClose}>
                {t("entityGraph.wikidata.cancel")}
              </button>
            </div>
          </>
        )}
        {phase.at === "localOnly" && (
          <p role="status" style={{ margin: 0 }}>
            {t("entityGraph.wikidata.localOnly")}
          </p>
        )}
        {(phase.at === "loading" || phase.at === "searching") && <p role="status">{t("entityGraph.wikidata.searching")}</p>}
        {phase.at === "results" &&
          (phase.hits.length ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }} aria-label={t("entityGraph.wikidata.results")}>
              {phase.hits.map((h) => (
                <li key={h.id}>
                  <button type="button" style={{ ...btn, inlineSize: "100%" }} onClick={() => void link(h.id)}>
                    <span dir="auto">{h.label}</span> <code>{h.id}</code>
                    {h.description && (
                      <>
                        {" · "}
                        <span dir="auto">{h.description}</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState style={{ padding: 0 }} message={t("entityGraph.wikidata.none")} action={learnHow("workspace/entity-graph")} />
          ))}
        {phase.at === "linked" && (
          <p role="status">
            {t("entityGraph.wikidata.linked", { qid: phase.qid })} {t("entityGraph.wikidata.licence", { licence: WIKIDATA_LICENCE })}
          </p>
        )}
        {phase.at === "error" && <p role="alert">{phase.message}</p>}
        <p style={{ margin: 0, color: "hsl(var(--fg-muted))" }}>{t("entityGraph.wikidata.privacy")}</p>
      </div>
    </Modal>
  );
}
