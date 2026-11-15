/**
 * Plan 12.2 (W10.E27): one slug module. lib/slug.ts holds every slug the app
 * makes; the copies in lib/utils.ts, renderer/remarkLumen.ts and
 * ai/modelHosting.ts are gone, and what they produced still holds.
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { headingSlug, releaseTagSlug } from "../lib/slug";
import { releaseTag } from "../ai/modelHosting";
import { remarkWikiLinks } from "../renderer/remarkLumen";

const SRC = join(__dirname, "..");

/** ai/modelHosting.ts's `slug` before it moved (the oracle for published tags). */
const oldReleaseSlug = (id: string) =>
  id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" || f === "node_modules" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts") ? [p] : [];
  });
}

describe("one slug module (plan 12.2)", () => {
  it("no production file outside lib/slug.ts defines a slug function", () => {
    // A function definition by one of these names (a variable that holds a slug is fine).
    const own = /\bfunction\s+(?:slug|slugify|toSlug|slugOf)\s*\(|\b(?:const|let)\s+(?:slug|slugify|toSlug|slugOf)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/;
    const found = sources(SRC)
      .filter((f) => relative(SRC, f) !== join("lib", "slug.ts"))
      .filter((f) => own.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(found).toEqual([]);
  });

  it("release tags: identical to the old modelHosting slug for every model id in models/registry.json", () => {
    const reg = JSON.parse(readFileSync(join(SRC, "..", "models", "registry.json"), "utf8"));
    const models: { id: string; hosting?: { tag?: string } }[] = reg.models ?? reg;
    expect(models.length).toBeGreaterThan(10);
    for (const m of models) {
      expect(releaseTagSlug(m.id), m.id).toBe(oldReleaseSlug(m.id));
      expect(releaseTag(m)).toBe(m.hosting?.tag ?? `models-${oldReleaseSlug(m.id)}`);
    }
    // The shapes the mirror relies on.
    expect(releaseTagSlug("onnx-community/whisper-base")).toBe("onnx-community-whisper-base");
    expect(releaseTagSlug("  Xenova/LaBSE (q8) ")).toBe("xenova-labse-q8");
    expect(releaseTagSlug("dicta-il/dictabert.v2_tiny")).toBe("dicta-il-dictabert.v2_tiny");
  });

  it("wiki-link anchors are heading slugs, Hebrew included (was remarkLumen's own slug)", () => {
    for (const target of ["כותרת ראשית", "Hello World!", "פרק 3: סיכום"]) {
      const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: `[[${target}]]` }] }] };
      (remarkWikiLinks() as (t: unknown) => void)(tree);
      const link = (tree.children[0].children as { type: string; url?: string }[]).find((c) => c.type === "link");
      expect(link?.url).toBe(`#${headingSlug(target)}`);
    }
    // lib/utils.ts's slugify gave "" for Hebrew; the heading slug keeps the letters.
    expect(headingSlug("שלום עולם")).toBe("שלום-עולם");
  });
});
