/**
 * The page of the Talmud in the DOM (W13.R11): build the three layers, then
 * cut them into bands (./dafLayout.ts) by measuring them where they stand.
 * The same two calls lay the page out on screen and in the print frame.
 *
 * Reading order for assistive technology is the main text, then the inner
 * commentary, then the outer one: each layer is a labelled region, and the
 * floats that shape them are hidden. The linear view (DafView) shows the
 * same texts as plain sections.
 */
import { applyFloats, dafGeometry, floatsFor, measureInDom, planDaf, type DafPlan, type DafSlot } from "./dafLayout";
import type { DafContent, DafText } from "./dafSources";

export const DAF_CSS = `
.daf-page { position: relative; margin: 0 auto; direction: rtl; color: #1b1b1b; background: #fffdf7; }
.daf-layer { position: absolute; top: 0; left: 0; text-align: justify; text-justify: inter-word; hyphens: none; }
.daf-layer p { margin: 0; display: inline; }
.daf-layer p + p::before { content: " "; }
.daf-main { font: 19px/1.55 "Frank Ruhl Libre", "David Libre", "Times New Roman", serif; }
.daf-inner, .daf-outer { font: 13.5px/1.5 "David Libre", "Frank Ruhl Libre", "Times New Roman", serif; color: #262626; }
.daf-title { font-weight: 700; }
.daf-main .daf-title { font-size: 1.35em; }
.daf-heading { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.daf-float { pointer-events: none; }
@media print { .daf-page { background: none; } }
`;

export const COMMENTARY_LINE = 13.5 * 1.5;

export interface DafLabels {
  main: string;
  inner: string;
  outer: string;
}

function layer(doc: Document, slot: DafSlot, text: DafText, label: string): HTMLElement {
  const sec = doc.createElement("section");
  sec.className = `daf-layer daf-${slot}`;
  sec.dataset.slot = slot;
  const id = `daf-h-${slot}`;
  sec.setAttribute("aria-labelledby", id);
  sec.setAttribute("dir", "rtl");
  sec.setAttribute("lang", "he");
  const h = doc.createElement("h3");
  h.className = "daf-heading";
  h.id = id;
  h.textContent = text.title ? `${label}: ${text.title}` : label;
  sec.appendChild(h);
  text.paragraphs.forEach((para, i) => {
    const p = doc.createElement("p");
    if (i === 0 && text.title && slot !== "main") {
      // A commentary opens with its name, as on the printed page.
      const b = doc.createElement("span");
      b.className = "daf-title";
      b.textContent = `${text.title} `;
      b.setAttribute("aria-hidden", "true");
      p.appendChild(b);
    }
    if (i === 0 && slot === "main") {
      // The main text opens with its first word set large.
      const [first, ...rest] = para.split(/(\s+)/);
      const b = doc.createElement("span");
      b.className = "daf-title";
      b.textContent = first;
      p.append(b, doc.createTextNode(rest.join("")));
    } else p.appendChild(doc.createTextNode(para));
    sec.appendChild(p);
  });
  const end = doc.createElement("span");
  end.className = "daf-end";
  end.setAttribute("aria-hidden", "true");
  (sec.lastElementChild?.tagName === "P" ? sec.lastElementChild : sec).appendChild(end);
  return sec;
}

/** The page's element with its layers (not yet laid out). */
export function buildDaf(doc: Document, c: Pick<DafContent, "main" | "inner" | "outer">, labels: DafLabels): HTMLElement {
  const page = doc.createElement("div");
  page.className = "daf-page";
  page.dataset.testid = "daf-page";
  for (const slot of ["main", "inner", "outer"] as const) {
    const t = c[slot];
    if (t?.paragraphs.length) page.appendChild(layer(doc, slot, t, labels[slot]));
  }
  return page;
}

/** Lay the built page out at `width` px with the inner commentary on `innerSide`. */
export function layoutDaf(page: HTMLElement, width: number, innerSide: "right" | "left"): DafPlan {
  const g = dafGeometry(width, { commentaryLine: COMMENTARY_LINE });
  const layers = new Map<DafSlot, HTMLElement>();
  page.querySelectorAll<HTMLElement>(".daf-layer").forEach((l) => {
    l.style.width = `${width}px`;
    layers.set(l.dataset.slot as DafSlot, l);
  });
  page.style.width = `${width}px`;
  const plan = planDaf(new Set(layers.keys()), g, (slot, bands) => measureInDom(layers.get(slot)!, slot, bands, g, innerSide));
  // The last band closes where the page ends.
  const bands = plan.bands.map((b, i) => (i === plan.bands.length - 1 ? { ...b, y1: Math.max(b.y0, plan.height) } : b));
  for (const [slot, l] of layers) applyFloats(l, floatsFor(slot, bands, g, innerSide));
  page.style.height = `${Math.ceil(plan.height) + 4}px`;
  page.dataset.innerSide = innerSide;
  return { ...plan, bands };
}
