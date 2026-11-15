/**
 * tldraw → Excalidraw scene converter (plan 4.19, step 2).
 *
 * Pure and dependency-free on purpose: it imports only its own two sibling
 * modules (excalidrawTypes.ts, tldrawConvertHelpers.ts: split out verbatim
 * for the 800-line limit, W10.E29), so it can run in a worker, in Node, or in the one-shot vault migration without pulling tldraw
 * or Excalidraw into the bundle, and it can never touch the network.
 *
 * Input — any of the three shapes a tldraw canvas is stored in:
 *   - `getSnapshot(editor.store)` (what `CanvasTldraw.tsx` writes to
 *     `canvases/<name>.tldr`): `{ document: { store, schema }, session }`
 *   - a store snapshot: `{ store: { [id]: record }, schema }` (the legacy
 *     `.canvas.json` → `.tldr` converter writes this one)
 *   - a `.tldr` file exported by tldraw: `{ tldrawFileFormatVersion, records: [] }`
 *
 * Output — an Excalidraw scene file (`{ type: "excalidraw", version: 2, … }`)
 * plus a list of warnings. Nothing is dropped silently: a shape with no
 * Excalidraw equivalent becomes a dashed, labelled rectangle and a warning.
 *
 * Ids are stable (`shape:abc` → `abc`), and converting the same input twice
 * gives byte-identical output (seeds are hashes of the id, timestamps come
 * from `options.updated`).
 *
 * Hebrew / RTL: Excalidraw text has no `dir` field. The text is copied
 * character for character; only the alignment is resolved — tldraw's
 * logical `start`/`end` become `right`/`left` when the text's first strong
 * character is right-to-left, so a Hebrew label stays where it was.
 */

import { type ExTextAlign, type ExVerticalAlign, type ExPoint, type ExBinding, type ExBase, type ExShapeElement, type ExTextElement, type ExLinearElement, type ExFreedrawElement, type ExCrop, type ExFrameElement, type ExcalidrawElement, type ExBinaryFile, type ConversionWarningCode, type ConversionWarning, type ConversionResult, type ConvertOptions, type TlRecord } from "./excalidrawTypes";
import { type Obj, isObj, num, str, props, extractTldrawRecords, NOTE_FILLS, color, TEXT_FONT_SIZES, LABEL_FONT_SIZES, ARROW_FONT_SIZES, strokeWidth, fontFamily, strokeStyle, fill, arrowhead, shapeText, textAlign, verticalAlign, LINE_HEIGHT, BOUND_TEXT_PADDING, wrapText, measureText, type Transform, round, normAngle, boxFrom, toPage, linearFrom, polygonFor, segmentPoints, hash32, excalidrawIdOf, pointAlong, boundsOf } from "./tldrawConvertHelpers";

// The public API stays here: the types, and the helpers that were exported.
export * from "./excalidrawTypes";
export { extractTldrawRecords, richTextToPlain, isRtlText, wrapText, measureText, decodeDrawPath, excalidrawIdOf } from "./tldrawConvertHelpers";

// ---------------------------------------------------------------------------
// The converter.

const BINDABLE = new Set(["rectangle", "ellipse", "diamond", "text", "image", "frame"]);

interface WalkContext {
  t: Transform;
  groupIds: string[];
  frameId: string | null;
}

export function tldrawToExcalidraw(input: unknown, options: ConvertOptions = {}): ConversionResult {
  const records = extractTldrawRecords(input);
  const updated = options.updated ?? 0;
  const warnings: ConversionWarning[] = [];
  const byTldrawType: Record<string, number> = {};

  const byId = new Map<string, TlRecord>();
  const children = new Map<string, TlRecord[]>();
  const pages: TlRecord[] = [];
  const bindingsByArrow = new Map<string, TlRecord[]>();
  let gridSize: number | null = null;

  for (const r of records) byId.set(r.id, r);
  for (const r of records) {
    if (r.typeName === "page") pages.push(r);
    else if (r.typeName === "document") gridSize = num(r.gridSize, 10);
    else if (r.typeName === "shape") {
      const parent = str(r.parentId, "");
      const list = children.get(parent) ?? [];
      list.push(r);
      children.set(parent, list);
      const type = str(r.type, "unknown");
      byTldrawType[type] = (byTldrawType[type] ?? 0) + 1;
    } else if (r.typeName === "binding" && r.type === "arrow") {
      const from = str(r.fromId, "");
      const list = bindingsByArrow.get(from) ?? [];
      list.push(r);
      bindingsByArrow.set(from, list);
    }
  }
  const byIndex = (a: TlRecord, b: TlRecord): number => {
    const ia = str(a.index, "");
    const ib = str(b.index, "");
    if (ia !== ib) return ia < ib ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  pages.sort(byIndex);
  for (const list of children.values()) list.sort(byIndex);

  // Shapes whose parent is neither a page nor a shape (a corrupt store):
  // treat them as being on the first page rather than losing them.
  const orphanRoots: TlRecord[] = [];
  for (const [parent, list] of children) {
    const p = byId.get(parent);
    if (!p || (p.typeName !== "page" && p.typeName !== "shape")) orphanRoots.push(...list);
  }
  orphanRoots.sort(byIndex);

  // Reserve every shape's id first, so derived ids (labels, groups) never collide.
  const used = new Set<string>();
  for (const r of records) if (r.typeName === "shape") used.add(excalidrawIdOf(r.id));
  const derivedId = (base: string): string => {
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}~${n}`;
    used.add(id);
    return id;
  };

  const elements: ExcalidrawElement[] = [];
  const files: Record<string, ExBinaryFile> = {};
  /** Absolute transform and size per shape — for arrows bound in old-format files. */
  const placed = new Map<string, { t: Transform; w: number; h: number }>();
  /** Arrows are finished after every shape is placed (their bindings may point forward). */
  const pendingArrows: { r: TlRecord; el: ExLinearElement; ctx: WalkContext }[] = [];

  const warn = (code: ConversionWarningCode, r: TlRecord, detail?: string): void => {
    warnings.push({ code, recordId: r.id, recordType: r.typeName === "shape" ? str(r.type, "unknown") : r.typeName, ...(detail ? { detail } : {}) });
  };

  const base = (
    id: string,
    r: TlRecord,
    ctx: WalkContext,
    box: { x: number; y: number; width: number; height: number; angle: number },
  ): ExBase => {
    const p = props(r);
    const dash = strokeStyle(p.dash);
    const f = fill(p.fill, p.color);
    return {
      id,
      x: box.x,
      y: box.y,
      width: round(box.width),
      height: round(box.height),
      angle: box.angle,
      strokeColor: color(p.color),
      backgroundColor: f.backgroundColor,
      fillStyle: f.fillStyle,
      strokeWidth: round(strokeWidth(p.size) * num(p.scale, 1)),
      strokeStyle: dash.strokeStyle,
      roughness: dash.roughness,
      opacity: Math.round(Math.min(1, Math.max(0, num(r.opacity, 1))) * 100),
      groupIds: [...ctx.groupIds],
      frameId: ctx.frameId,
      index: null,
      roundness: null,
      seed: hash32(id),
      version: 1,
      versionNonce: hash32(id + ":nonce"),
      isDeleted: false,
      boundElements: null,
      updated,
      link: typeof p.url === "string" && p.url ? p.url : null,
      locked: r.isLocked === true,
      customData: { tldrawId: r.id, tldrawType: str(r.type, "unknown") },
    };
  };

  const textElement = (
    id: string,
    r: TlRecord,
    ctx: WalkContext,
    text: string,
    fontSize: number,
    opts: {
      center: ExPoint;
      angle: number;
      align: ExTextAlign;
      valign: ExVerticalAlign;
      containerId: string | null;
      strokeColor: string;
      /** Fixed width: the text wraps at it and doesn't auto-resize. */
      width?: number;
      /** Wrap at this width but keep auto-resizing (labels inside a container). */
      wrapAt?: number;
    },
  ): ExTextElement => {
    const wrapWidth = opts.width ?? opts.wrapAt;
    const shown = wrapWidth === undefined ? text : wrapText(text, fontSize, wrapWidth);
    const m = measureText(shown, fontSize);
    const width = opts.width ?? m.width;
    const el: ExTextElement = {
      ...base(id, r, ctx, {
        x: round(opts.center[0] - width / 2),
        y: round(opts.center[1] - m.height / 2),
        width,
        height: m.height,
        angle: opts.angle,
      }),
      type: "text",
      strokeColor: opts.strokeColor,
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeStyle: "solid",
      roughness: 0,
      link: null,
      text: shown,
      originalText: text,
      fontSize,
      fontFamily: fontFamily(props(r).font),
      textAlign: opts.align,
      verticalAlign: opts.valign,
      containerId: opts.containerId,
      autoResize: opts.width === undefined,
      lineHeight: LINE_HEIGHT,
    };
    return el;
  };

  /** A bound label inside a container element. */
  const addLabel = (
    container: ExBase,
    r: TlRecord,
    ctx: WalkContext,
    text: string,
    fontSize: number,
    p: Obj,
  ): void => {
    if (!text) return;
    const id = derivedId(`${container.id}-label`);
    const center: ExPoint = [container.x + container.width / 2, container.y + container.height / 2];
    elements.push(
      textElement(id, r, ctx, text, fontSize, {
        center,
        angle: container.angle,
        align: textAlign(p.align ?? p.textAlign, text),
        valign: verticalAlign(p.verticalAlign),
        containerId: container.id,
        strokeColor: color(p.labelColor ?? p.color),
        // Excalidraw stores bound text wrapped to the container's inner width.
        wrapAt: Math.max(fontSize, container.width - 2 * BOUND_TEXT_PADDING),
      }),
    );
    container.boundElements = [...(container.boundElements ?? []), { id, type: "text" }];
  };

  /** A dashed, labelled rectangle standing in for a shape with no equivalent. */
  const placeholder = (r: TlRecord, ctx: WalkContext, label: string): void => {
    const p = props(r);
    const w = num(p.w, 160);
    const h = num(p.h, 90);
    const el: ExShapeElement = {
      ...base(excalidrawIdOf(r.id), r, ctx, { ...boxFrom(ctx.t, w, h), width: w, height: h }),
      type: "rectangle",
      strokeStyle: "dashed",
      roughness: 0,
      backgroundColor: "transparent",
      strokeColor: color(p.color ?? "grey"),
    };
    elements.push(el);
    addLabel(el, r, ctx, label, 16, { align: "middle", verticalAlign: "middle", labelColor: p.color ?? "grey" });
  };

  const convertShape = (r: TlRecord, ctx: WalkContext): void => {
    const p = props(r);
    const type = str(r.type, "unknown");
    const id = excalidrawIdOf(r.id);
    const scale = num(p.scale, 1);

    switch (type) {
      case "geo": {
        // w / h are already page units; `scale` only sizes the label and stroke
        // (checked against tldraw's own editor in tldrawToExcalidraw.tldraw.test.ts).
        const w = num(p.w, 100);
        const h = num(p.h, 100) + num(p.growY, 0);
        const geo = str(p.geo, "rectangle");
        const text = shapeText(p);
        const fontSize = (LABEL_FONT_SIZES[str(p.size, "m")] ?? 22) * scale;
        const box = { ...boxFrom(ctx.t, w, h), width: w, height: h };
        const poly = polygonFor(geo);
        if (poly) {
          warn("approximated-geo", r, geo);
          const abs = [...poly, poly[0]].map(([u, v]) => toPage(ctx.t, u * w, v * h));
          const groupId = text ? derivedId(`${id}-group`) : null;
          const inner: WalkContext = groupId ? { ...ctx, groupIds: [groupId, ...ctx.groupIds] } : ctx;
          const lin = linearFrom(abs);
          elements.push({
            ...base(id, r, inner, { ...lin, angle: 0 }),
            type: "line",
            points: lin.points,
            lastCommittedPoint: null,
            startBinding: null,
            endBinding: null,
            startArrowhead: null,
            endArrowhead: null,
            polygon: true,
          });
          if (text) {
            const [cx, cy] = toPage(ctx.t, w / 2, h / 2);
            elements.push(
              textElement(derivedId(`${id}-label`), r, inner, text, fontSize, {
                center: [cx, cy],
                angle: box.angle,
                align: textAlign(p.align, text),
                valign: "middle",
                containerId: null,
                strokeColor: color(p.labelColor ?? p.color),
                wrapAt: Math.max(fontSize, w - 2 * BOUND_TEXT_PADDING),
              }),
            );
          }
          placed.set(r.id, { t: ctx.t, w, h });
          return;
        }
        let kind: ExShapeElement["type"] = "rectangle";
        if (geo === "ellipse") kind = "ellipse";
        else if (geo === "oval") {
          kind = "ellipse";
          warn("approximated-geo", r, geo);
        }
        else if (geo === "diamond") kind = "diamond";
        else if (geo === "cloud" || geo === "heart") {
          kind = "ellipse";
          warn("approximated-geo", r, geo);
        } else if (geo !== "rectangle") {
          // check-box / x-box lose their inner mark; an unknown kind is drawn as a box.
          warn("approximated-geo", r, geo);
        }
        const el: ExShapeElement = { ...base(id, r, ctx, box), type: kind };
        elements.push(el);
        addLabel(el, r, ctx, text, fontSize, p);
        placed.set(r.id, { t: ctx.t, w, h });
        return;
      }

      case "note": {
        const size = 200 * scale;
        const h = 200 * scale + num(p.growY, 0) * scale;
        const box = { ...boxFrom(ctx.t, size, h), width: size, height: h };
        const el: ExShapeElement = {
          ...base(id, r, ctx, box),
          type: "rectangle",
          backgroundColor: NOTE_FILLS[str(p.color, "yellow")] ?? NOTE_FILLS.yellow,
          fillStyle: "solid",
          strokeColor: "transparent",
          strokeStyle: "solid",
          roughness: 0,
        };
        elements.push(el);
        // fontSizeAdjustment: 0 = the preset; tldraw stores the shrunk-to-fit size
        // (read as a ratio of the preset when it is at most 1).
        const preset = LABEL_FONT_SIZES[str(p.size, "m")] ?? 22;
        const adj = num(p.fontSizeAdjustment, 0);
        const fontSize = (adj <= 0 ? preset : adj <= 1 ? preset * adj : adj) * scale;
        addLabel(el, r, ctx, shapeText(p), fontSize, {
          ...p,
          labelColor: p.labelColor ?? (p.color === "black" ? "white" : "black"),
        });
        placed.set(r.id, { t: ctx.t, w: size, h });
        return;
      }

      case "text": {
        const text = shapeText(p);
        const fontSize = (TEXT_FONT_SIZES[str(p.size, "m")] ?? 24) * scale;
        const m = measureText(text, fontSize);
        const fixed = p.autoSize === false;
        const w = fixed ? num(p.w, m.width) * scale : m.width;
        const h = fixed ? measureText(wrapText(text, fontSize, w), fontSize).height : m.height;
        const center = toPage(ctx.t, w / 2, h / 2);
        elements.push(
          textElement(id, r, ctx, text, fontSize, {
            center,
            angle: normAngle(ctx.t.rotation),
            align: textAlign(p.textAlign ?? p.align ?? "start", text),
            valign: "top",
            containerId: null,
            strokeColor: color(p.color),
            ...(fixed ? { width: round(w) } : {}),
          }),
        );
        placed.set(r.id, { t: ctx.t, w, h });
        return;
      }

      case "frame": {
        const w = num(p.w, 160);
        const h = num(p.h, 90);
        const el: ExFrameElement = {
          ...base(id, r, ctx, { ...boxFrom(ctx.t, w, h), width: w, height: h }),
          type: "frame",
          name: str(p.name, "") || null,
          strokeColor: "#bbbbbb",
          backgroundColor: "transparent",
          strokeWidth: 2,
          strokeStyle: "solid",
          roughness: 0,
          frameId: null,
          groupIds: [],
        };
        if (ctx.frameId) warn("nested-frame", r, `inside ${ctx.frameId}`);
        elements.push(el);
        placed.set(r.id, { t: ctx.t, w, h });
        return;
      }

      case "image": {
        const w = num(p.w, 100);
        const h = num(p.h, 100);
        const assetId = str(p.assetId, "");
        const asset = assetId ? byId.get(assetId) : undefined;
        const ap = asset ? props(asset) : {};
        const src = str(ap.src, "") || str(p.url, "");
        if (!src.startsWith("data:")) {
          warn("image-not-embedded", r, src ? "remote image (not downloaded)" : "asset missing");
          placeholder(r, ctx, src ? `[image] ${src}` : "[image]");
          if (src) {
            const last = elements.find((e) => e.id === id);
            if (last) last.link = src;
          }
          placed.set(r.id, { t: ctx.t, w, h });
          return;
        }
        const fileId = excalidrawIdOf(assetId || `asset:${id}`);
        const mime = str(ap.mimeType, "") || /^data:([^;,]+)/.exec(src)?.[1] || "image/png";
        files[fileId] = { id: fileId, mimeType: mime, dataURL: src, created: updated, lastRetrieved: updated };
        let crop: ExCrop | null = null;
        const nw = num(ap.w, 0);
        const nh = num(ap.h, 0);
        if (isObj(p.crop) && nw > 0 && nh > 0 && isObj(p.crop.topLeft) && isObj(p.crop.bottomRight)) {
          const tl = p.crop.topLeft;
          const br = p.crop.bottomRight;
          const x0 = num(tl.x, 0);
          const y0 = num(tl.y, 0);
          const x1 = num(br.x, 1);
          const y1 = num(br.y, 1);
          if (x0 > 0 || y0 > 0 || x1 < 1 || y1 < 1) {
            crop = {
              x: round(x0 * nw),
              y: round(y0 * nh),
              width: round((x1 - x0) * nw),
              height: round((y1 - y0) * nh),
              naturalWidth: nw,
              naturalHeight: nh,
            };
          }
        }
        elements.push({
          ...base(id, r, ctx, { ...boxFrom(ctx.t, w, h), width: w, height: h }),
          type: "image",
          strokeColor: "transparent",
          backgroundColor: "transparent",
          fileId,
          status: "saved",
          scale: [p.flipX === true ? -1 : 1, p.flipY === true ? -1 : 1],
          crop,
        });
        placed.set(r.id, { t: ctx.t, w, h });
        return;
      }

      case "draw":
      case "highlight": {
        const segments = Array.isArray(p.segments) ? p.segments : [];
        const sx = num(p.scaleX, 1);
        const sy = num(p.scaleY, 1);
        const pts: { x: number; y: number; z: number }[] = [];
        let unreadable = false;
        for (const seg of segments) {
          const sp = segmentPoints(seg);
          if (!sp) unreadable = true;
          else pts.push(...sp);
        }
        if (pts.length === 0) {
          warn("draw-unreadable", r, unreadable ? "points could not be decoded" : "no points");
          placeholder(r, ctx, `[${type}]`);
          return;
        }
        if (unreadable) warn("draw-unreadable", r, "some segments could not be decoded");
        if (p.isClosed === true && pts.length > 2) pts.push(pts[0]);
        const lin = linearFrom(pts.map((q) => toPage(ctx.t, q.x * sx, q.y * sy)));
        const highlight = type === "highlight";
        const el: ExFreedrawElement = {
          ...base(id, r, ctx, { ...lin, angle: 0 }),
          type: "freedraw",
          points: lin.points,
          pressures: p.isPen === true ? pts.map((q) => round(q.z)) : [],
          simulatePressure: p.isPen !== true,
          lastCommittedPoint: null,
        };
        if (highlight) {
          el.strokeWidth = el.strokeWidth * 4;
          el.opacity = Math.round(el.opacity * 0.5);
          el.backgroundColor = "transparent";
        }
        elements.push(el);
        return;
      }

      case "line": {
        let raw: unknown[] = [];
        if (isObj(p.points)) raw = Object.values(p.points);
        else if (Array.isArray(p.points)) raw = p.points;
        else if (isObj(p.handles)) raw = Object.values(p.handles);
        const pts = raw
          .filter(isObj)
          .sort((a, b) => {
            const ia = str(a.index, "");
            const ib = str(b.index, "");
            return ia < ib ? -1 : ia > ib ? 1 : 0;
          })
          // Stored points are page units already; `scale` only styles the stroke.
          .map((q) => toPage(ctx.t, num(q.x, 0), num(q.y, 0)));
        if (pts.length < 2) {
          placeholder(r, ctx, "[line]");
          warn("draw-unreadable", r, "line with fewer than two points");
          return;
        }
        const lin = linearFrom(pts);
        elements.push({
          ...base(id, r, ctx, { ...lin, angle: 0 }),
          type: "line",
          backgroundColor: "transparent",
          roundness: p.spline === "cubic" ? { type: 2 } : null,
          points: lin.points,
          lastCommittedPoint: null,
          startBinding: null,
          endBinding: null,
          startArrowhead: null,
          endArrowhead: null,
        });
        return;
      }

      case "arrow": {
        const el: ExLinearElement = {
          ...base(id, r, ctx, { x: ctx.t.x, y: ctx.t.y, width: 0, height: 0, angle: 0 }),
          type: "arrow",
          backgroundColor: "transparent",
          points: [[0, 0]],
          lastCommittedPoint: null,
          startBinding: null,
          endBinding: null,
          startArrowhead: arrowhead(p.arrowheadStart, null),
          endArrowhead: arrowhead(p.arrowheadEnd, "arrow"),
          elbowed: false,
        };
        elements.push(el);
        pendingArrows.push({ r, el, ctx });
        return;
      }

      case "group":
        // Handled by the walker: children carry the group id.
        return;

      case "video":
      case "embed":
      case "bookmark": {
        warn("unsupported-shape", r, type);
        // A video's source lives in its asset; an embedded (data:) video is not carried over.
        const asset = typeof p.assetId === "string" ? byId.get(p.assetId) : undefined;
        const assetSrc = asset ? str(props(asset).src, "") : "";
        const url = str(p.url, "") || (/^https?:/i.test(assetSrc) ? assetSrc : "");
        placeholder(r, ctx, url ? `[${type}] ${url}` : `[${type}]`);
        if (url) {
          const el = elements.find((e) => e.id === id);
          if (el) el.link = url;
        }
        placed.set(r.id, { t: ctx.t, w: num(p.w, 160), h: num(p.h, 90) });
        return;
      }

      default: {
        warn("unknown-shape", r, type);
        const text = shapeText(p);
        placeholder(r, ctx, text ? `[${type}] ${text}` : `[${type}]`);
        placed.set(r.id, { t: ctx.t, w: num(p.w, 160), h: num(p.h, 90) });
      }
    }
  };

  const visited = new Set<string>();
  const walk = (list: TlRecord[], parent: WalkContext): void => {
    for (const r of list) {
      if (visited.has(r.id)) continue; // a parentId cycle in a corrupt store
      visited.add(r.id);
      const t: Transform = (() => {
        const [x, y] = toPage(parent.t, num(r.x, 0), num(r.y, 0));
        return { x, y, rotation: parent.t.rotation + num(r.rotation, 0) };
      })();
      const ctx: WalkContext = { ...parent, t };
      convertShape(r, ctx);
      const kids = children.get(r.id);
      if (kids && kids.length) {
        const type = str(r.type, "");
        const inner: WalkContext = { ...ctx };
        if (type === "group") inner.groupIds = [excalidrawIdOf(r.id), ...ctx.groupIds];
        if (type === "frame") inner.frameId = excalidrawIdOf(r.id);
        walk(kids, inner);
      }
    }
  };

  const root: WalkContext = { t: { x: 0, y: 0, rotation: 0 }, groupIds: [], frameId: null };
  let pageOffset = 0;
  let prevMaxX: number | null = null;
  const pageRoots: TlRecord[][] = pages.map((pg) => children.get(pg.id) ?? []);
  if (orphanRoots.length) {
    if (pageRoots.length) pageRoots[0] = [...pageRoots[0], ...orphanRoots];
    else pageRoots.push(orphanRoots);
  }
  pageRoots.forEach((list, i) => {
    const start = elements.length;
    walk(list, root);
    finishArrows();
    if (elements.length === start) return;
    const slice = elements.slice(start);
    const bounds = boundsOf(slice);
    if (i > 0 && prevMaxX !== null) {
      pageOffset = round(prevMaxX + 400 - bounds.minX);
      for (const el of slice) el.x = round(el.x + pageOffset);
      const page = pages[i];
      if (page) warn("extra-page", page, str(page.name, ""));
      prevMaxX = bounds.maxX + pageOffset;
    } else {
      prevMaxX = bounds.maxX;
    }
  });

  // Shapes no page reaches (a parentId cycle in a corrupt store): keep them too.
  const unreached = records.filter((r) => r.typeName === "shape" && !visited.has(r.id)).sort(byIndex);
  if (unreached.length) {
    walk(unreached, root);
    finishArrows();
  }

  function finishArrows(): void {
    if (pendingArrows.length === 0) return;
    const elementById = new Map<string, ExcalidrawElement>(elements.map((x) => [x.id, x]));
    for (const { r, el, ctx } of pendingArrows.splice(0)) {
      const p = props(r);
      const bindings = bindingsByArrow.get(r.id) ?? [];
      // Terminals and bend are page units; `scale` only sizes the label,
      // stroke and heads (checked against tldraw's own editor).
      const terminal = (which: "start" | "end"): ExPoint => {
        const v = p[which];
        if (isObj(v) && typeof v.x === "number" && typeof v.y === "number") return toPage(ctx.t, v.x, v.y);
        // tldraw 2.x stored the binding inside the terminal: { type: "binding", boundShapeId, normalizedAnchor }.
        if (isObj(v) && typeof v.boundShapeId === "string") {
          const target = placed.get(v.boundShapeId);
          const a = isObj(v.normalizedAnchor) ? v.normalizedAnchor : {};
          if (target) return toPage(target.t, num(a.x, 0.5) * target.w, num(a.y, 0.5) * target.h);
        }
        return toPage(ctx.t, which === "start" ? 0 : 100, 0);
      };
      const s = terminal("start");
      const e = terminal("end");
      const abs: ExPoint[] = [s];
      const bend = num(p.bend, 0);
      if (p.kind === "elbow") warn("elbow-arrow", r);
      else if (Math.abs(bend) > 0.5) {
        const dx = e[0] - s[0];
        const dy = e[1] - s[1];
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        // tldraw: middle = med + u.per() * -bend, per(x, y) = (y, -x).
        abs.push([(s[0] + e[0]) / 2 - uy * bend, (s[1] + e[1]) / 2 + ux * bend]);
        el.roundness = { type: 2 };
      }
      abs.push(e);
      const lin = linearFrom(abs);
      el.x = lin.x;
      el.y = lin.y;
      el.width = lin.width;
      el.height = lin.height;
      el.points = lin.points;

      const bindTo = (which: "start" | "end"): ExBinding | null => {
        let targetId: string | null = null;
        let anchor: Obj = {};
        let source: TlRecord = r;
        const b = bindings.find((x) => isObj(x.props) && x.props.terminal === which);
        if (b) {
          targetId = str(b.toId, "") || null;
          anchor = isObj(props(b).normalizedAnchor) ? (props(b).normalizedAnchor as Obj) : {};
          source = b;
        } else {
          const v = p[which];
          if (isObj(v) && typeof v.boundShapeId === "string") {
            targetId = v.boundShapeId;
            anchor = isObj(v.normalizedAnchor) ? v.normalizedAnchor : {};
          }
        }
        if (!targetId) return null;
        const exTarget = excalidrawIdOf(targetId);
        const target = elementById.get(exTarget);
        if (!target || !BINDABLE.has(target.type)) {
          warnings.push({
            code: "binding-dropped",
            recordId: source.id,
            recordType: source === r ? "arrow" : "binding",
            detail: target ? `target is a ${target.type}` : `target ${targetId} missing`,
          });
          return null;
        }
        if (!(target.boundElements ?? []).some((x) => x.id === el.id)) {
          target.boundElements = [...(target.boundElements ?? []), { id: el.id, type: "arrow" }];
        }
        return {
          elementId: exTarget,
          focus: 0,
          gap: 1,
          fixedPoint: [round(num(anchor.x, 0.5)), round(num(anchor.y, 0.5))],
        };
      };
      el.startBinding = bindTo("start");
      el.endBinding = bindTo("end");

      const text = shapeText(p);
      if (text) {
        const fontSize = (ARROW_FONT_SIZES[str(p.size, "m")] ?? 20) * num(p.scale, 1);
        const pos = num(p.labelPosition, 0.5);
        const mid = pointAlong(abs, pos);
        const id = derivedId(`${el.id}-label`);
        const labelEl = textElement(id, r, ctx, text, fontSize, {
          center: mid,
          angle: 0,
          align: "center",
          valign: "middle",
          containerId: el.id,
          strokeColor: color(p.labelColor ?? p.color),
        });
        const at = elements.indexOf(el);
        elements.splice(at + 1, 0, labelEl);
        el.boundElements = [...(el.boundElements ?? []), { id, type: "text" }];
      }
    }
  }

  const byElementType: Record<string, number> = {};
  for (const el of elements) byElementType[el.type] = (byElementType[el.type] ?? 0) + 1;

  return {
    file: {
      type: "excalidraw",
      version: 2,
      source: options.source ?? "lumen-md",
      elements,
      appState: { viewBackgroundColor: "#ffffff", gridSize },
      files,
    },
    warnings,
    stats: {
      shapes: records.filter((r) => r.typeName === "shape").length,
      elements: elements.length,
      byTldrawType,
      byElementType,
    },
  };
}
