// Body-fitting for the voxel solid solver: boundary nodes of the grid are moved onto the exact surface, and the
// resulting distorted hexahedra get their own element matrices (Wilson-Taylor incompatible modes with Taylor's
// correction for non-parallelepipeds), so curved boundaries are represented as curved instead of stair-stepped.
import type { V3 } from './path.ts';

export const HEX_SIGNS: [number, number, number][] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

const G1 = 1 / Math.sqrt(3);
const GAUSS: V3[] = [];
for (const z of [-G1, G1])
  for (const y of [-G1, G1]) for (const x of [-G1, G1]) GAUSS.push([x, y, z]);

function dNat(xi: number, eta: number, zeta: number): number[][] {
  return HEX_SIGNS.map(([sx, sy, sz]) => [
    (sx * (1 + eta * sy) * (1 + zeta * sz)) / 8,
    (sy * (1 + xi * sx) * (1 + zeta * sz)) / 8,
    (sz * (1 + xi * sx) * (1 + eta * sy)) / 8,
  ]);
}

/** Jacobian J[i][j] = d x_i / d xi_j at a natural point, with its determinant and inverse. */
function jacobian(xe: ArrayLike<number>, xi: number, eta: number, zeta: number) {
  const dn = dNat(xi, eta, zeta);
  const J = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let a = 0; a < 8; a++)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        (J[i] as number[])[j] =
          ((J[i] as number[])[j] as number) +
          (xe[a * 3 + i] as number) * ((dn[a] as number[])[j] as number);
  const [[a, b, c], [d, e, f], [g, h, i]] = J as [number[], number[], number[]] as [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const inv = [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
  return { dn, det, inv };
}

/** Smallest corner Jacobian determinant of the element, relative to `ref` (the ideal brick's detJ). */
export function minCornerJacobian(xe: ArrayLike<number>, ref: number): number {
  let m = Number.POSITIVE_INFINITY;
  for (const [sx, sy, sz] of HEX_SIGNS) m = Math.min(m, jacobian(xe, sx, sy, sz).det);
  return m / ref;
}

export interface HexBuild {
  /** condensed 24 x 24 stiffness */
  Ke: Float64Array;
  /** 9 x 24: incompatible amplitudes alpha = R u */
  R: Float64Array;
  /** strain-displacement (6 x 24) and incompatible (6 x 9) matrices at the 8 Gauss points */
  B: Float64Array[];
  G: Float64Array[];
  volume: number;
}

function invert9(A: Float64Array): Float64Array {
  const n = 9;
  const a: Float64Array[] = Array.from({ length: n }, (_, i) => {
    const row = new Float64Array(2 * n);
    for (let j = 0; j < n; j++) row[j] = A[i * n + j] as number;
    row[n + i] = 1;
    return row;
  });
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (
        Math.abs((a[r] as Float64Array)[c] as number) >
        Math.abs((a[p] as Float64Array)[c] as number)
      )
        p = r;
    [a[c], a[p]] = [a[p] as Float64Array, a[c] as Float64Array];
    const pr = a[c] as Float64Array;
    const d = pr[c] as number;
    for (let j = 0; j < 2 * n; j++) pr[j] = (pr[j] as number) / d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const rr = a[r] as Float64Array;
      const f = rr[c] as number;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) rr[j] = (rr[j] as number) - f * (pr[j] as number);
    }
  }
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) out[i * n + j] = (a[i] as Float64Array)[n + j] as number;
  return out;
}

/** Element matrices for an arbitrary (distorted) hexahedron with corner coordinates xe (24 numbers, node order HEX_SIGNS). */
export function buildHex(xe: ArrayLike<number>, D: Float64Array): HexBuild {
  const c0 = jacobian(xe, 0, 0, 0);
  const Kuu = new Float64Array(24 * 24);
  const Kua = new Float64Array(24 * 9);
  const Kaa = new Float64Array(81);
  const Bs: Float64Array[] = [];
  const Gs: Float64Array[] = [];
  let volume = 0;
  for (const [xi, eta, zeta] of GAUSS) {
    const { dn, det, inv } = jacobian(xe, xi, eta, zeta);
    if (!(det > 0)) throw new Error('inverted element');
    volume += det;
    const B = new Float64Array(6 * 24);
    for (let a = 0; a < 8; a++) {
      const g = dn[a] as number[];
      // d N / d x_i = sum_j invJ[j][i] dN/d xi_j
      const dx = [0, 0, 0].map((_, i) => {
        let s = 0;
        for (let j = 0; j < 3; j++) s += ((inv[j] as number[])[i] as number) * (g[j] as number);
        return s;
      }) as V3;
      const c = a * 3;
      B[0 * 24 + c] = dx[0];
      B[1 * 24 + c + 1] = dx[1];
      B[2 * 24 + c + 2] = dx[2];
      B[3 * 24 + c] = dx[1];
      B[3 * 24 + c + 1] = dx[0];
      B[4 * 24 + c + 1] = dx[2];
      B[4 * 24 + c + 2] = dx[1];
      B[5 * 24 + c] = dx[2];
      B[5 * 24 + c + 2] = dx[0];
    }
    // incompatible modes with Taylor's correction: grad_x = (detJ0 / detJ) J0^-T grad_xi
    const G = new Float64Array(6 * 9);
    const nat: V3[] = [
      [-2 * xi, 0, 0],
      [0, -2 * eta, 0],
      [0, 0, -2 * zeta],
    ];
    const scale = c0.det / det;
    for (let bub = 0; bub < 3; bub++) {
      const gn = nat[bub] as V3;
      const gr = [0, 1, 2].map((i) => {
        let s = 0;
        for (let j = 0; j < 3; j++) s += ((c0.inv[j] as number[])[i] as number) * (gn[j] as number);
        return s * scale;
      }) as V3;
      for (let d = 0; d < 3; d++) {
        const col = bub * 3 + d;
        if (d === 0) {
          G[0 * 9 + col] = gr[0];
          G[3 * 9 + col] = gr[1];
          G[5 * 9 + col] = gr[2];
        } else if (d === 1) {
          G[1 * 9 + col] = gr[1];
          G[3 * 9 + col] = gr[0];
          G[4 * 9 + col] = gr[2];
        } else {
          G[2 * 9 + col] = gr[2];
          G[4 * 9 + col] = gr[1];
          G[5 * 9 + col] = gr[0];
        }
      }
    }
    const DB = new Float64Array(6 * 24);
    const DG = new Float64Array(6 * 9);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 24; j++) {
        let v = 0;
        for (let k = 0; k < 6; k++) v += (D[i * 6 + k] as number) * (B[k * 24 + j] as number);
        DB[i * 24 + j] = v;
      }
      for (let j = 0; j < 9; j++) {
        let v = 0;
        for (let k = 0; k < 6; k++) v += (D[i * 6 + k] as number) * (G[k * 9 + j] as number);
        DG[i * 9 + j] = v;
      }
    }
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 24; j++) {
        let v = 0;
        for (let k = 0; k < 6; k++) v += (B[k * 24 + i] as number) * (DB[k * 24 + j] as number);
        Kuu[i * 24 + j] = (Kuu[i * 24 + j] as number) + v * det;
      }
      for (let j = 0; j < 9; j++) {
        let v = 0;
        for (let k = 0; k < 6; k++) v += (B[k * 24 + i] as number) * (DG[k * 9 + j] as number);
        Kua[i * 9 + j] = (Kua[i * 9 + j] as number) + v * det;
      }
    }
    for (let i = 0; i < 9; i++)
      for (let j = 0; j < 9; j++) {
        let v = 0;
        for (let k = 0; k < 6; k++) v += (G[k * 9 + i] as number) * (DG[k * 9 + j] as number);
        Kaa[i * 9 + j] = (Kaa[i * 9 + j] as number) + v * det;
      }
    Bs.push(B);
    Gs.push(G);
  }
  const KaaInv = invert9(Kaa);
  const KuaKi = new Float64Array(24 * 9);
  for (let i = 0; i < 24; i++)
    for (let j = 0; j < 9; j++) {
      let v = 0;
      for (let k = 0; k < 9; k++) v += (Kua[i * 9 + k] as number) * (KaaInv[k * 9 + j] as number);
      KuaKi[i * 9 + j] = v;
    }
  const Ke = new Float64Array(24 * 24);
  for (let i = 0; i < 24; i++)
    for (let j = 0; j < 24; j++) {
      let v = 0;
      for (let k = 0; k < 9; k++) v += (KuaKi[i * 9 + k] as number) * (Kua[j * 9 + k] as number);
      Ke[i * 24 + j] = (Kuu[i * 24 + j] as number) - v;
    }
  const R = new Float64Array(9 * 24);
  for (let i = 0; i < 9; i++)
    for (let j = 0; j < 24; j++) {
      let v = 0;
      for (let k = 0; k < 9; k++) v += (KaaInv[i * 9 + k] as number) * (Kua[j * 9 + k] as number);
      R[i * 24 + j] = -v;
    }
  return { Ke, R, B: Bs, G: Gs, volume };
}

// ---- snapping boundary nodes onto the surface ----------------------------------------------------------------------

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection). */
function closestOnTriangle(p: V3, a: V3, b: V3, c: V3): V3 {
  const sub = (u: V3, v: V3): V3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: V3, v: V3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

export interface SurfaceIndex {
  nearest(p: V3): { point: V3; dist: number } | undefined;
}

/** Spatial hash over the surface triangles for nearest-point queries within about 2 cell sizes. */
export function indexSurface(
  vertices: ArrayLike<number>,
  triangles: ArrayLike<number>,
  origin: V3,
  cell: number,
): SurfaceIndex {
  const cells = new Map<number, number[]>();
  const key = (i: number, j: number, k: number) => i + 8192 * (j + 8192 * k);
  const nTri = triangles.length / 3;
  const tri = (t: number): [V3, V3, V3] => {
    const o = [0, 1, 2].map((s) => (triangles[t * 3 + s] as number) * 3);
    return o.map(
      (ix) =>
        [vertices[ix] as number, vertices[ix + 1] as number, vertices[ix + 2] as number] as V3,
    ) as [V3, V3, V3];
  };
  for (let t = 0; t < nTri; t++) {
    const [a, b, c] = tri(t);
    const lo = [0, 1, 2].map((d) =>
      Math.floor(
        (Math.min(a[d] as number, b[d] as number, c[d] as number) - (origin[d] as number)) / cell,
      ),
    );
    const hi = [0, 1, 2].map((d) =>
      Math.floor(
        (Math.max(a[d] as number, b[d] as number, c[d] as number) - (origin[d] as number)) / cell,
      ),
    );
    for (let i = lo[0] as number; i <= (hi[0] as number); i++)
      for (let j = lo[1] as number; j <= (hi[1] as number); j++)
        for (let k = lo[2] as number; k <= (hi[2] as number); k++) {
          const kk = key(i + 1, j + 1, k + 1);
          const list = cells.get(kk);
          if (list) list.push(t);
          else cells.set(kk, [t]);
        }
  }
  return {
    nearest(p: V3) {
      const ci = Math.floor((p[0] - origin[0]) / cell);
      const cj = Math.floor((p[1] - origin[1]) / cell);
      const ck = Math.floor((p[2] - origin[2]) / cell);
      const seen = new Set<number>();
      let best: { point: V3; dist: number } | undefined;
      for (let i = ci - 1; i <= ci + 1; i++)
        for (let j = cj - 1; j <= cj + 1; j++)
          for (let k = ck - 1; k <= ck + 1; k++) {
            const list = cells.get(key(i + 1, j + 1, k + 1));
            if (!list) continue;
            for (const t of list) {
              if (seen.has(t)) continue;
              seen.add(t);
              const [a, b, c] = tri(t);
              const q = closestOnTriangle(p, a, b, c);
              const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
              if (!best || d < best.dist) best = { point: q, dist: d };
            }
          }
      return best;
    },
  };
}
