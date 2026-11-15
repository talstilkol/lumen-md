/**
 * "Search Wikidata" for an entity (plan W12.E10). Asks first — this once,
 * or always for this vault — and only then sends the entity's name, and
 * nothing else, to www.wikidata.org through the privacy ledger. Choosing an
 * item writes its QID to the note's `wikidata` property, refused when the
 * note changed since the dialog read it. Wikidata's data is CC0. Not shown
 * in airplane mode (the host and the command check it).
 */
import { useEffect, useState } from "react";
import { t } from "../i18n";
import { ledgerFetch } from "../ai/privacyLedger";
import { CONSENT_PATH, LEDGER_REASON, WIKIDATA_LICENCE, consentFile, consentFromFile, searchWikidata, withQid, type WikidataHit } from "../entities/wikidata";
import "./entityGraphStrings";
import { Modal } from "./Modal";

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
type Phase = { at: "loading" } | { at: "ask" } | { at: "searching" } | { at: "results"; hits: WikidataHit[] } | { at: "linked"; qid: string } | { at: "error"; message: string };

export function WikidataLink({ name, path, onClose, vault, fetchImpl }: WikidataLinkProps) {
  const [phase, setPhase] = useState<Phase>({ at: "loading" });
  const [read, setRead] = useState<string | null>(null);
  const ws = async (): Promise<WikidataVault> => vault ?? ((await import("../storage/workspace")) as unknown as WikidataVault);

  const search = async () => {
    setPhase({ at: "searching" });
    try {
      // Only after the user chose: the consented, recorded fetch (a local-only policy would otherwise refuse it).
      setPhase({ at: "results", hits: await searchWikidata(name, fetchImpl ?? ledgerFetch({ force: { category: "cloud-text", reason: LEDGER_REASON }, consent: true })) });
    } catch (e) {
      setPhase({ at: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const v = await ws();
      const note = await v.readWorkspaceFile(path);
      const always = consentFromFile((await v.workspaceHasFile(CONSENT_PATH)) ? await v.readWorkspaceFile(CONSENT_PATH) : null);
      if (cancelled) return;
      setRead(note);
      if (always) void search();
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

  const always = async () => {
    await (await ws()).writeWorkspaceFile(CONSENT_PATH, consentFile());
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
              <button type="button" style={btn} onClick={() => void always()}>
                {t("entityGraph.wikidata.always")}
              </button>
              <button type="button" style={btn} onClick={onClose}>
                {t("entityGraph.wikidata.cancel")}
              </button>
            </div>
          </>
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
            <p>{t("entityGraph.wikidata.none")}</p>
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
