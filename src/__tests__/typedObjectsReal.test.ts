/**
 * Plan W12.T1 on REAL typed notes. typedObjects.test.ts round-trips 200
 * synthetic notes. This test runs the same open → resolve → save path over
 * the real vaults of the Obsidian corpus (W4.30): 10 public vaults with
 * permissive licences, copied byte for byte at a pinned commit, each file
 * checked against its sha256 in manifest.json.
 *
 * The types are the vaults' own: one type for each `type:` value the notes
 * use, and one tag-activated type for each tag used by at least 2 notes.
 * Each type's fields are the frontmatter keys its notes carry, with a kind
 * inferred from their values. Every note typed this way must:
 * - stay byte-identical through the editor's open → save (the corpus is LF
 *   without a BOM; CRLF and BOM are covered by the synthetic set);
 * - stay byte-identical when the typed form writes each field's own value
 *   back unchanged;
 * - be read through fm and tags only, never mutated.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { checkNote } from "../types/fieldValues";
import { fieldsOfNote, loadTypeRegistry, typesOfNote } from "../types/typeRegistry";
import { RESERVED_FIELDS } from "../types/typeSchema";
import { basesFileFromText } from "../views/bases/base";
import { joinTextEnvelope, splitTextEnvelope } from "../storage/textCodec";
import { readProperties, setProperty, type PropertyValue } from "../properties/frontmatter";

const root = "src/__tests__/fixtures/obsidian-corpus";
type Vault = { id: string; files: Array<{ path: string; sha256: string }> };
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as { vaults: Vault[] };
const notes = manifest.vaults.flatMap((v) =>
  v.files
    .filter((f) => f.path.endsWith(".md"))
    .map((f) => {
      const bytes = new Uint8Array(readFileSync(join(root, v.id, f.path)));
      return { vault: v.id, path: f.path, sha256: f.sha256, bytes, text: new TextDecoder("utf-8").decode(bytes) };
    }),
);
const noBom = (t: string) => t.replace(/^﻿/, "");
const fileOf = (n: { path: string; text: string }) => basesFileFromText(n.path, noBom(n.text).replace(/\r\n|\r/g, "\n"));

/** The kind a field's real values support: the narrowest that fits all of them. */
function kindOf(values: unknown[]): string {
  const vs = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (!vs.length) return "text";
  if (vs.every((v) => typeof v === "boolean")) return "checkbox";
  if (vs.every((v) => typeof v === "number")) return "number";
  if (vs.every((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) return "date";
  if (vs.every((v) => Array.isArray(v) && v.every((x) => typeof x === "string"))) return "multi-select";
  if (vs.every((v) => typeof v === "string" && /^https?:\/\//.test(v))) return "url";
  return "text";
}

/** The vaults' own types, as `.lumen/types/*.yaml` files. */
function realTypes() {
  const byType = new Map<string, Array<Record<string, unknown>>>();
  const byTag = new Map<string, Array<Record<string, unknown>>>();
  for (const n of notes) {
    const f = fileOf(n);
    const fm = (f.fm ?? {}) as Record<string, unknown>;
    const t = fm.type;
    // A `type:` may be a link ("[[Game studios]]", kepano's vault): the type is its target, as the resolver reads it.
    for (const v of (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim().replace(/^\[\[|\]\]$/g, ""))) byType.set(v, [...(byType.get(v) ?? []), fm]);
    for (const g of f.tags ?? []) byTag.set(g, [...(byTag.get(g) ?? []), fm]);
  }
  const files: Array<{ path: string; text: string }> = [];
  const used = new Set<string>();
  const slug = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "t";
  const add = (label: string, fms: Array<Record<string, unknown>>, tag?: string) => {
    let id = `${tag ? "tag-" : ""}${slug(label)}`;
    while (used.has(id)) id += "-x";
    used.add(id);
    const keys = [...new Set(fms.flatMap((fm) => Object.keys(fm)))].filter((k) => !RESERVED_FIELDS.has(k.toLowerCase()) && /^[\p{L}\p{N}_ -]+$/u.test(k));
    const fields: Record<string, unknown> = {};
    for (const k of keys) fields[k] = { type: kindOf(fms.map((fm) => fm[k])) };
    files.push({ path: `.lumen/types/${id}.yaml`, text: YAML.stringify({ label: { en: label }, ...(tag ? { tag } : {}), fields }) });
  };
  for (const [v, fms] of byType) add(v, fms);
  for (const [g, fms] of byTag) if (fms.length >= 2) add(g, fms, g);
  return files;
}

const typeFiles = realTypes();
const reg = loadTypeRegistry(typeFiles);
const typed = notes.filter((n) => typesOfNote(reg, fileOf(n)).types.length > 0);
const enc = new TextEncoder();
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

describe("W12.T1 on real typed notes (the Obsidian corpus, 10 vaults)", () => {
  it("the notes are the pinned real files (sha256); every note with a `type:` or a shared tag is typed (176 of 466)", () => {
    for (const n of notes) expect(createHash("sha256").update(n.bytes).digest("hex"), `${n.vault}/${n.path}`).toBe(n.sha256);
    expect(manifest.vaults.length).toBe(10);
    expect(reg.types.size).toBeGreaterThanOrEqual(20);
    // Every generated type loads: the vaults' own keys are valid field names.
    expect(reg.errors).toEqual([]);
    expect(reg.types.size).toBe(typeFiles.length);
    // The corpus has 176 such notes: all of them, not a sample. (The 200 of the acceptance are typedObjects.test.ts's synthetic set.)
    expect(typed.length).toBe(176);
    for (const n of notes) expect(typesOfNote(reg, fileOf(n)).unknown, `${n.vault}/${n.path}`).toEqual([]);
    // Typed in both ways: by a `type:` value and by a tag.
    expect(typed.some((n) => typeof (fileOf(n).fm as Record<string, unknown>)?.type === "string")).toBe(true);
    expect(typed.some((n) => typesOfNote(reg, fileOf(n)).types.some((t) => t.id.startsWith("tag-")))).toBe(true);
  });

  it("open → resolve types, fields and problems → save changes 0 bytes in every typed note", () => {
    const differ: string[] = [];
    let fields = 0;
    for (const n of typed) {
      const f = fileOf(n);
      fields += fieldsOfNote(reg, f).fields.length;
      checkNote(reg, f);
      const { body, envelope } = splitTextEnvelope(n.text);
      const saved = enc.encode(joinTextEnvelope(body.replace(/\r\n|\r/g, "\n"), envelope));
      if (!same(saved, n.bytes)) differ.push(`${n.vault}/${n.path}`);
    }
    expect(differ).toEqual([]);
    expect(fields).toBeGreaterThan(typed.length);
  });

  it("the typed form saved without edits (each field's own value written back) changes 0 bytes", () => {
    const differ: string[] = [];
    let written = 0;
    for (const n of typed) {
      const { body } = splitTextEnvelope(n.text);
      const text = body.replace(/\r\n|\r/g, "\n");
      const f = basesFileFromText(n.path, text);
      let after = text;
      for (const field of fieldsOfNote(reg, f).fields) {
        const p = readProperties(after).find((x) => x.key === field.name);
        if (p) {
          after = setProperty(after, field.name, p.value as PropertyValue);
          written++;
        }
      }
      if (after !== text) differ.push(`${n.vault}/${n.path}`);
    }
    expect(differ).toEqual([]);
    expect(written).toBeGreaterThan(200);
  });

  it("the resolver reads only fm and tags of a real note, and mutates neither", () => {
    const read = new Set<string>();
    for (const n of typed) {
      const f = fileOf(n);
      const before = JSON.stringify([f.fm, f.tags]);
      const note = new Proxy({ fm: f.fm, tags: f.tags }, { get: (t, k) => (read.add(String(k)), (t as Record<string | symbol, unknown>)[k]) });
      typesOfNote(reg, note);
      fieldsOfNote(reg, note);
      checkNote(reg, note);
      expect(JSON.stringify([f.fm, f.tags])).toBe(before);
    }
    expect([...read].sort()).toEqual(["fm", "tags"]);
  });
});
