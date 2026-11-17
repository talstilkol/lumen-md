/**
 * The GPU layout's shaders (plan W13.G1), GLSL ES 3.00. They mirror
 * ./pack.ts (`buildGrid`, `gridRepulsion`, `referenceStep`) line for line.
 *
 * Textures: u_state (RGBA32F, side²: x, y per node), u_grid (RGBA32F, F²
 * with a mip chain: count, Σx, Σy per cell, level l = F >> l), u_adj
 * (RG32UI: first neighbour, degree), u_nbr (R32UI: the neighbour list).
 */
import { MAX_DEGREE_READS, NEAR } from "./pack";

/** A full-screen triangle: one fragment per texel of the target. */
export const QUAD_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Splat: one point per node into its level-0 cell, added up by blending. */
export const SPLAT_VS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_state;
uniform int u_side;
uniform float u_R;
uniform int u_F;
out vec2 v_p;
void main() {
  int i = gl_VertexID;
  vec2 p = texelFetch(u_state, ivec2(i % u_side, i / u_side), 0).xy;
  // The same cell as the step shader computes, drawn at the cell's centre (no rounding at the edges).
  ivec2 cc = clamp(ivec2(floor((p + u_R) / (2.0 * u_R) * float(u_F))), ivec2(0), ivec2(u_F - 1));
  gl_Position = vec4((vec2(cc) + 0.5) / float(u_F) * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  v_p = p;
}`;
export const SPLAT_FS = `#version 300 es
precision highp float;
in vec2 v_p;
out vec4 o;
void main() { o = vec4(1.0, v_p, 0.0); }`;

/** One coarser level: each cell sums its four children (the source level is the only one visible). */
export const REDUCE_FS = `#version 300 es
precision highp float;
uniform highp sampler2D u_grid;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy) * 2;
  o = texelFetch(u_grid, c, 0) + texelFetch(u_grid, c + ivec2(1, 0), 0)
    + texelFetch(u_grid, c + ivec2(0, 1), 0) + texelFetch(u_grid, c + ivec2(1, 1), 0);
}`;

/** The step: repulsion from the grid, springs along the links, gravity, a capped move. */
export const STEP_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform highp sampler2D u_state;
uniform highp sampler2D u_grid;
uniform usampler2D u_adj;
uniform usampler2D u_nbr;
uniform int u_n;
uniform int u_side;
uniform int u_nside;
uniform int u_F;
uniform float u_R;
uniform float u_k;
uniform float u_gravity;
uniform float u_temp;
out vec4 o;

vec2 rep(vec2 p, vec4 cell) {
  if (cell.x <= 0.5) return vec2(0.0);
  vec2 d = p - cell.yz / cell.x;
  float r2 = max(dot(d, d), u_k * u_k * 0.01);
  return d * (u_k * u_k * cell.x / r2);
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int i = c.y * u_side + c.x;
  if (i >= u_n) { o = vec4(0.0); return; }
  vec2 p = texelFetch(u_state, c, 0).xy;
  vec2 f = vec2(0.0);
  int F = u_F;
  ivec2 cc = clamp(ivec2(floor((p + u_R) / (2.0 * u_R) * float(F))), ivec2(0), ivec2(F - 1));
  for (int dy = -${NEAR}; dy <= ${NEAR}; dy++) {
    for (int dx = -${NEAR}; dx <= ${NEAR}; dx++) {
      ivec2 q = cc + ivec2(dx, dy);
      if (q.x < 0 || q.y < 0 || q.x >= F || q.y >= F) continue;
      vec4 cell = texelFetch(u_grid, q, 0);
      if (dx == 0 && dy == 0) cell -= vec4(1.0, p, 0.0);
      f += rep(p, cell);
    }
  }
  int l = 0;
  for (int s = F; s >= 2; s >>= 1) {
    ivec2 lc = cc >> l;
    ivec2 pc = lc >> 1;
    for (int oy = -${2 * NEAR}; oy <= ${2 * NEAR + 1}; oy++) {
      for (int ox = -${2 * NEAR}; ox <= ${2 * NEAR + 1}; ox++) {
        ivec2 q = pc * 2 + ivec2(ox, oy);
        if (q.x < 0 || q.y < 0 || q.x >= s || q.y >= s) continue;
        if (abs(q.x - lc.x) <= ${NEAR} && abs(q.y - lc.y) <= ${NEAR}) continue;
        f += rep(p, texelFetch(u_grid, q, l));
      }
    }
    l++;
  }
  uvec2 a = texelFetch(u_adj, c, 0).xy;
  int start = int(a.x);
  int deg = int(a.y);
  int stride = max(1, (deg + ${MAX_DEGREE_READS - 1}) / ${MAX_DEGREE_READS});
  for (int r = 0; r < ${MAX_DEGREE_READS}; r++) {
    int k = r * stride;
    if (k >= deg) break;
    int j = start + k;
    int nb = int(texelFetch(u_nbr, ivec2(j % u_nside, j / u_nside), 0).x);
    vec2 d = texelFetch(u_state, ivec2(nb % u_side, nb / u_side), 0).xy - p;
    f += d * length(d) * float(stride) / u_k;
  }
  f -= p * u_gravity;
  float len = length(f);
  float move = len > 1e-9 ? min(len, u_temp) / len : 0.0;
  float lim = u_R * 0.98;
  o = vec4(clamp(p + f * move, vec2(-lim), vec2(lim)), 0.0, 1.0);
}`;
