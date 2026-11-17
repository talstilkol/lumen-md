/**
 * W13.A5: a model card for each agent — model, licence, eval score and the
 * date it was measured, only from eval/results and eval cards; "not
 * measured" (and no number) when there is no card; English and Hebrew.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs without types
import { buildCards } from "../../scripts/model-cards.mjs";
import { ModelCard, reportsFor } from "../ui/ModelCard";
import { ModelCardToggle } from "../ui/ModelCardToggle";
import { EVAL_AGENTS } from "../agents/agentIds";

afterEach(() => {
  cleanup();
  document.documentElement.lang = "en";
});

const committed = JSON.parse(readFileSync("src/agents/modelCards.generated.json", "utf8"));
const card = (over: Record<string, unknown> = {}) => ({
  schema: 1,
  tag: "dev",
  model: { name: "qwen3:4b", digest: "sha256:abc" },
  seed: 1,
  temperature: 0,
  dataset: { name: "set", version: "1", license: "CC0-1.0" },
  n: 40,
  metrics: { precision: { value: 0.8, ci95: [0.7, 0.9], method: "bootstrap" } },
  ...over,
});

describe("the data comes only from eval cards", () => {
  it("the committed file is what scripts/model-cards.mjs builds from eval/results and eval/cards (dates aside)", () => {
    const strip = (j: { agents: Record<string, Array<Record<string, unknown>>> }) => Object.fromEntries(Object.entries(j.agents).map(([a, l]) => [a, l.map(({ measuredOn: _d, ...r }) => r)]));
    expect(strip(buildCards({ dateOf: () => null }))).toEqual(strip(committed));
    expect(Object.keys(committed.agents).length).toBeGreaterThan(0);
    for (const list of Object.values(committed.agents) as Array<Array<{ measuredOn: string | null }>>) for (const r of list) expect(r.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("a report without a complete card adds nothing; one with an agent and a complete card does", () => {
    const root = mkdtempSync(join(tmpdir(), "cards-"));
    mkdirSync(join(root, "eval/results"), { recursive: true });
    writeFileSync(join(root, "eval/results/a.json"), JSON.stringify({ agent: "tagger", card: card({ n: undefined }) }));
    writeFileSync(join(root, "eval/results/b.json"), JSON.stringify({ agent: "tagger", precision: 0.99 })); // a number with no card at all
    writeFileSync(join(root, "eval/results/c.json"), JSON.stringify({ card: card() })); // no agent: a suite-wide report
    expect(buildCards({ root, dateOf: () => "2026-11-01" }).agents).toEqual({});
    writeFileSync(join(root, "eval/results/d.json"), JSON.stringify({ agent: "tagger", card: card() }));
    expect(buildCards({ root, dateOf: () => "2026-11-01" }).agents.tagger).toEqual([{ source: "eval/results/d.json", measuredOn: "2026-11-01", tag: "dev", model: "qwen3:4b", dataset: { name: "set", version: "1", license: "CC0-1.0" }, n: 40, metrics: [{ name: "precision", value: 0.8, ci95: [0.7, 0.9] }] }]);
  });
});

describe("the card", () => {
  it("an agent without an eval card: 'not measured' and not one number", () => {
    const unmeasured = EVAL_AGENTS.filter((a) => !reportsFor(a).length);
    expect(unmeasured.length).toBeGreaterThan(0);
    for (const agent of unmeasured) {
      const { container, unmount } = render(createElement(ModelCard, { agent }));
      expect(screen.getByTestId("model-card-unmeasured").textContent).toMatch(/Not measured/);
      expect(container.querySelector("[data-testid=model-card-report]")).toBeNull();
      expect(container.textContent!.replace(agent, "")).not.toMatch(/\d/);
      unmount();
    }
  });

  it("an agent with a card: each metric with its interval, the tag, n and the date — the numbers are the card's", () => {
    const [r] = reportsFor("concision");
    render(createElement(ModelCard, { agent: "concision" }));
    const report = screen.getByTestId("model-card-report");
    expect(report.textContent).toMatch(/Developer set \(written by us, not a quality claim\)/);
    expect(report.textContent).toContain(`${r.n} items`);
    expect(report.textContent).toMatch(/measured [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    const shown = (report.textContent!.replace(/95% interval/g, "").match(/\d+(?:\.\d+)?%/g) ?? []).map((x) => Number(x.slice(0, -1)) / 100);
    const expected = r.metrics.flatMap((m) => [m.value, ...m.ci95]);
    expect(shown).toEqual(expected);
  });

  it("in Hebrew", () => {
    document.documentElement.lang = "he";
    render(createElement(ModelCard, { agent: "tagger" }));
    // The i18n module reads the active locale; the Hebrew strings exist for every key the card uses.
    const he = JSON.parse(readFileSync("src/i18n/locales/he/common.json", "utf8"));
    const en = JSON.parse(readFileSync("src/i18n/lazy/modelCard.json", "utf8"));
    for (const k of Object.keys(en)) {
      expect(he[k], k).toMatch(/[א-ת]/);
      expect(he[k], k).not.toBe(en[k]);
    }
    expect(screen.getByTestId("model-card")).toBeTruthy();
  });

  it("names the run's model and looks up its licence in the model list", async () => {
    const reg = JSON.parse(readFileSync("models/registry.json", "utf8")) as { models: Array<{ id: string; license: string; delivery?: string }> };
    const m = reg.models.find((x) => x.license && x.delivery !== "none")!;
    render(createElement(ModelCard, { agent: "tagger", model: m.id }));
    await waitFor(() => expect(screen.getByTestId("model-card").textContent).toContain(m.license));
    expect(screen.getByTestId("model-card").textContent).toContain(m.id);
  });

  it("the review screen's toggle opens and closes the card (aria-expanded)", async () => {
    render(createElement(ModelCardToggle, { agent: "proofreader" }));
    const b = screen.getByRole("button", { name: /Model card/ });
    expect(b.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(b);
    expect(b.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(screen.getByTestId("model-card").getAttribute("data-agent")).toBe("proofreader"));
    fireEvent.click(b);
    expect(screen.queryByTestId("model-card")).toBeNull();
  });
});
