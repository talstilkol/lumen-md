/**
 * Tests for the local-only insights analyzer. Covers JSONL/JSON parsing,
 * shape detection, frequency / co-occurrence / group summary, derived
 * conclusions, and the file-generation helpers that turn the dataset into
 * new markdown documents.
 */

import { describe, it, expect } from "vitest";
import {
  coOccurrence,
  describeDataset,
  deriveConclusions,
  deriveSuggestions,
  frequencyTable,
  groupSummary,
  parseJsonRecords,
} from "../data/insights";
import {
  cooccurrenceDoc,
  frequencyDoc,
  splitByField,
  summaryReport,
  tasklistByField,
} from "../data/insightsExport";

const SAMPLE = [
  { idx: 1, file: "a.pdf", question: "Q1", task_ids: ["alpha", "beta"], micro_tasks: ["m1", "m2"] },
  { idx: 2, file: "a.pdf", question: "Q1", task_ids: ["alpha"], micro_tasks: ["m1"] },
  { idx: 3, file: "b.pdf", question: "Q2", task_ids: ["beta", "gamma"], micro_tasks: ["m3"] },
  { idx: 4, file: "b.pdf", question: "Q3", task_ids: ["alpha", "gamma"], micro_tasks: ["m2", "m3"] },
];

const JSONL = SAMPLE.map((r) => JSON.stringify(r)).join("\n");
const JSON_ARRAY = JSON.stringify(SAMPLE);

describe("parseJsonRecords", () => {
  it("parses JSONL (one JSON value per line)", () => {
    expect(parseJsonRecords(JSONL)).toHaveLength(4);
  });
  it("parses a JSON array as records", () => {
    expect(parseJsonRecords(JSON_ARRAY)).toHaveLength(4);
  });
  it("parses a single JSON object as one record", () => {
    expect(parseJsonRecords('{"a":1}')).toEqual([{ a: 1 }]);
  });
  it("ignores blank lines in JSONL", () => {
    const text = `\n${JSONL}\n\n`;
    expect(parseJsonRecords(text)).toHaveLength(4);
  });
  it("throws with a line number on a JSONL parse error", () => {
    const broken = `${JSON.stringify(SAMPLE[0])}\nnot json\n`;
    expect(() => parseJsonRecords(broken)).toThrow(/line 2/);
  });
  it("returns [] on empty input", () => {
    expect(parseJsonRecords("")).toEqual([]);
    expect(parseJsonRecords("   \n\n")).toEqual([]);
  });
});

describe("describeDataset", () => {
  it("identifies fields, array fields, and groupable fields", () => {
    const shape = describeDataset(SAMPLE);
    expect(shape.fields).toEqual(
      expect.arrayContaining(["idx", "file", "question", "task_ids", "micro_tasks"]),
    );
    expect(shape.arrayFields).toEqual(
      expect.arrayContaining(["task_ids", "micro_tasks"]),
    );
    // `idx` is id-like and excluded; `file` and `question` are low-cardinality.
    expect(shape.groupableFields).toContain("file");
    expect(shape.groupableFields).toContain("question");
    expect(shape.groupableFields).not.toContain("idx");
    expect(shape.groupableFields).not.toContain("task_ids");
    // No fields should be flagged as truncated for this small sample.
    expect(shape.truncatedFields).toEqual([]);
  });

  it("flags fields whose distinct count exceeds the in-shape cap and excludes them from groupableFields", () => {
    // Build 250 records with a unique `id` per row; the 200-distinct cap
    // should fire and the field should be flagged truncated + dropped
    // from groupable detection (rather than silently miscategorised).
    const rows = Array.from({ length: 250 }, (_, i) => ({ uniq: `v${i}` }));
    const shape = describeDataset(rows);
    expect(shape.truncatedFields).toContain("uniq");
    expect(shape.groupableFields).not.toContain("uniq");
  });
});

describe("frequencyTable", () => {
  it("counts every array element and computes probabilities", () => {
    const f = frequencyTable(SAMPLE, "task_ids");
    // alpha: 3, beta: 2, gamma: 2 → total 7
    expect(f.total).toBe(7);
    const alpha = f.entries.find((e) => e.value === "alpha")!;
    expect(alpha.count).toBe(3);
    expect(alpha.probability).toBeCloseTo(3 / 7, 5);
  });
  it("counts scalar fields once per record", () => {
    const f = frequencyTable(SAMPLE, "file");
    expect(f.total).toBe(4);
    expect(f.entries.find((e) => e.value === "a.pdf")!.count).toBe(2);
    expect(f.entries.find((e) => e.value === "b.pdf")!.count).toBe(2);
  });
  it("sorts entries by count descending", () => {
    const f = frequencyTable(SAMPLE, "task_ids");
    expect(f.entries[0].value).toBe("alpha");
  });
});

describe("coOccurrence", () => {
  it("builds a symmetric matrix with diagonals = per-value record counts", () => {
    const m = coOccurrence(SAMPLE, "task_ids");
    expect(m.labels).toEqual(expect.arrayContaining(["alpha", "beta", "gamma"]));
    const i = m.labels.indexOf("alpha");
    const j = m.labels.indexOf("beta");
    expect(m.matrix[i][i]).toBe(3); // alpha appears in 3 records
    expect(m.matrix[i][j]).toBe(m.matrix[j][i]); // symmetry
    expect(m.matrix[i][j]).toBe(1); // alpha+beta only in record 1
  });
  it("ignores non-array fields gracefully", () => {
    const m = coOccurrence(SAMPLE, "file");
    expect(m.labels).toEqual([]);
  });
});

describe("groupSummary", () => {
  it("returns counts and shares per group, sorted by count desc", () => {
    const groups = groupSummary(SAMPLE, "file");
    expect(groups).toHaveLength(2);
    expect(groups[0].count).toBe(2);
    expect(groups[0].share).toBeCloseTo(0.5);
  });
});

describe("deriveConclusions", () => {
  it("always includes the row count as the first conclusion", () => {
    const shape = describeDataset(SAMPLE);
    const c = deriveConclusions(SAMPLE, shape);
    expect(c[0].headline).toMatch(/4 records/);
  });
  it("calls out the empty case explicitly", () => {
    const shape = describeDataset([]);
    const c = deriveConclusions([], shape);
    expect(c).toHaveLength(1);
    expect(c[0].headline).toMatch(/No records/i);
  });
  it("includes a frequency conclusion when an array field exists", () => {
    const shape = describeDataset(SAMPLE);
    const c = deriveConclusions(SAMPLE, shape);
    expect(c.some((x) => x.id.startsWith("freq-"))).toBe(true);
  });
});

describe("deriveSuggestions", () => {
  it("offers split + tasklist for groupable fields and freq + cooc for arrays", () => {
    const shape = describeDataset(SAMPLE);
    const s = deriveSuggestions(shape);
    const kinds = new Set(s.map((x) => x.kind));
    expect(kinds.has("split-by-field")).toBe(true);
    expect(kinds.has("tasklist-by-field")).toBe(true);
    expect(kinds.has("frequency-doc")).toBe(true);
    expect(kinds.has("cooccurrence-doc")).toBe(true);
    expect(kinds.has("summary-report")).toBe(true);
  });
});

describe("file generators", () => {
  it("split-by-field returns one doc per bucket", () => {
    const docs = splitByField(SAMPLE, "file");
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.name.startsWith("insights/by-file/"))).toBe(true);
    expect(docs.find((d) => d.name.includes("a.pdf"))!.content).toMatch(/2 records/);
  });
  it("tasklist-by-field embeds a checklist per array field", () => {
    const docs = tasklistByField(SAMPLE, "file");
    expect(docs).toHaveLength(2);
    const a = docs.find((d) => d.name.includes("a.pdf"))!;
    expect(a.content).toContain("## task_ids");
    expect(a.content).toContain("## micro_tasks");
    expect(a.content).toContain("- [ ] alpha");
  });
  it("summaryReport contains conclusions and a json-table block", () => {
    const doc = summaryReport(SAMPLE);
    expect(doc.name).toBe("insights/summary.md");
    expect(doc.content).toMatch(/## Conclusions/);
    expect(doc.content).toContain("```json-table");
  });
  it("frequencyDoc embeds a sortable json-table for the chosen field", () => {
    const doc = frequencyDoc(SAMPLE, "task_ids");
    expect(doc.name).toBe("insights/probability-task_ids.md");
    expect(doc.content).toContain("```json-table");
    // The doc should include the highest-probability value.
    expect(doc.content).toContain("alpha");
  });
  it("cooccurrenceDoc renders a markdown table with all labels", () => {
    const doc = cooccurrenceDoc(SAMPLE, "task_ids");
    expect(doc.content).toContain("alpha");
    expect(doc.content).toContain("beta");
    expect(doc.content).toContain("gamma");
    // Should be a real table (more than just a heading).
    expect(doc.content.split("\n").filter((l) => l.startsWith("| ")).length).toBeGreaterThan(2);
  });
});
