/**
 * The optional 3D graph (plan W13.G10): the same nodes, links, colours and
 * filters as the 2D canvas, lifted into depth (../../graph/graph3d.ts) and
 * drawn with WebGL — points sized by distance, links, depth tested — with a
 * 2D overlay for labels, where each label runs in its own direction.
 *
 * Off by default, and never offered under prefers-reduced-motion (the host
 * checks; this view also refuses to start). It loads in its own chunk.
 *
 * Keyboard: the surface is one focusable "application": ←/→/↑/↓ orbit,
 * + / − zoom, 0 fits, ] and [ step to the next / previous node (most
 * connected first), Home to the most connected, Enter opens the focused
 * node; the focused node is announced in a live region. Drag orbits; the
 * wheel zooms; a click picks and opens.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../../i18n";
import { extent, fitCamera, lift3d, orbit, pick3d, project, viewProjection, zoom, type Camera } from "../../graph/graph3d";
import { prefersReducedMotion } from "../../lib/motion";

export interface Graph3DViewProps {
  labels: readonly string[];
  /** Pairs of node indices. */
  edges: Uint32Array;
  /** The 2D layout (x, y per node); null while it runs. */
  positions: Float32Array | null;
  /** r, g, b, a per node, 0–1. */
  colors: Float32Array;
  sizes: Float32Array;
  neighbors: (i: number) => ArrayLike<number>;
  onOpen: (i: number) => void;
  ariaLabel: string;
  edgeColor?: [number, number, number, number];
  labelColor?: string;
}

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const MAX_LABELS = 80;

const VS = `
attribute vec3 a_pos; attribute vec4 a_color; attribute float a_size;
uniform mat4 u_m; uniform float u_px;
varying vec4 v_color;
void main() {
  vec4 p = u_m * vec4(a_pos, 1.0);
  gl_Position = p;
  gl_PointSize = clamp(a_size * u_px * 1.6 / max(p.w, 0.0001), 3.0, 22.0);
  v_color = a_color;
}`;
const FS_POINT = `
precision mediump float; varying vec4 v_color;
void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25) discard; gl_FragColor = vec4(v_color.rgb * (1.0 - d * 0.8), v_color.a); }`;
const FS_LINE = `precision mediump float; varying vec4 v_color; void main() { gl_FragColor = v_color; }`;

function program(gl: WebGLRenderingContext, fs: string): WebGLProgram | null {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type);
    if (!s || !p) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p!);
  return gl.getProgramParameter(p!, gl.LINK_STATUS) ? p : null;
}

export function Graph3DView({ labels, edges, positions, colors, sizes, neighbors, onOpen, ariaLabel, edgeColor = [0.5, 0.55, 0.62, 0.35], labelColor = "hsl(var(--fg))" }: Graph3DViewProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const glCanvas = useRef<HTMLCanvasElement>(null);
  const labelCanvas = useRef<HTMLCanvasElement>(null);
  const gl = useRef<{ ctx: WebGLRenderingContext; points: WebGLProgram; lines: WebGLProgram; buf: WebGLBuffer; lineBuf: WebGLBuffer } | null>(null);
  const [noGl, setNoGl] = useState(false);
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const n = labels.length;
  const p3 = useMemo(() => (positions && positions.length === 2 * n ? lift3d(positions, edges) : null), [positions, edges, n]);
  const r = useMemo(() => (positions && n ? extent(positions).r : 1), [positions, n]);
  const [cam, setCam] = useState<Camera>(() => fitCamera(r));
  useEffect(() => setCam(fitCamera(r)), [r]);
  const order = useMemo(() => Array.from({ length: n }, (_, i) => i).sort((a, b) => neighbors(b).length - neighbors(a).length || a - b), [n, neighbors]);
  const [focus, setFocus] = useState(-1);
  const size = useRef({ w: 300, h: 200, dpr: 1 });

  // GL setup.
  useEffect(() => {
    const c = glCanvas.current;
    if (!c || reduced) return;
    const ctx = (c.getContext("webgl", { antialias: true }) ?? null) as WebGLRenderingContext | null;
    if (!ctx || typeof ctx.createProgram !== "function") return setNoGl(true);
    const points = program(ctx, FS_POINT);
    const lines = program(ctx, FS_LINE);
    const buf = ctx.createBuffer();
    const lineBuf = ctx.createBuffer();
    if (!points || !lines || !buf || !lineBuf) return setNoGl(true);
    gl.current = { ctx, points, lines, buf, lineBuf };
    return () => {
      ctx.deleteBuffer(buf);
      ctx.deleteBuffer(lineBuf);
      gl.current = null;
    };
  }, [reduced]);

  // Interleaved vertex data: x y z r g b a size, per node and per link end.
  const data = useMemo(() => {
    if (!p3) return null;
    const node = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) node.set([p3[3 * i], p3[3 * i + 1], p3[3 * i + 2], colors[4 * i], colors[4 * i + 1], colors[4 * i + 2], colors[4 * i + 3], sizes[i] || 4], i * 8);
    const line = new Float32Array(edges.length * 8);
    for (let k = 0; k < edges.length; k++) {
      const i = edges[k];
      line.set([p3[3 * i], p3[3 * i + 1], p3[3 * i + 2], ...edgeColor, 1], k * 8);
    }
    return { node, line };
  }, [p3, n, colors, sizes, edges, edgeColor]);

  useEffect(() => {
    const g = gl.current;
    const el = wrap.current;
    if (!g || !el || !data) return;
    const { ctx } = g;
    const rect = el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
    size.current = { w, h, dpr };
    for (const c of [glCanvas.current, labelCanvas.current]) if (c) (c.width = w * dpr), (c.height = h * dpr);
    const m = viewProjection(cam, w / h);
    ctx.viewport(0, 0, w * dpr, h * dpr);
    ctx.clearColor(0, 0, 0, 0);
    ctx.enable(ctx.DEPTH_TEST);
    ctx.enable(ctx.BLEND);
    ctx.blendFunc(ctx.SRC_ALPHA, ctx.ONE_MINUS_SRC_ALPHA);
    ctx.clear(ctx.COLOR_BUFFER_BIT | ctx.DEPTH_BUFFER_BIT);
    const draw = (prog: WebGLProgram, buf: WebGLBuffer, arr: Float32Array, mode: number, count: number) => {
      ctx.useProgram(prog);
      ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
      ctx.bufferData(ctx.ARRAY_BUFFER, arr, ctx.STATIC_DRAW);
      const at = (name: string, sizeN: number, off: number) => {
        const loc = ctx.getAttribLocation(prog, name);
        if (loc < 0) return;
        ctx.enableVertexAttribArray(loc);
        ctx.vertexAttribPointer(loc, sizeN, ctx.FLOAT, false, 32, off * 4);
      };
      at("a_pos", 3, 0);
      at("a_color", 4, 3);
      at("a_size", 1, 7);
      ctx.uniformMatrix4fv(ctx.getUniformLocation(prog, "u_m"), false, m);
      ctx.uniform1f(ctx.getUniformLocation(prog, "u_px"), (h * dpr) / (2 * Math.tan(cam.fov / 2)));
      ctx.drawArrays(mode, 0, count);
    };
    draw(g.lines, g.lineBuf, data.line, ctx.LINES, edges.length);
    draw(g.points, g.buf, data.node, ctx.POINTS, n);
    // Labels: the biggest nodes and the focused one with its neighbours, far to near.
    const lc = labelCanvas.current?.getContext("2d");
    if (!lc || !p3) return;
    lc.setTransform(dpr, 0, 0, dpr, 0, 0);
    lc.clearRect(0, 0, w, h);
    const must = new Set<number>(focus >= 0 ? [focus, ...Array.from(neighbors(focus)).slice(0, 20)] : []);
    // Nearest first get their place; a label that would overlap one already placed is left out (the focused one never is).
    const cand = [...must, ...order.slice(0, MAX_LABELS).filter((i) => !must.has(i))]
      .map((i) => ({ i, p: project(m, p3[3 * i], p3[3 * i + 1], p3[3 * i + 2], w, h) }))
      .filter((x) => x.p.depth > 0 && x.p.x >= 0 && x.p.x <= w && x.p.y >= 0 && x.p.y <= h)
      .sort((a, b) => (a.i === focus ? -1 : b.i === focus ? 1 : a.p.depth - b.p.depth));
    const placed: Array<[number, number, number, number]> = [];
    const list: typeof cand = [];
    for (const c of cand) {
      const half = Math.min(40, labels[c.i].length) * 3.2;
      const box: [number, number, number, number] = [c.p.x - half, c.p.y - 20, c.p.x + half, c.p.y - 4];
      if (c.i !== focus && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      list.push(c);
    }
    list.sort((a, b) => b.p.depth - a.p.depth);
    lc.textAlign = "center";
    lc.textBaseline = "bottom";
    lc.fillStyle = labelColor.startsWith("hsl(var") ? getComputedStyle(el).color : labelColor;
    for (const { i, p } of list) {
      const strong = i === focus;
      lc.font = `${strong ? 600 : 400} ${strong ? 13 : 11}px system-ui, "Noto Sans Hebrew", sans-serif`;
      lc.direction = RTL.test(labels[i]) ? "rtl" : "ltr";
      const text = labels[i].length > 40 ? `${[...labels[i]].slice(0, 38).join("")}…` : labels[i];
      lc.fillText(text, p.x, p.y - 6);
      if (strong) {
        lc.strokeStyle = lc.fillStyle;
        lc.lineWidth = 2;
        lc.beginPath();
        lc.arc(p.x, p.y, 9, 0, Math.PI * 2);
        lc.stroke();
      }
    }
  }, [data, cam, focus, labels, order, neighbors, p3, n, edges, labelColor]);

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const step = (d: number) => {
    if (!n) return;
    const at = order.indexOf(focus);
    setFocus(order[(at < 0 ? 0 : at + d + n) % n]);
  };
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    const a = e.shiftKey ? 0.3 : 0.1;
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const map: Record<string, () => void> = {
      ArrowLeft: () => setCam((c) => orbit(c, rtl ? a : -a, 0)),
      ArrowRight: () => setCam((c) => orbit(c, rtl ? -a : a, 0)),
      ArrowUp: () => setCam((c) => orbit(c, 0, a)),
      ArrowDown: () => setCam((c) => orbit(c, 0, -a)),
      "+": () => setCam((c) => zoom(c, 0.8, r)),
      "=": () => setCam((c) => zoom(c, 0.8, r)),
      "-": () => setCam((c) => zoom(c, 1.25, r)),
      "0": () => setCam(fitCamera(r)),
      "]": () => step(1),
      "[": () => step(-1),
      Home: () => setFocus(order[0] ?? -1),
      Enter: () => focus >= 0 && onOpen(focus),
    };
    if (map[k]) {
      e.preventDefault();
      map[k]();
    }
  };

  if (reduced) return <p role="note" data-testid="graph-3d-reduced" style={{ padding: 16 }}>{t("graph3d.reduced")}</p>;
  const focused = focus >= 0 && focus < n ? t("graph3d.focused", { name: labels[focus], links: neighbors(focus).length, index: order.indexOf(focus) + 1, total: n }) : "";
  return (
    <div style={{ position: "relative", inlineSize: "100%", blockSize: "100%" }} data-testid="graph-3d">
      {noGl && (
        <p role="alert" style={{ position: "absolute", insetInlineStart: 12, insetBlockStart: 12, zIndex: 2, margin: 0 }} data-testid="graph-3d-nogl">
          {t("graph3d.noWebgl")}
        </p>
      )}
      <div
        ref={wrap}
        tabIndex={0}
        role="application"
        aria-roledescription={t("graph3d.role")}
        aria-label={ariaLabel}
        aria-describedby="graph-3d-keys"
        onKeyDown={onKey}
        onFocus={() => focus < 0 && n && setFocus(order[0])}
        onWheel={(e) => setCam((c) => zoom(c, Math.exp(e.deltaY * 0.0015), r))}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
          if (!d.moved) return;
          setCam((c) => orbit(c, dx * 0.008, dy * 0.008));
          d.x = e.clientX;
          d.y = e.clientY;
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.moved || !p3 || !wrap.current) return;
          const rect = wrap.current.getBoundingClientRect();
          const { w, h } = size.current;
          const i = pick3d(viewProjection(cam, w / h), p3, e.clientX - rect.left, e.clientY - rect.top, w, h, e.pointerType === "mouse" ? 10 : 22);
          if (i >= 0) (setFocus(i), onOpen(i));
        }}
        className="lumen-graph-surface"
        data-focus={focus >= 0 ? focus : undefined}
        style={{ position: "absolute", inset: 0, outline: "none", cursor: "grab", touchAction: "none", color: labelColor }}
      >
        <canvas ref={glCanvas} aria-hidden style={{ position: "absolute", inset: 0, inlineSize: "100%", blockSize: "100%" }} />
        <canvas ref={labelCanvas} aria-hidden style={{ position: "absolute", inset: 0, inlineSize: "100%", blockSize: "100%", pointerEvents: "none" }} />
      </div>
      <div role="status" aria-live="polite" data-testid="graph-3d-focused" style={{ position: "absolute", insetBlockEnd: 6, insetInlineStart: 8, fontSize: 11, color: "hsl(var(--fg-muted))", pointerEvents: "none" }}>
        {focused}
      </div>
      <p id="graph-3d-keys" style={{ position: "absolute", insetBlockEnd: 6, insetInlineEnd: 8, margin: 0, fontSize: 10, color: "hsl(var(--fg-muted))", pointerEvents: "none" }}>
        {t("graph3d.keys")}
      </p>
    </div>
  );
}

export default Graph3DView;
