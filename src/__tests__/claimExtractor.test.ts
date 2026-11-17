/**
 * R12.11: paragraph → candidate claims. Selection and anchoring are rules;
 * the model's drafts are scripted here. The eval runs 20 SYNTHETIC
 * paragraphs (eval/synthetic/claims, tag dev) and its card must be what this
 * run computes (`LUMEN_WRITE_EVAL=1` rewrites it).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const toasts: Array<[string, string]> = [];
vi.mock("../ui/AiToast", () => ({ showAiToast: (m: string, k: string) => void toasts.push([m, k]) }));
vi.mock("../commands/domains/context", () => ({ cancellable: (fn: (s: AbortSignal) => Promise<unknown>) => fn(new AbortController().signal) }));
const runAgent = vi.fn();
vi.mock("../agents/runtime", () => ({ runAgent: (...a: unknown[]) => runAgent(...a), AgentRunError: class extends Error {} }));

import { anchorClaims, claimExtractorAgent, claimsCallout, extractClaims, inventedWords, selectCheckable, type ClaimDraft } from "../agents/defs/claimExtractor";
import { claimsFlow } from "../commands/domains/claimsAction";

const PARA = "Dana Levi works as an engineer in Haifa. She moved to Haifa in 2019. I think she should get a prize. Did she win?";
const meta = { note: "notes/dana.md", anchor: "p-1234abcd", model: "scripted", date: "2026-11-15T00:00:00Z" };
const draft = (sentence: number, text: string): ClaimDraft => ({ sentence, text, subject: "", predicate: "", object: "" });

describe("stage 1: selection", () => {
  it("leaves out questions, opinions and short sentences, with the reason", () => {
    expect(selectCheckable(PARA).map((s) => [s.n, s.reason])).toEqual([
      [1, null],
      [2, null],
      [3, "opinion"],
      [4, "question"],
    ]);
    expect(selectCheckable("לדעתי זה רעיון טוב מאוד. הוועדה אישרה את התקציב ב-2024. כן.").map((s) => s.reason)).toEqual(["opinion", null, "too-short"]);
  });
});

describe("stages 2–3 checks and anchoring", () => {
  it("a word the paragraph does not have is invented", () => {
    expect(inventedWords("Dana Levi works as a senior engineer in Haifa.", PARA)).toEqual(["senior"]);
    expect(inventedWords("דנה עברה לחיפה.", "היא עברה בחיפה. דנה לוי.")).toEqual([]);
    // ירה is בכירה without ב and כ, and also שירה without ש: three letters are not a shared word.
    expect(inventedWords("שירה עובדת כספרנית בכירה.", "שירה עובדת כספרנית.")).toEqual(["בכירה"]);
  });

  it("keeps faithful claims with the verifier's quote; a resolved pronoun is backed by its two sentences; the rest are dropped and counted", () => {
    const r = anchorClaims(PARA, selectCheckable(PARA), [
      draft(1, "Dana Levi works as an engineer in Haifa."),
      draft(2, "Dana Levi moved to Haifa in 2019."),
      draft(1, "Dana Levi works as a senior engineer in Haifa."),
      draft(1, "Dana Levi is not an engineer in Haifa."),
      draft(2, "Dana Levi moved to Haifa in 2017."),
      draft(3, "Dana Levi should get a prize."),
    ], meta);
    expect(r.claims.map((c) => c.text)).toEqual(["Dana Levi works as an engineer in Haifa.", "Dana Levi moved to Haifa in 2019."]);
    expect(r.claims[1].provenance.quote).toBe("Dana Levi works as an engineer in Haifa. She moved to Haifa in 2019.");
    for (const c of r.claims) {
      expect(c.status).toBe("candidate");
      expect(PARA.slice(c.provenance.start, c.provenance.end)).toBe(c.provenance.quote);
      expect(c.provenance).toMatchObject({ note: "notes/dana.md", anchor: "p-1234abcd", extractor: "claim-extractor@1", model: "scripted" });
      expect(c.provenance.paragraphHash).toMatch(/^fnv1a:[0-9a-f]{8}$/);
    }
    expect(r.dropped.map((d) => d.reason)).toEqual(["invented-words", "no-quote", "no-quote", "not-selected"]);
  });

  it("extractClaims sends only the checkable sentences to the model; none → no model call", async () => {
    const run = vi.fn(async () => ({ output: { claims: [draft(1, "Dana Levi works as an engineer in Haifa.")] }, model: "m" }));
    const r = await extractClaims(PARA, { note: "n.md", anchor: "a" }, run);
    expect(run).toHaveBeenCalledOnce();
    expect((run.mock.calls[0] as unknown as [{ extra: { selected: Array<{ n: number }> } }])[0].extra.selected.map((s) => s.n)).toEqual([1, 2]);
    expect(r.claims).toHaveLength(1);
    const none = vi.fn();
    expect((await extractClaims("Maybe later? I think so.", { note: "n.md", anchor: "a" }, none)).claims).toEqual([]);
    expect(none).not.toHaveBeenCalled();
  });

  it("the agent's validator refuses claims for sentences it was not given", () => {
    const check = claimExtractorAgent.validators![0].check as (o: unknown, i: unknown) => { ok: boolean };
    const input = { text: PARA, extra: { selected: [{ n: 1, text: "x" }] } };
    expect(check({ claims: [draft(1, "a b c")] }, input).ok).toBe(true);
    expect(check({ claims: [draft(3, "a b c")] }, input).ok).toBe(false);
  });

  it("the callout lists candidates with their quotes and says how many were dropped, in the paragraph's language", () => {
    const r = anchorClaims(PARA, selectCheckable(PARA), [draft(1, "Dana Levi works as an engineer in Haifa."), draft(3, "Dana should get a prize.")], meta);
    expect(claimsCallout(r, "en")).toBe("> [!claims] Candidate claims (1) · 1 dropped (no quote, or words not in the paragraph) · 2 sentences not checkable\n> - Dana Levi works as an engineer in Haifa. — “Dana Levi works as an engineer in Haifa”");
    expect(claimsCallout(r, "he")).toContain("טענות מועמדות (1)");
  });
});

describe("the ai.claims command: the paragraph at the cursor → a callout under it, staged for review", () => {
  it("proposes the candidates after the paragraph; the note is unchanged until the proposal is approved", async () => {
    const { listStagedChanges, discardRunChanges } = await import("../agents/staging");
    const doc = `# Note\n\n${PARA}\n\nAnother paragraph.`;
    const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: doc.indexOf("moved") } }) });
    runAgent.mockResolvedValueOnce({ status: "ok", model: "m", output: { claims: [draft(2, "Dana Levi moved to Haifa in 2019."), draft(1, "Dana Levi works as a senior engineer in Haifa.")] } });
    const before = listStagedChanges().length;
    await claimsFlow({ getEditorView: () => view, liveDoc: () => ({ name: "dana.md", content: doc, dirty: false, workspaceName: "notes/dana.md" }) as never });
    // the AI suggests, the user approves: nothing is written into the editor by the command itself
    expect(view.state.doc.toString()).toBe(doc);
    const staged = listStagedChanges().slice(before);
    expect(staged).toHaveLength(1);
    const c = staged[0] as Extract<(typeof staged)[number], { kind: "range" }>;
    expect(c).toMatchObject({ kind: "range", path: "notes/dana.md", status: "pending", agentId: "claim-extractor", tool: "insert_claims", before: "" });
    const at = doc.indexOf(PARA) + PARA.length;
    expect([c.from, c.to]).toEqual([at, at]);
    expect(c.after).toContain("\n\n> [!claims] Candidate claims (1) · 1 dropped");
    expect(c.after).toContain("> - Dana Levi moved to Haifa in 2019. — “Dana Levi works as an engineer in Haifa. She moved to Haifa in 2019.”");
    expect(c.summary).toMatch(/^Candidate claims \(1\)/);
    expect(toasts.at(-1)?.[1]).toBe("success");
    discardRunChanges(c.runId ?? "");
    view.destroy();
  });
});

describe("R12.11 eval: 20 synthetic paragraphs", () => {
  interface Case {
    id: string;
    lang: string;
    paragraph: string;
    drafts: Array<ClaimDraft & { label: string }>;
  }
  const SET = JSON.parse(readFileSync("eval/synthetic/claims/cases.json", "utf8")) as { name: string; version: string; license: string; cases: Case[] };
  const RESULT = "eval/cards/claim-extractor.json";

  const rows = SET.cases.map((c) => {
    const r = anchorClaims(c.paragraph, selectCheckable(c.paragraph), c.drafts, { note: `${c.id}.md`, anchor: "p-0", model: "scripted", date: "2026-11-15T00:00:00Z" });
    const kept = new Set(r.claims.map((x) => x.text));
    let tp = 0, fp = 0, fn = 0, reasonOk = 0, noQuote = 0;
    for (const d of c.drafts) {
      const k = kept.has(d.text);
      if (d.label === "keep") k ? tp++ : fn++;
      else {
        if (k) fp++;
        if (r.dropped.some((x) => x.text === d.text && x.reason === d.label)) reasonOk++;
      }
    }
    for (const x of r.claims) if (!x.provenance.quote || c.paragraph.slice(x.provenance.start, x.provenance.end) !== x.provenance.quote) noQuote++;
    return { id: c.id, lang: c.lang, tp, fp, fn, reasonOk, noQuote };
  });

  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const metrics = (rs: typeof rows) => {
    const s = rs.reduce((a, r) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn, noQuote: a.noQuote + r.noQuote }), { tp: 0, fp: 0, fn: 0, noQuote: 0 });
    return { precision: s.tp + s.fp ? s.tp / (s.tp + s.fp) : 1, recall: s.tp + s.fn ? s.tp / (s.tp + s.fn) : 1, claimsWithoutQuote: s.noQuote };
  };
  const r4 = (x: number) => Math.round(x * 10000) / 10000;

  it("no claim without a quote, and every planted bad draft dropped for its reason", () => {
    expect(rows).toHaveLength(20);
    expect(metrics(rows).claimsWithoutQuote).toBe(0);
    expect(rows.every((r) => r.reasonOk === 3)).toBe(true);
  });

  it("the committed card is what this run computes", () => {
    const m = metrics(rows);
    const rand = rng(11);
    const draws: Record<string, number[]> = {};
    for (let b = 0; b < 1000; b++) {
      const sample = rows.map(() => rows[Math.floor(rand() * rows.length)]);
      for (const [k, v] of Object.entries(metrics(sample))) (draws[k] ??= []).push(v);
    }
    const ci = Object.fromEntries(Object.entries(draws).map(([k, v]) => (v.sort((a, b) => a - b), [k, [r4(v[25]), r4(v[974])]])));
    const report = {
      card: {
        schema: 1,
        tag: "dev",
        model: { name: "scripted drafts (no model): this measures the rules around the model", digest: "n/a (no model weights)" },
        seed: 11,
        temperature: 0,
        dataset: { name: SET.name, version: SET.version, license: SET.license },
        n: rows.length,
        metrics: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { value: r4(v), ci95: ci[k], method: "bootstrap" }])),
      },
      perCase: rows,
      note: "SYNTHETIC set written for R12.11 (tag dev). A real-model run (Ollama on the Mac) is owed.",
    };
    if (process.env.LUMEN_WRITE_EVAL === "1") writeFileSync(RESULT, `${JSON.stringify(report, null, 1)}\n`);
    expect(JSON.parse(readFileSync(RESULT, "utf8"))).toEqual(report);
  });
});

describe("rules the planted probes added", () => {
  it("a claim that still leans on a pronoun is not standalone (English anywhere; Hebrew only as its first word)", async () => {
    const { unresolvedPronoun } = await import("../agents/defs/claimExtractor");
    expect(unresolvedPronoun("Under her, leaks fell by 30 percent.")).toBe(true);
    expect(unresolvedPronoun("הוא זכה בפרס ספיר.")).toBe(true);
    expect(unresolvedPronoun("אורי שגיא הוא ראש עיריית חדרה.")).toBe(false);
    expect(unresolvedPronoun("Lior Katz has led the utility since 2018.")).toBe(false);
  });

  it("the paragraph's numbers or names in another order are dropped as reordered", () => {
    const para = "The museum now has 14 galleries, up from 9. Gal Mizrahi moved from Eilat to Nazareth in 2012.";
    const r = anchorClaims(para, selectCheckable(para), [
      { sentence: 1, text: "The museum now has 9 galleries, up from 14.", subject: "", predicate: "", object: "" },
      { sentence: 2, text: "Gal Mizrahi moved from Nazareth to Eilat in 2012.", subject: "", predicate: "", object: "" },
      { sentence: 2, text: "Gal Mizrahi moved from Eilat to Nazareth in 2012.", subject: "", predicate: "", object: "" },
    ], meta);
    expect(r.dropped.map((d) => d.reason)).toEqual(["reordered", "reordered"]);
    expect(r.claims.map((c) => c.text)).toEqual(["Gal Mizrahi moved from Eilat to Nazareth in 2012."]);
  });
});

describe("R12.11 eval: the planted probe set (eval/probes/claims-planted.json)", () => {
  // Hand-written apart from the generated dev set, with the failures a small local model makes. Honest numbers:
  // a planted bad draft the rules keep is a false positive here, and a faithful claim they drop is a miss.
  interface Probe {
    id: string;
    lang: string;
    paragraph: string;
    drafts: Array<{ sentence: number; text: string; label: string }>;
  }
  const SET = JSON.parse(readFileSync("eval/probes/claims-planted.json", "utf8")) as { version: string; license: string; cases: Probe[] };
  const RESULT = "eval/cards/claim-extractor-probes.json";
  const results = SET.cases.flatMap((c) => {
    const drafts = c.drafts.map((d) => ({ ...d, subject: "", predicate: "", object: "" }));
    const r = anchorClaims(c.paragraph, selectCheckable(c.paragraph), drafts, { note: `${c.id}.md`, anchor: "p-0", model: "scripted", date: "2026-11-17T00:00:00Z" });
    const kept = new Set(r.claims.map((x) => x.text));
    const unquoted = r.claims.filter((x) => !x.provenance.quote || c.paragraph.slice(x.provenance.start, x.provenance.end) !== x.provenance.quote).length;
    return c.drafts.map((d) => ({ id: c.id, lang: c.lang, label: d.label, text: d.text, kept: kept.has(d.text), unquoted }));
  });

  it("is not empty, and plants every failure kind in both languages", () => {
    expect(SET.cases.length).toBeGreaterThanOrEqual(16);
    for (const lang of ["he", "en"]) for (const label of ["keep", "changed-number", "negation", "swapped-entity", "invented", "opinion"]) expect(results.some((r) => r.lang === lang && r.label === label), `${lang} ${label}`).toBe(true);
  });

  it("no kept claim is without its quote (the acceptance), on the probes too", () => {
    expect(results.reduce((a, r) => a + r.unquoted, 0)).toBe(0);
  });

  it("the committed probe card is what this run computes (precision and recall as they come out)", () => {
    const count = (rs: typeof results) => ({
      tp: rs.filter((r) => r.label === "keep" && r.kept).length,
      fn: rs.filter((r) => r.label === "keep" && !r.kept).length,
      fp: rs.filter((r) => r.label !== "keep" && r.kept).length,
    });
    const pr = (c: { tp: number; fp: number; fn: number }) => ({ precision: c.tp + c.fp ? c.tp / (c.tp + c.fp) : 1, recall: c.tp + c.fn ? c.tp / (c.tp + c.fn) : 1 });
    const { tp, fp, fn } = count(results);
    const point = pr({ tp, fp, fn });
    const byLabel: Record<string, { n: number; kept: number }> = {};
    for (const r of results) {
      const b = (byLabel[r.label] ??= { n: 0, kept: 0 });
      b.n++;
      if (r.kept) b.kept++;
    }
    const r4 = (x: number) => Math.round(x * 10000) / 10000;
    // 95% bootstrap over paragraphs (a paragraph's drafts stay together), seeded as the dev card is
    let a = 11 >>> 0;
    const rand = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const ids = SET.cases.map((c) => c.id);
    const draws: Record<"precision" | "recall", number[]> = { precision: [], recall: [] };
    for (let b = 0; b < 1000; b++) {
      const sample = ids.flatMap(() => results.filter((r) => r.id === ids[Math.floor(rand() * ids.length)]));
      const m = pr(count(sample));
      draws.precision.push(m.precision);
      draws.recall.push(m.recall);
    }
    const ci = (v: number[]) => (v.sort((x, y) => x - y), [r4(v[25]), r4(v[974])]);
    const report = {
      card: {
        schema: 1,
        tag: "dev",
        model: { name: "scripted drafts (no model): this measures the rules around the model", digest: "n/a (no model weights)" },
        seed: 11,
        temperature: 0,
        dataset: { name: "claims-planted", version: SET.version, license: SET.license },
        n: results.length,
        metrics: {
          precision: { value: r4(point.precision), ci95: ci(draws.precision), method: "bootstrap" },
          recall: { value: r4(point.recall), ci95: ci(draws.recall), method: "bootstrap" },
        },
      },
      counts: { tp, fp, fn },
      byLabel,
      leaks: results.filter((r) => r.label !== "keep" && r.kept).map((r) => `${r.id} ${r.label}: ${r.text}`),
      misses: results.filter((r) => r.label === "keep" && !r.kept).map((r) => `${r.id}: ${r.text}`),
      note: "Hand-planted probes (same author as the rules, so development numbers). The probes found two gaps, now rules: a pronoun left in the claim (unresolved-pronoun) and the paragraph's numbers or Latin names in another order (reordered). Still leaking: a Hebrew entity swapped for one named in another sentence, and two sentences merged into one claim; the review queue is where a person catches them. Recall misses are claims that reword (an inflection the paragraph lacks) or join an antecedent from another sentence that the quote gate cannot cover.",
    };
    if (process.env.LUMEN_WRITE_EVAL === "1") writeFileSync(RESULT, `${JSON.stringify(report, null, 1)}\n`);
    expect(JSON.parse(readFileSync(RESULT, "utf8"))).toEqual(report);
  });
});
