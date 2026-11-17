/**
 * The GPU force layout (plan W13.G1): a lazy chunk, loaded by ../engine.ts
 * only when a graph of 20,000+ nodes opens on a WebGL 2 machine.
 *
 * Every step is three GPU passes and no readback:
 *   1. splat — one point per node into the level-0 density grid (additive
 *      blending into RGBA32F: count, Σx, Σy);
 *   2. reduce — each coarser mip level sums four cells of the one below;
 *   3. step — one fragment per node: grid repulsion, springs over the CSR
 *      adjacency textures, gravity, a move capped by the temperature,
 *      written to the other position texture (ping-pong).
 * Positions are read back only once per animation frame, for the
 * progressive picture, and at the end. The shaders mirror ./pack.ts.
 */
import { initialPositions } from "../layout";
import { defaultParams, gridLevels, packAdjacency, temperatureAt, type GpuLayoutParams } from "./pack";
import { QUAD_VS, REDUCE_FS, SPLAT_FS, SPLAT_VS, STEP_FS } from "./shaders";

export interface GpuLayoutOptions {
  iterations?: number;
  /** Positions while it settles (once per animation frame). */
  onFrame?: (positions: Float32Array) => void;
  signal?: AbortSignal;
  /** Steps per animation frame (default: as many as fit in ~12 ms, measured). */
  stepsPerFrame?: number;
  /** Start here instead of the spiral (tests, a re-layout after a filter). */
  start?: Float32Array;
  /** Force constants other than the defaults (tests, tuning). */
  params?: Partial<GpuLayoutParams>;
  /** A context to use (tests); default: an offscreen one of its own. */
  gl?: WebGL2RenderingContext;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram();
  if (!prog) throw new Error("gpu layout: no program");
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type);
    if (!s) throw new Error("gpu layout: no shader");
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`gpu layout: ${gl.getShaderInfoLog(s) ?? "shader"}`);
    gl.attachShader(prog, s);
    gl.deleteShader(s);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`gpu layout: ${gl.getProgramInfoLog(prog) ?? "link"}`);
  return prog;
}

function texture(gl: WebGL2RenderingContext, levels: number, fmt: number, w: number, h: number): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error("gpu layout: no texture");
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, levels, fmt, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.NEAREST_MIPMAP_NEAREST : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function framebuffer(gl: WebGL2RenderingContext, tex: WebGLTexture, level = 0): WebGLFramebuffer {
  const fb = gl.createFramebuffer();
  if (!fb) throw new Error("gpu layout: no framebuffer");
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, level);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("gpu layout: float render target refused");
  return fb;
}

function offscreenContext(): WebGL2RenderingContext {
  const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error("gpu layout: no WebGL 2");
  return gl;
}

/** A layout session on one context: upload once, then `step()` as often as wanted. */
export class GpuLayout {
  readonly params: GpuLayoutParams;
  private readonly gl: WebGL2RenderingContext;
  private readonly side: number;
  private readonly state: WebGLTexture[];
  private readonly stateFb: WebGLFramebuffer[];
  private readonly grid: WebGLTexture;
  private readonly gridFb: WebGLFramebuffer[];
  private readonly adj: WebGLTexture;
  private readonly nbr: WebGLTexture;
  private readonly nside: number;
  private readonly progs: { splat: WebGLProgram; reduce: WebGLProgram; step: WebGLProgram };
  private readonly vao: WebGLVertexArrayObject | null;
  private cur = 0;
  stepIndex = 0;

  constructor(gl: WebGL2RenderingContext, n: number, edges: Uint32Array, opts: { iterations?: number; start?: Float32Array; params?: Partial<GpuLayoutParams> } = {}) {
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("gpu layout: no EXT_color_buffer_float");
    if (!gl.getExtension("EXT_float_blend")) throw new Error("gpu layout: no EXT_float_blend");
    this.gl = gl;
    this.params = { ...defaultParams(n, opts.iterations), ...opts.params, n };
    const packed = packAdjacency(n, edges);
    this.side = packed.side;
    this.nside = packed.nside;
    const s = this.side;
    const start = opts.start && opts.start.length === 2 * n ? opts.start : initialPositions(n, this.params.k);
    const rgba = new Float32Array(s * s * 4);
    for (let i = 0; i < n; i++) {
      rgba[4 * i] = start[2 * i];
      rgba[4 * i + 1] = start[2 * i + 1];
      rgba[4 * i + 3] = 1;
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.state = [0, 1].map(() => texture(gl, 1, gl.RGBA32F, s, s));
    gl.bindTexture(gl.TEXTURE_2D, this.state[0]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, s, s, gl.RGBA, gl.FLOAT, rgba);
    this.stateFb = this.state.map((t) => framebuffer(gl, t));
    const F = this.params.F;
    const levels = gridLevels(F) + 1;
    this.grid = texture(gl, levels, gl.RGBA32F, F, F);
    this.gridFb = Array.from({ length: levels }, (_, l) => framebuffer(gl, this.grid, l));
    this.adj = texture(gl, 1, gl.RG32UI, s, s);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, s, s, gl.RG_INTEGER, gl.UNSIGNED_INT, packed.adj);
    this.nbr = texture(gl, 1, gl.R32UI, packed.nside, packed.nside);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, packed.nside, packed.nside, gl.RED_INTEGER, gl.UNSIGNED_INT, packed.nbr);
    this.progs = { splat: program(gl, SPLAT_VS, SPLAT_FS), reduce: program(gl, QUAD_VS, REDUCE_FS), step: program(gl, QUAD_VS, STEP_FS) };
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);
  }

  private bind(prog: WebGLProgram, unit: number, name: string, tex: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
  }

  /** One layout step on the GPU. */
  step() {
    const gl = this.gl;
    const p = this.params;
    const F = p.F;
    const levels = this.gridFb.length;
    gl.bindVertexArray(this.vao);
    // 1. Splat into level 0.
    gl.bindTexture(gl.TEXTURE_2D, this.grid);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels - 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gridFb[0]);
    gl.viewport(0, 0, F, F);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.progs.splat);
    this.bind(this.progs.splat, 0, "u_state", this.state[this.cur]);
    gl.uniform1i(gl.getUniformLocation(this.progs.splat, "u_side"), this.side);
    gl.uniform1f(gl.getUniformLocation(this.progs.splat, "u_R"), p.R);
    gl.uniform1i(gl.getUniformLocation(this.progs.splat, "u_F"), F);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, p.n);
    gl.disable(gl.BLEND);
    // 2. Reduce: level l from level l − 1, which is the only level the sampler sees.
    gl.useProgram(this.progs.reduce);
    for (let l = 1; l < levels; l++) {
      gl.bindTexture(gl.TEXTURE_2D, this.grid);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, l - 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, l - 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.gridFb[l]);
      gl.viewport(0, 0, F >> l, F >> l);
      this.bind(this.progs.reduce, 0, "u_grid", this.grid);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.grid);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels - 1);
    // 3. Step into the other state texture.
    const prog = this.progs.step;
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFb[1 - this.cur]);
    gl.viewport(0, 0, this.side, this.side);
    this.bind(prog, 0, "u_state", this.state[this.cur]);
    this.bind(prog, 1, "u_grid", this.grid);
    this.bind(prog, 2, "u_adj", this.adj);
    this.bind(prog, 3, "u_nbr", this.nbr);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    gl.uniform1i(u("u_n"), p.n);
    gl.uniform1i(u("u_side"), this.side);
    gl.uniform1i(u("u_nside"), this.nside);
    gl.uniform1i(u("u_F"), F);
    gl.uniform1f(u("u_R"), p.R);
    gl.uniform1f(u("u_k"), p.k);
    gl.uniform1f(u("u_springPower"), p.springPower);
    gl.uniform1f(u("u_gravity"), p.gravity);
    gl.uniform1f(u("u_temp"), temperatureAt(this.stepIndex, p));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cur = 1 - this.cur;
    this.stepIndex++;
  }

  /** The current positions (x, y per node): one readback. */
  read(): Float32Array {
    const gl = this.gl;
    const s = this.side;
    const buf = new Float32Array(s * s * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFb[this.cur]);
    gl.readPixels(0, 0, s, s, gl.RGBA, gl.FLOAT, buf);
    const n = this.params.n;
    const out = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) {
      out[2 * i] = buf[4 * i];
      out[2 * i + 1] = buf[4 * i + 1];
    }
    return out;
  }

  dispose() {
    const gl = this.gl;
    for (const t of [...this.state, this.grid, this.adj, this.nbr]) gl.deleteTexture(t);
    for (const f of [...this.stateFb, ...this.gridFb]) gl.deleteFramebuffer(f);
    for (const p of Object.values(this.progs)) gl.deleteProgram(p);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}

const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));

/**
 * Lay out n nodes and their links on the GPU. Resolves to x, y per node;
 * rejects on abort or when the GPU can't (the engine then falls back).
 */
export async function runGpuLayout(n: number, edges: Uint32Array, opts: GpuLayoutOptions = {}): Promise<Float32Array> {
  if (n < 2) return initialPositions(n);
  const own = !opts.gl;
  const gl = opts.gl ?? offscreenContext();
  const layout = new GpuLayout(gl, n, edges, { iterations: opts.iterations, start: opts.start, params: opts.params });
  const now = () => performance.now();
  try {
    let perFrame = opts.stepsPerFrame ?? 1;
    const total = layout.params.iterations;
    while (layout.stepIndex < total) {
      if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
      const t0 = now();
      const todo = Math.min(perFrame, total - layout.stepIndex);
      for (let k = 0; k < todo; k++) layout.step();
      // The readback waits for the GPU, so it also measures the steps.
      const frame = layout.read();
      if (gl.isContextLost()) throw new Error("gpu layout: context lost");
      opts.onFrame?.(frame);
      if (!opts.stepsPerFrame) {
        const per = (now() - t0) / todo;
        perFrame = Math.max(1, Math.min(64, Math.floor(12 / Math.max(0.05, per))));
      }
      await nextFrame();
    }
    return layout.read();
  } finally {
    layout.dispose();
    if (own) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
