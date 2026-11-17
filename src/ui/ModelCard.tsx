/**
 * An agent's model card (plan W13.A5): which model it runs, under what
 * licence, how it scored in the eval and when that was measured.
 *
 * Every number comes from a committed eval report with a complete card
 * (src/agents/modelCards.generated.json, written by scripts/model-cards.mjs
 * from eval/results and eval/cards). An agent without one shows "not
 * measured" — never a number without its card. A developer set ("dev": one
 * the authors wrote) is labelled as such: it is not a quality claim. The
 * link opens the public benchmark page (W11.H13) in the in-app help, so
 * nothing is fetched.
 */
import { useEffect, useState } from "react";
import { t } from "../i18n";
import cards from "../agents/modelCards.generated.json";
import { openHelp } from "./HelpButton";
import "./modelCardStrings";

export interface CardReport {
  source: string;
  measuredOn: string | null;
  tag: "dev" | "heldout" | "public";
  model: string;
  dataset: { name: string; version: string; license: string; origin?: string };
  n: number;
  metrics: Array<{ name: string; value: number; ci95: [number, number]; judge?: string }>;
}

const DATA = cards as unknown as { agents: Record<string, CardReport[]> };

/** The reports behind an agent's card (empty: not measured). */
export function reportsFor(agent: string): CardReport[] {
  return DATA.agents[agent] ?? [];
}

const locale = () => (typeof document !== "undefined" && document.documentElement.lang) || undefined;

/** A share (0..1) as a percentage, anything else as a number. */
export function formatMetric(v: number, unitShare: boolean): string {
  return unitShare ? new Intl.NumberFormat(locale(), { style: "percent", maximumFractionDigits: 1 }).format(v) : new Intl.NumberFormat(locale(), { maximumFractionDigits: 3 }).format(v);
}

function formatDate(d: string | null): string {
  if (!d) return t("modelCard.dateUnknown");
  const at = new Date(`${d}T12:00:00Z`);
  return Number.isNaN(at.getTime()) ? d : new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(at);
}

/** The licence of a model named at run time, from models/registry.json (loaded only when a card opens). */
async function licenceOf(model: string): Promise<string | null> {
  const reg = (await import("../../models/registry.json")).default as { models: Array<{ id: string; license: string }> };
  const want = model.toLowerCase().replace(/[:@].*$/, "");
  return reg.models.find((m) => m.id.toLowerCase() === model.toLowerCase())?.license ?? reg.models.find((m) => m.id.toLowerCase().includes(want) || want.includes(m.id.toLowerCase()))?.license ?? null;
}

export function ModelCard({ agent, model }: { agent: string; model?: string | null }) {
  const reports = reportsFor(agent);
  const [licence, setLicence] = useState<string | null | undefined>(model ? undefined : null);
  useEffect(() => {
    if (!model) return;
    let live = true;
    void licenceOf(model)
      .then((l) => live && setLicence(l))
      .catch(() => live && setLicence(null));
    return () => {
      live = false;
    };
  }, [model]);
  const dt: React.CSSProperties = { fontSize: 11.5, color: "hsl(var(--fg-muted))" };
  return (
    <section aria-label={t("modelCard.title", { agent })} data-testid="model-card" data-agent={agent} style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, padding: "8px 10px", border: "1px solid hsl(var(--border))", borderRadius: 8 }}>
      <strong>{t("modelCard.title", { agent })}</strong>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "2px 10px", margin: 0 }}>
        <dt style={dt}>{t("modelCard.model")}</dt>
        <dd style={{ margin: 0 }}>
          <bdi>{model || t("modelCard.modelFromSettings")}</bdi>
        </dd>
        <dt style={dt}>{t("modelCard.licence")}</dt>
        <dd style={{ margin: 0 }}>{licence === undefined ? "…" : licence ? <bdi>{licence}</bdi> : t("modelCard.licenceUnknown")}</dd>
      </dl>
      {reports.length === 0 ? (
        <p data-testid="model-card-unmeasured" style={{ margin: 0 }}>
          {t("modelCard.notMeasured")}
        </p>
      ) : (
        reports.map((r) => (
          <div key={r.source} data-testid="model-card-report" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div>
              {t(`modelCard.tag.${r.tag}`)} · {t("modelCard.measuredOn", { date: formatDate(r.measuredOn) })} · {t("modelCard.n", { n: r.n })}
            </div>
            <div style={dt}>
              {t("modelCard.dataset")}: <bdi>{r.dataset.name}</bdi> ({r.dataset.license}) · {t("modelCard.evalModel")}: <bdi>{r.model}</bdi>
            </div>
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {r.metrics.map((m) => {
                const share = m.value >= 0 && m.value <= 1 && m.ci95.every((x) => x >= 0 && x <= 1);
                return (
                  <li key={m.name}>
                    <bdi>{m.name.replace(/_/g, " ")}</bdi>: {formatMetric(m.value, share)} <span style={dt}>({t("modelCard.ci", { lo: formatMetric(m.ci95[0], share), hi: formatMetric(m.ci95[1], share) })})</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
      <div>
        <button type="button" className="lm-link" onClick={() => openHelp("project/hebrew-benchmark")} style={{ padding: 0, border: 0, background: "none", color: "hsl(var(--accent, 221 83% 53%))", cursor: "pointer", textDecoration: "underline", font: "inherit" }}>
          {t("modelCard.benchmark")}
        </button>
      </div>
    </section>
  );
}

export default ModelCard;
