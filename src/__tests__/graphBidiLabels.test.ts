/**
 * W13.G2 — bidi-correct graph labels: direction per label from its first
 * strong character, FSI … PDI around the runs in the other direction, and
 * shortening by grapheme so niqqud never breaks.
 *
 * The baseline: 30 edge-case labels, each with its direction, the string the
 * canvas draws (⟦ ⟧ = FSI … PDI) and — in a real layout engine — the
 * characters' left-to-right order on screen, read back from the browser's
 * own bidi layout (the same code path as canvas fillText in Blink). The
 * visual order was checked by hand, label by label, when the baseline was made.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { ELLIPSIS, FSI, PDI, graphemes, isolateRuns, labelDirection, orphanMarks, prepareLabel, strongOf } from "../graph/labels";

const show = (s: string) => s.replace(new RegExp(FSI, "g"), "⟦").replace(new RegExp(PDI, "g"), "⟧");

/** [label, direction, drawn string, visual left-to-right order] */
const BASELINE: ReadonlyArray<readonly [string, "ltr" | "rtl", string, string]> = [
  ["שלום", "rtl", "שלום", "םולש"],
  ["Python מדריך", "ltr", "Python ⟦מדריך⟧", "Python ךירדמ"],
  ["מדריך Python", "rtl", "מדריך ⟦Python⟧", "Python ךירדמ"],
  ["שלום C++ עולם", "rtl", "שלום ⟦C++⟧ עולם", "םלוע C++ םולש"],
  ["מחקר R&D 2024", "rtl", "מחקר ⟦R&D 2024⟧", "R&D 2024 רקחמ"],
  ["Notes (שלום עולם)", "ltr", "Notes (⟦שלום עולם⟧)", "Notes (םלוע םולש)"],
  ["הערות (v2)", "rtl", "הערות (⟦v2⟧)", ")v2( תורעה"],
  ["פרק 3-4", "rtl", "פרק 3-4", "3-4 קרפ"],
  ["2024 סיכום", "rtl", "2024 סיכום", "םוכיס 2024"],
  ["Node.js בעברית", "ltr", "Node.js ⟦בעברית⟧", "Node.js תירבעב"],
  ["מה זה GPT-4?", "rtl", "מה זה ⟦GPT-4⟧?", "?GPT-4 הז המ"],
  ["שיעור 5: Intro to C#", "rtl", "שיעור 5: ⟦Intro to C#⟧", "Intro to C# :5 רועיש"],
  ["+972-3-555-1234", "ltr", "+972-3-555-1234", "+972-3-555-1234"],
  ["50% הנחה", "rtl", "50% הנחה", "החנה 50%"],
  ["קובץ report.pdf", "rtl", "קובץ ⟦report.pdf⟧", "report.pdf ץבוק"],
  ["בְּרֵאשִׁית בָּרָא אֱלֹהִים", "rtl", "בְּרֵאשִׁית בָּרָא אֱלֹהִים", "םיהִלֹאֱ ארָבָּ תישִׁארֵבְּ"],
  ["السلام عليكم", "rtl", "السلام عليكم", "مكيلع مالسلا"],
  ["مرحبا World", "rtl", "مرحبا ⟦World⟧", "World ابحرم"],
  ["Tel Aviv תל אביב", "ltr", "Tel Aviv ⟦תל אביב⟧", "Tel Aviv ביבא לת"],
  ["ירושלים (2024)", "rtl", "ירושלים (2024)", ")2024( םילשורי"],
  ["https://example.org/דף", "ltr", "https://example.org/⟦דף⟧", "https://example.org/ףד"],
  ["#תגית", "rtl", "#תגית", "תיגת#"],
  ["עמ׳ 12–14", "rtl", "עמ׳ 12–14", "14–12 ׳מע"],
  ["שלום, world!", "rtl", "שלום, ⟦world⟧!", "!world ,םולש"],
  ["C# ו-F# בהשוואה", "ltr", "C# ⟦ו⟧-F# ⟦בהשוואה⟧", "C# ו-F# האוושהב"],
  ["ת״א–ירושלים 2025", "rtl", "ת״א–ירושלים 2025", "2025 םילשורי–א״ת"],
  ["Chapter 3: בראשית א׳", "ltr", "Chapter 3: ⟦בראשית א׳⟧", "Chapter 3: ׳א תישארב"],
  ["וַיֹּאמֶר אֱלֹהִים יְהִי אוֹר וַיְהִי אוֹר וַיַּרְא אֱלֹהִים אֶת הָאוֹר כִּי טוֹב", "rtl", "וַיֹּאמֶר אֱלֹהִים יְהִי אוֹר וַיְהִי אוֹר וַיַּרְא אֱלֹהִים…", "…םיהִלֹאֱ ארְיַּוַ רוֹא יהִיְוַ רוֹא יהִיְ םיהִלֹאֱ רמֶאיֹּוַ"],
  ["שלום (hello) עולם", "rtl", "שלום (⟦hello⟧) עולם", "םלוע )hello( םולש"],
  ["גרסה 2.0 של Lumen", "rtl", "גרסה 2.0 של ⟦Lumen⟧", "Lumen לש 2.0 הסרג"],
];

describe("the 30-label baseline (logical)", () => {
  it("has 30 labels", () => expect(BASELINE.length).toBe(30));
  for (const [label, dir, drawn] of BASELINE) {
    it(`${label} → ${dir} ${drawn}`, () => {
      const p = prepareLabel(label, { fallback: "rtl" });
      expect(p.dir).toBe(dir);
      expect(show(p.text)).toBe(drawn);
      expect(orphanMarks(label, p.text)).toBe(0);
    });
  }
});

/** Visible characters in screen order, from the browser's layout of the drawn string. */
function visualOrder(text: string, dir: string): string {
  const span = document.createElement("span");
  span.dir = dir;
  span.style.unicodeBidi = "isolate";
  span.style.whiteSpace = "pre";
  span.style.font = "13px sans-serif";
  span.textContent = text;
  document.body.append(span);
  const range = document.createRange();
  const placed: Array<[string, number]> = [];
  for (let i = 0; i < text.length; i++) {
    if (/[⁦-⁩]/.test(text[i])) continue;
    range.setStart(span.firstChild!, i);
    range.setEnd(span.firstChild!, i + 1);
    const b = range.getBoundingClientRect();
    if (b.width) placed.push([text[i], b.left + b.width / 2]);
  }
  span.remove();
  return placed.sort((a, b) => a[1] - b[1]).map(([c]) => c).join("");
}

const hasLayout = (() => {
  if (typeof document === "undefined" || typeof document.createRange !== "function") return false;
  const s = document.createElement("span");
  s.textContent = "xx";
  document.body.append(s);
  const w = s.getBoundingClientRect().width;
  s.remove();
  return w > 0;
})();

// Needs a real layout engine: in Node (happy-dom) there is none, so these run in Chromium (the shim's V4=browser).
// skip-reason: measures rendered label widths, which only a real layout engine reports (Chromium); happy-dom has no layout | task: W13.G2 | until: 2027-05-17
describe.runIf(hasLayout)("the 30-label baseline (visual, real layout engine only)", () => {
  for (const [label, , , visual] of BASELINE) {
    it(`${label} reads ${visual}`, () => {
      const p = prepareLabel(label, { fallback: "rtl" });
      expect(visualOrder(p.text, p.dir)).toBe(visual);
    });
  }
  it("the old drawing got at least 8 of them wrong", () => {
    const RTL = /[֐-׿؀-ۿݐ-ݿ]/;
    const wrong = BASELINE.filter(([label, , , visual]) => visualOrder(label.length > 40 ? `${label.slice(0, 38)}…` : label, RTL.test(label) ? "rtl" : "ltr") !== visual);
    expect(wrong.length).toBeGreaterThanOrEqual(8);
  });
});

describe("direction", () => {
  it("the first strong character decides, not any Hebrew letter", () => {
    expect(labelDirection("Python מדריך")).toBe("ltr");
    expect(labelDirection("מדריך Python")).toBe("rtl");
    expect(labelDirection("2024 סיכום")).toBe("rtl");
    expect(labelDirection("مرحبا World")).toBe("rtl");
  });
  it("niqqud and cantillation are not strong; RLM is; an isolate's inside is skipped", () => {
    expect(strongOf("ָ")).toBeNull();
    expect(strongOf("֑")).toBeNull();
    expect(strongOf("‏")).toBe("R");
    expect(strongOf("‎")).toBe("L");
    expect(labelDirection("ִָ abc")).toBe("ltr");
    expect(labelDirection(`${FSI}שלום${PDI} world`)).toBe("ltr");
  });
  it("no strong letter: digits read left to right, anything else takes the UI's direction", () => {
    expect(labelDirection("+972-3-555-1234", "rtl")).toBe("ltr");
    expect(labelDirection("2024–2025", "rtl")).toBe("ltr");
    expect(labelDirection("—", "rtl")).toBe("rtl");
    expect(labelDirection("", "ltr")).toBe("ltr");
  });
});

describe("isolates", () => {
  it("one direction only: unchanged", () => {
    expect(isolateRuns("שלום עולם 2024", "rtl")).toBe("שלום עולם 2024");
    expect(isolateRuns("Hello (world)", "ltr")).toBe("Hello (world)");
  });
  it("keeps sticky neutrals with the run, leaves brackets that open outside it", () => {
    expect(show(isolateRuns("שלום C++ עולם", "rtl"))).toBe("שלום ⟦C++⟧ עולם");
    expect(show(isolateRuns("Notes (שלום)", "ltr"))).toBe("Notes (⟦שלום⟧)");
    expect(show(isolateRuns("ספר (C++ Primer) חדש", "rtl"))).toBe("ספר (⟦C++ Primer⟧) חדש");
    expect(show(isolateRuns("about f(x) שם", "rtl"))).toBe("⟦about f(x)⟧ שם");
  });
  it("a joiner to the next word stays out (ו-F#); geresh and gershayim stay in (א׳, ת״א)", () => {
    expect(show(isolateRuns("C# ו-F#", "ltr"))).toBe("C# ⟦ו⟧-F#");
    expect(show(isolateRuns("Chapter א׳ end", "ltr"))).toBe("Chapter ⟦א׳⟧ end");
  });
  it("does not isolate inside an existing isolate", () => {
    const s = `שלום ${FSI}C++${PDI} עולם`;
    expect(isolateRuns(s, "rtl")).toBe(s);
  });
});

describe("shortening by grapheme", () => {
  const verse = "וַיֹּאמֶר אֱלֹהִים יְהִי אוֹר וַיְהִי אוֹר וַיַּרְא אֱלֹהִים אֶת הָאוֹר כִּי טוֹב";
  it("0 orphan marks at every length, where the old code-unit cut broke a letter", () => {
    let oldBroken = 0;
    for (let max = 2; max <= 60; max++) {
      const p = prepareLabel(verse, { maxGraphemes: max });
      expect(orphanMarks(verse, p.text)).toBe(0);
      expect(graphemes(p.text.replace(ELLIPSIS, "")).length).toBeLessThanOrEqual(max);
      oldBroken += orphanMarks(verse, verse.slice(0, max - 1));
    }
    expect(oldBroken).toBeGreaterThan(10);
  });
  it("emoji keep their joiners, skin tones and flag halves", () => {
    const fam = "👨‍👩‍👧‍👦👍🏽🇮🇱 שלום";
    expect(graphemes(fam).slice(0, 3)).toEqual(["👨‍👩‍👧‍👦", "👍🏽", "🇮🇱"]);
    const p = prepareLabel(fam, { maxGraphemes: 3 });
    expect(p.text).toBe("👨‍👩‍👧‍👦👍🏽…");
    expect(orphanMarks(fam, p.text)).toBe(0);
  });
  it("the ellipsis goes after the isolates, at the label's own end; no trailing space before it", () => {
    const p = prepareLabel("סיכום של Machine Learning בעברית", { maxGraphemes: 16 });
    expect(p.truncated).toBe(true);
    expect(show(p.text)).toBe("סיכום של ⟦Machin⟧…");
    const q = prepareLabel("שלום עולם ומה שלומך", { maxGraphemes: 6 });
    expect(q.text).toBe("שלום…");
  });
  it("by width: the longest prefix that fits", () => {
    const measure = (s: string) => graphemes(s.replace(/[⁦-⁩]/g, "")).length * 7;
    const p = prepareLabel("בְּרֵאשִׁית בָּרָא אֱלֹהִים", { maxWidth: 70, measure });
    expect(measure(p.text)).toBeLessThanOrEqual(70);
    expect(p.truncated).toBe(true);
    expect(orphanMarks("בְּרֵאשִׁית בָּרָא אֱלֹהִים", p.text)).toBe(0);
    expect(prepareLabel("short", { maxWidth: 70, measure }).text).toBe("short");
  });
  it("newlines and tabs become spaces; a label is never empty after shortening", () => {
    expect(prepareLabel("a\nb\tc").text).toBe("a b c");
    expect(prepareLabel("שָׁלוֹם", { maxGraphemes: 2 }).text).toBe("שָׁ…");
  });
  it("10,000 niqqud labels prepare in under 3 s (GraphCanvas prepares each label once)", () => {
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) prepareLabel(`${verse.slice(0, 20 + (i % 40))} Note ${i}`);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe("the graph canvas draws prepared labels", () => {
  it("sets each label's own direction and draws the isolated, shortened text", async () => {
    const drawn: Array<{ text: string; dir: string }> = [];
    const ctx2d = () => {
      const state: Record<string, unknown> = { direction: "inherit" };
      return new Proxy(state, {
        get: (t, k: string) => {
          if (k === "fillText") return (text: string) => drawn.push({ text, dir: String(t.direction) });
          if (k === "measureText") return (text: string) => ({ width: text.length * 6 });
          if (k in t) return t[k];
          return () => undefined;
        },
        set: (t, k: string, v) => ((t[k] = v), true),
      });
    };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) => (kind === "2d" ? ctx2d() : null)) as never);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const { render, waitFor } = await import("@testing-library/react");
    const { GraphCanvas } = await import("../ui/graph/GraphCanvas");
    const labels = ["Python מדריך", "שלום C++ עולם", "בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ וְהָאָרֶץ הָיְתָה תֹהוּ"];
    render(
      createElement(GraphCanvas, {
        labels,
        edges: Uint32Array.from([0, 1]),
        neighbors: () => [],
        positions: Float32Array.from([0, 0, 60, 0, 0, 60]),
        colors: new Float32Array(12).fill(1),
        sizes: Float32Array.from([6, 6, 6]),
        edgeColor: [0, 0, 0, 1],
        ring: [0, 0, 0, 1],
        labelColor: "#000",
        onOpen: () => undefined,
        ariaLabel: "graph",
        fitKey: 1,
      }),
    );
    await waitFor(() => expect(drawn.length).toBeGreaterThanOrEqual(3));
    const byStart = (s: string) => drawn.find((d) => d.text.startsWith(s))!;
    expect(byStart("Python")).toEqual({ text: `Python ${FSI}מדריך${PDI}`, dir: "ltr" });
    expect(byStart("שלום")).toEqual({ text: `שלום ${FSI}C++${PDI} עולם`, dir: "rtl" });
    const verse = byStart("בְּ");
    expect(verse.dir).toBe("rtl");
    expect(verse.text.endsWith(ELLIPSIS)).toBe(true);
    expect(orphanMarks(labels[2], verse.text)).toBe(0);
    spy.mockRestore();
  });
});
