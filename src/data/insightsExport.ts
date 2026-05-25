/**
 * Generators that turn an Insights dataset into new markdown documents.
 * Pure functions — they return `{ name, content }` pairs. The block
 * component is responsible for actually writing them to OPFS / opening
 * them as tabs.
 */

import {
  coOccurrence,
  describeDataset,
  deriveConclusions,
  frequencyTable,
  groupSummary,
  pct,
  type InsightsRecord,
} from "./insights";

export interface GeneratedDoc {
  /** Workspace path; caller should run it through `uniqueWorkspaceName`. */
  name: string;
  content: string;
}

const NAME_SAFE = /[^A-Za-z0-9֐-׿ء-ي._ -]+/g;

function sanitizeFilename(s: string, fallback = "untitled"): string {
  const cleaned = s.replace(NAME_SAFE, "_").trim().replace(/\s+/g, " ");
  return cleaned || fallback;
}

function bucketRecords(
  records: InsightsRecord[],
  field: string,
): Map<string, InsightsRecord[]> {
  const out = new Map<string, InsightsRecord[]>();
  for (const r of records) {
    const v = r[field];
    // Defense-in-depth: callers only pass scalar `groupableFields`, but
    // if an array value sneaks through, `String(arr)` would collapse
    // every record into one bucket via `[object Object]`-style coercion.
    // Bucket arrays under "(unknown)" instead.
    const isMissing =
      v === null || v === undefined || v === "" || Array.isArray(v);
    const key = isMissing ? "(unknown)" : String(v);
    let arr = out.get(key);
    if (!arr) {
      arr = [];
      out.set(key, arr);
    }
    arr.push(r);
  }
  return out;
}

function recordToBullets(r: InsightsRecord, exclude: Set<string>): string[] {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (exclude.has(k)) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`- **${k}:** ${v.join(", ")}`);
    } else if (v !== null && v !== undefined && v !== "") {
      const text = typeof v === "string" ? v : JSON.stringify(v);
      lines.push(`- **${k}:** ${text}`);
    }
  }
  return lines;
}

/**
 * Split records by `field`. Each group becomes its own markdown file.
 * Folder prefix keeps the generated set tidy in the file tree.
 */
export function splitByField(
  records: InsightsRecord[],
  field: string,
  folder = "insights",
): GeneratedDoc[] {
  const buckets = bucketRecords(records, field);
  const out: GeneratedDoc[] = [];
  for (const [group, rows] of buckets) {
    const stem = sanitizeFilename(group);
    const lines: string[] = [
      `# ${group}`,
      "",
      `*${rows.length} record${rows.length === 1 ? "" : "s"} from field **${field}***`,
      "",
    ];
    rows.forEach((r, i) => {
      lines.push(`## Entry ${i + 1}`);
      lines.push("");
      lines.push(...recordToBullets(r, new Set([field])));
      lines.push("");
    });
    out.push({
      name: `${folder}/by-${sanitizeFilename(field)}/${stem}.md`,
      content: lines.join("\n"),
    });
  }
  return out;
}

/**
 * Produce a markdown checklist per group. Picks every array-valued field
 * (e.g. `micro_tasks`) under the group as a checkbox set, deduplicating
 * across rows so the resulting checklist is short and actionable.
 */
export function tasklistByField(
  records: InsightsRecord[],
  field: string,
  folder = "insights",
): GeneratedDoc[] {
  const buckets = bucketRecords(records, field);
  const out: GeneratedDoc[] = [];
  const shape = describeDataset(records);
  const arrayFields = shape.arrayFields;
  for (const [group, rows] of buckets) {
    const lines: string[] = [
      `# Tasks · ${group}`,
      "",
      `*Generated from ${rows.length} record${rows.length === 1 ? "" : "s"} (${field}=${group})*`,
      "",
    ];
    if (arrayFields.length === 0) {
      lines.push("_No array-valued fields detected — nothing to checklist._");
    } else {
      for (const af of arrayFields) {
        const items = new Set<string>();
        for (const r of rows) {
          const v = r[af];
          if (Array.isArray(v)) {
            for (const x of v) {
              if (x !== null && x !== undefined && x !== "") items.add(String(x));
            }
          }
        }
        if (items.size === 0) continue;
        lines.push(`## ${af}`);
        lines.push("");
        for (const item of items) lines.push(`- [ ] ${item}`);
        lines.push("");
      }
    }
    out.push({
      name: `${folder}/tasks-${sanitizeFilename(field)}/${sanitizeFilename(group)}.md`,
      content: lines.join("\n"),
    });
  }
  return out;
}

/**
 * Single summary report — conclusions + top frequencies + per-group share.
 * Embeds a `json-table` block of the top-N frequency rows so the user can
 * sort/chart the data without leaving the report.
 */
export function summaryReport(
  records: InsightsRecord[],
  folder = "insights",
): GeneratedDoc {
  const shape = describeDataset(records);
  const conclusions = deriveConclusions(records, shape);

  const lines: string[] = [
    `# Insights summary`,
    "",
    `_${records.length} records · ${shape.fields.length} fields · ${shape.arrayFields.length} array-valued · ${shape.groupableFields.length} groupable_`,
    "",
    "## Conclusions",
    "",
    ...conclusions.map((c) => `- ${c.headline}${c.detail ? ` — ${c.detail}` : ""}`),
    "",
  ];

  const topArray = shape.arrayFields[0];
  if (topArray) {
    const freq = frequencyTable(records, topArray);
    const top = freq.entries.slice(0, 20);
    lines.push(`## Top “${topArray}” probabilities`);
    lines.push("");
    lines.push("```json-table");
    lines.push(
      JSON.stringify(
        top.map((e) => ({
          value: e.value,
          count: e.count,
          probability: Number(e.probability.toFixed(4)),
        })),
        null,
        2,
      ),
    );
    lines.push("```");
    lines.push("");
  }

  const topGroup = shape.groupableFields[0];
  if (topGroup) {
    const groups = groupSummary(records, topGroup);
    lines.push(`## Per-${topGroup} share`);
    lines.push("");
    lines.push(`| ${topGroup} | count | share |`);
    lines.push("| --- | ---: | ---: |");
    for (const g of groups.slice(0, 50)) {
      lines.push(`| ${g.group} | ${g.count} | ${pct(g.share)} |`);
    }
    lines.push("");
  }

  return {
    name: `${folder}/summary.md`,
    content: lines.join("\n"),
  };
}

/** Probability table for a single field, embedded as `json-table` for sortability. */
export function frequencyDoc(
  records: InsightsRecord[],
  field: string,
  folder = "insights",
): GeneratedDoc {
  const freq = frequencyTable(records, field);
  const rows = freq.entries.map((e) => ({
    value: e.value,
    count: e.count,
    probability: Number(e.probability.toFixed(4)),
    pct: pct(e.probability),
  }));
  const lines = [
    `# Probability · ${field}`,
    "",
    `_${freq.total} occurrences across ${freq.entries.length} distinct value${freq.entries.length === 1 ? "" : "s"}._`,
    "",
    "```json-table",
    JSON.stringify(rows, null, 2),
    "```",
    "",
  ];
  return {
    name: `${folder}/probability-${sanitizeFilename(field)}.md`,
    content: lines.join("\n"),
  };
}

/** Co-occurrence matrix as a markdown table + an `insights` block ready for the heatmap. */
export function cooccurrenceDoc(
  records: InsightsRecord[],
  field: string,
  folder = "insights",
): GeneratedDoc {
  const cooc = coOccurrence(records, field, 16);
  const head = ["", ...cooc.labels].join(" | ");
  const sep = ["---", ...cooc.labels.map(() => "---:")].join(" | ");
  const body = cooc.labels.map((label, i) => {
    return [label, ...cooc.matrix[i].map((v) => String(v))].join(" | ");
  });
  const lines = [
    `# Co-occurrence · ${field}`,
    "",
    `_Top ${cooc.labels.length} values; cell = number of records containing both labels._`,
    "",
    `| ${head} |`,
    `| ${sep} |`,
    ...body.map((r) => `| ${r} |`),
    "",
  ];
  return {
    name: `${folder}/cooccurrence-${sanitizeFilename(field)}.md`,
    content: lines.join("\n"),
  };
}
