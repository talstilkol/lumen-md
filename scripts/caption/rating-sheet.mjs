#!/usr/bin/env node
/**
 * The caption rating sheet and its scorer (plan 6.6, 15.15): the owner
 * rates each engine's caption 1–5; the set's metric is "≥ 80 % rated ≥ 4"
 * over 50 images (caption golden set: 30 XM3600 + 20 of the owner's).
 *
 *   node scripts/caption/rating-sheet.mjs make --captions <captions.json> --split dev|test [--dir <test split>] --out <dir>
 *   node scripts/caption/rating-sheet.mjs score --sheet <dir>/sheet.csv --key <dir>/key.json [--out scores.json]
 *
 * <captions.json> is { "<engine>": { "<item id>": "<caption>" } }, as
 * `npm run bench:models -- --engines … --captions-out <file>` writes it.
 *
 * make writes sheet.csv (one row per image × engine, shuffled, engines
 * blinded as A, B, C…, an empty `rating` column and a `notes` column),
 * sheet.html (the same rows with the images, to look at while rating) and
 * key.json (which letter is which engine; kept apart from the sheet). The
 * rows of an image stay together, its engines in a random order. No
 * network; nothing is sent anywhere.
 *
 * score reads the filled sheet: per engine, how many rated, the mean,
 * the share rated ≥ 4, and pass (≥ 80 % over ≥ 50 rated). A rating that is
 * not 1–5 is an error listed by row, not skipped silently.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

export const TARGET = { share: 0.8, min: 4, items: 50 };

/** Deterministic shuffle (sha256 of seed + key). */
const rank = (seed, k) => createHash("sha256").update(`${seed}:${k}`).digest("hex");

export function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 rows (quoted fields, "" escapes, CRLF or LF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) (row.push(cell), rows.push(row));
  return rows.filter((r) => r.some((x) => x !== ""));
}

export const COLUMNS = ["row", "item", "image", "engine", "caption", "reference_he", "rating", "notes"];

/** The sheet rows and the key, from the items and the captions. */
export function makeSheet(items, captions, seed = "lumen-caption-sheet") {
  const engines = Object.keys(captions).sort((a, b) => rank(seed, a).localeCompare(rank(seed, b)));
  const key = Object.fromEntries(engines.map((e, i) => [String.fromCharCode(65 + i), e]));
  const letter = Object.fromEntries(Object.entries(key).map(([l, e]) => [e, l]));
  const rows = [];
  for (const it of [...items].sort((a, b) => rank(seed, a.id).localeCompare(rank(seed, b.id)))) {
    const here = engines.filter((e) => typeof captions[e]?.[it.id] === "string").sort((a, b) => rank(`${seed}:${it.id}`, a).localeCompare(rank(`${seed}:${it.id}`, b)));
    for (const e of here) rows.push({ row: rows.length + 1, item: it.id, image: it.image, engine: letter[e], caption: captions[e][it.id], reference_he: Array.isArray(it.refs_he) ? it.refs_he[0] ?? "" : "", rating: "", notes: "" });
  }
  return { rows, key };
}

export function toCsv(rows) {
  return "﻿" + [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function toHtml(rows, imageHref = (p) => p) {
  const body = rows.map((r) => `<tr><td>${r.row}</td><td><img src="${esc(imageHref(r.image))}" alt="" loading="lazy"></td><td>${esc(r.engine)}</td><td dir="auto">${esc(r.caption)}</td><td dir="rtl">${esc(r.reference_he)}</td></tr>`).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>Caption rating sheet</title><style>body{font:14px system-ui;margin:16px}img{max-width:240px}td{vertical-align:top;padding:6px;border-bottom:1px solid #ccc}</style><p>Rate each caption 1–5 in sheet.csv (5: right and fluent Hebrew; 4: right, small slips; 3: partly right; 2: mostly wrong; 1: wrong). The engines are blinded.</p><table><tr><th>row</th><th>image</th><th>engine</th><th>caption</th><th>reference</th></tr>\n${body}\n</table>\n`;
}

/** Per engine: rated, mean, share ≥ 4, pass. Errors name the rows. */
export function scoreSheet(csvText, key) {
  const [head, ...data] = parseCsv(csvText);
  const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  for (const c of ["row", "engine", "rating"]) if (!(c in col)) throw new Error(`the sheet has no "${c}" column`);
  const per = {};
  const errors = [];
  for (const r of data) {
    const v = (r[col.rating] ?? "").trim();
    const eng = key[(r[col.engine] ?? "").trim()];
    if (!eng) {
      errors.push(`row ${r[col.row]}: engine "${r[col.engine]}" is not in the key`);
      continue;
    }
    const p = (per[eng] ??= { rows: 0, rated: 0, sum: 0, good: 0 });
    p.rows++;
    if (!v) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      errors.push(`row ${r[col.row]}: rating "${v}" is not 1-5`);
      continue;
    }
    p.rated++;
    p.sum += n;
    if (n >= TARGET.min) p.good++;
  }
  const engines = Object.fromEntries(
    Object.entries(per).map(([e, p]) => {
      const share = p.rated ? p.good / p.rated : 0;
      return [e, { rows: p.rows, rated: p.rated, mean: p.rated ? Math.round((p.sum / p.rated) * 100) / 100 : null, shareAtLeast4: Math.round(share * 10000) / 10000, pass: p.rated >= TARGET.items && share >= TARGET.share, complete: p.rated === p.rows }];
    }),
  );
  return { target: TARGET, engines, errors };
}

const isMain = process.argv[1]?.endsWith("caption/rating-sheet.mjs");
if (isMain) {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  if (cmd === "make") {
    const [{ loadSet }, { GOLDEN }] = await Promise.all([import("../lib/golden.mjs"), import("../golden/common.mjs")]);
    const split = opt("--split", "dev");
    const out = opt("--out") ?? (console.error("--out <dir> is required"), process.exit(2));
    const captions = JSON.parse(readFileSync(opt("--captions") ?? (console.error("--captions <file> is required"), process.exit(2)), "utf8"));
    const { items } = loadSet(GOLDEN, "caption", { split, testDir: opt("--dir") });
    const { rows, key } = makeSheet(items, captions, opt("--seed", "lumen-caption-sheet"));
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "sheet.csv"), toCsv(rows));
    writeFileSync(join(out, "sheet.html"), toHtml(rows, (p) => relative(out, p)));
    writeFileSync(join(out, "key.json"), JSON.stringify(key, null, 2) + "\n");
    console.log(`${rows.length} rows (${items.length} images × ${Object.keys(key).length} engines) → ${join(out, "sheet.csv")}; key in ${basename(join(out, "key.json"))}${split === "test" ? " — the test split is held out: never commit these files" : ""}`);
  } else if (cmd === "score") {
    const r = scoreSheet(readFileSync(opt("--sheet"), "utf8"), JSON.parse(readFileSync(opt("--key"), "utf8")));
    const out = opt("--out");
    if (out) writeFileSync(out, JSON.stringify(r, null, 2) + "\n");
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.errors.length ? 1 : 0);
  } else {
    console.error("usage: rating-sheet.mjs make --captions <file> --split dev|test [--dir <test split>] --out <dir> | score --sheet <csv> --key <json> [--out <file>]");
    process.exit(2);
  }
}
