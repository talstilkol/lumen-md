/**
 * Plan 12.2 / W10.E27, audit r3: the remaining slug copies (the clip
 * template id in research/clipTemplateStore.ts, the `slug` filter in
 * research/clipTemplates.ts, and the same word-slug in capture/voiceCapture.ts
 * and mobile/captureQueue.ts) are lib/slug.ts `wordSlug` now, with the same
 * output as before.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { wordSlug } from "../lib/slug";
import { templateId } from "../research/clipTemplateStore";
import { fill } from "../research/clipTemplates";
import { attachmentPath } from "../capture/voiceCapture";
import { captureFilePath, type QueuedCapture } from "../mobile/captureQueue";

const SRC = join(__dirname, "..");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" || f === "node_modules" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts") ? [p] : [];
  });
}

// The copies as they were (the oracles).
const oldClip = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
const oldVoice = (t: string) => t.normalize("NFC").replace(/…$/, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
const oldCapture = (n: string) => n.replace(/\.[A-Za-z0-9]{1,8}$/, "").normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

const SAMPLES = ["Hello World!", "  שלום, עולם  ", "Café — crème brûlée", "פרק 3: סיכום (טיוטה)", "---", "", "a/b\\c:d*e?f", "ﬁle ① ２", "x".repeat(39) + " y" + "z".repeat(10), "סֵפֶר תּוֹרָה", "Meeting notes…"];

describe("one word slug (W10.E27, audit r3)", () => {
  it("no production file outside lib/slug.ts makes a word slug of its own, and slugId is gone", () => {
    const own = /\[\^\\p\{L\}\\p\{N\}\]\+\/gu,\s*"-"|\bfunction\s+slugId\b/;
    const found = sources(SRC)
      .filter((f) => relative(SRC, f) !== join("lib", "slug.ts"))
      .filter((f) => own.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(found).toEqual([]);
  });

  it("every caller gives what its own copy gave", () => {
    for (const s of SAMPLES) {
      expect(templateId(s), s).toBe(oldClip(s) || "template");
      expect(fill(`{{title|slug}}`, { title: s } as never), s).toBe(oldClip(s));
      const when = new Date(2026, 10, 10, 9, 5);
      const v = oldVoice(s);
      expect(attachmentPath(when, s), s).toBe(`attachments/voice-2026-11-10-0905${v ? `-${v}` : ""}.webm`);
      const c = { id: "ABCDEF1234", kind: "pdf", file: "q/1.pdf", name: `${s}.pdf` } as unknown as QueuedCapture;
      const b = oldCapture(`${s}.pdf`);
      expect(captureFilePath(c, when), s).toBe(`attachments/capture-2026-11-10-0905${b ? `-${b}` : ""}-abcdef12.pdf`);
    }
    expect(wordSlug("Hello, World", { lower: true })).toBe("hello-world");
    expect(wordSlug("שלום עולם")).toBe("שלום-עולם");
  });
});
