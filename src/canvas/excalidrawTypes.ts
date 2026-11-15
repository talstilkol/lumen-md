/**
 * Excalidraw scene types, result types and the tldraw record type of the
 * tldraw → Excalidraw converter (plan 4.19). Moved verbatim out of
 * tldrawToExcalidraw.ts (W10.E29, W6.25), which re-exports them.
 */

// ---------------------------------------------------------------------------
// Excalidraw scene types (a structural subset of @excalidraw/excalidraw's
// element types — kept local so this module has no dependency).

export type ExFillStyle = "hachure" | "cross-hatch" | "solid" | "zigzag";
export type ExStrokeStyle = "solid" | "dashed" | "dotted";
export type ExArrowhead =
  | "arrow"
  | "bar"
  | "circle"
  | "triangle"
  | "triangle_outline"
  | "diamond";
export type ExTextAlign = "left" | "center" | "right";
export type ExVerticalAlign = "top" | "middle" | "bottom";
export type ExPoint = [number, number];

export interface ExBoundElement {
  id: string;
  type: "text" | "arrow";
}

export interface ExBinding {
  elementId: string;
  focus: number;
  gap: number;
  /** tldraw's normalised anchor inside the target (0..1 on each axis). */
  fixedPoint: ExPoint | null;
}

export interface ExBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: ExFillStyle;
  strokeWidth: number;
  strokeStyle: ExStrokeStyle;
  roughness: number;
  opacity: number;
  groupIds: string[];
  frameId: string | null;
  index: string | null;
  roundness: { type: number } | null;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: false;
  boundElements: ExBoundElement[] | null;
  updated: number;
  link: string | null;
  locked: boolean;
  /** Where the element came from: a tldraw shape, or a JSON Canvas node / edge (./jsonCanvas.ts). */
  customData?: { tldrawId?: string; tldrawType?: string; jsonCanvas?: Record<string, unknown> };
}

export interface ExShapeElement extends ExBase {
  type: "rectangle" | "ellipse" | "diamond";
}

export interface ExTextElement extends ExBase {
  type: "text";
  text: string;
  originalText: string;
  fontSize: number;
  fontFamily: number;
  textAlign: ExTextAlign;
  verticalAlign: ExVerticalAlign;
  containerId: string | null;
  autoResize: boolean;
  lineHeight: number;
}

export interface ExLinearElement extends ExBase {
  type: "arrow" | "line";
  points: ExPoint[];
  lastCommittedPoint: null;
  startBinding: ExBinding | null;
  endBinding: ExBinding | null;
  startArrowhead: ExArrowhead | null;
  endArrowhead: ExArrowhead | null;
  elbowed?: boolean;
  polygon?: boolean;
}

export interface ExFreedrawElement extends ExBase {
  type: "freedraw";
  points: ExPoint[];
  pressures: number[];
  simulatePressure: boolean;
  lastCommittedPoint: null;
}

export interface ExCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

export interface ExImageElement extends ExBase {
  type: "image";
  fileId: string;
  status: "saved";
  scale: [number, number];
  crop: ExCrop | null;
}

export interface ExFrameElement extends ExBase {
  type: "frame";
  name: string | null;
}

/** An embed (plan W1.16 uses it for note cards: link `lumen-note:<path>`, see ../canvas/noteCards.ts). */
export interface ExEmbeddableElement extends ExBase {
  type: "embeddable";
}

export type ExcalidrawElement =
  | ExShapeElement
  | ExTextElement
  | ExLinearElement
  | ExFreedrawElement
  | ExImageElement
  | ExFrameElement
  | ExEmbeddableElement;

export interface ExBinaryFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
  lastRetrieved: number;
}

export interface ExcalidrawFile {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: ExcalidrawElement[];
  appState: { viewBackgroundColor: string; gridSize: number | null; [key: string]: unknown };
  files: Record<string, ExBinaryFile>;
}

// ---------------------------------------------------------------------------
// Result types.

export type ConversionWarningCode =
  /** A shape type this converter doesn't know — kept as a labelled rectangle. */
  | "unknown-shape"
  /** A known tldraw shape with no Excalidraw element (video, embed, bookmark). */
  | "unsupported-shape"
  /** A geo shape Excalidraw has no primitive for — drawn as a polygon / ellipse. */
  | "approximated-geo"
  /** An elbow arrow — drawn as a straight one. */
  | "elbow-arrow"
  /** A frame inside a frame — Excalidraw frames don't nest. */
  | "nested-frame"
  /** An image whose asset is missing or isn't embedded (remote URL). */
  | "image-not-embedded"
  /** An arrow binding whose target is gone or can't hold a binding. */
  | "binding-dropped"
  /** A draw stroke whose points couldn't be read. */
  | "draw-unreadable"
  /** A second (third…) tldraw page — placed to the right of the previous one. */
  | "extra-page";

export interface ConversionWarning {
  code: ConversionWarningCode;
  /** The tldraw record id (shape, page or binding). */
  recordId: string;
  /** The tldraw shape type (or "page" / "binding"). */
  recordType: string;
  detail?: string;
}

export interface ConversionStats {
  /** tldraw shape records read. */
  shapes: number;
  /** Excalidraw elements written (labels count separately). */
  elements: number;
  byTldrawType: Record<string, number>;
  byElementType: Record<string, number>;
}

export interface ConversionResult {
  file: ExcalidrawFile;
  warnings: ConversionWarning[];
  stats: ConversionStats;
}

export interface ConvertOptions {
  /** `source` field of the scene file. */
  source?: string;
  /** `updated` / `created` timestamp for every element and file (default 0 — deterministic). */
  updated?: number;
}

export class TldrawFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TldrawFormatError";
  }
}

// ---------------------------------------------------------------------------
// tldraw record access. Records are untyped JSON: every read is defensive.

export interface TlRecord {
  id: string;
  typeName: string;
  [key: string]: unknown;
}
