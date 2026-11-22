// Voxel-based linear-elastic solid FEA: the body is filled with a regular grid of cubic 8-node hexahedra that use
// Wilson-Taylor incompatible modes (so bending does not lock), solved matrix-free by preconditioned conjugate gradients.
//
// With `fit` (default) the boundary nodes are snapped onto the exact surface and the distorted hexahedra get their own
// matrices (solidfit.ts), so curved boundaries are curved; stress is recovered at the nodes. Honest scope: it is still a
// structured grid, so sharp corners and features thinner than about two elements are not captured, peak stress at
// singular corners and under point loads keeps growing with refinement (read p99, refine, compare). Not a certification.
import { measureVolume, type Shape3D } from 'replicad';
import { type FaceNormal, findFace } from './faces.ts';
import type { V3 } from './path.ts';
import { buildHex, indexSurface, minCornerJacobian } from './solidfit.ts';

export interface SolidRegion {
  /** a world-space box; nodes inside it (within half an element) are selected */
  box?: { min: V3; max: V3 };
  /** or a flat face of the body picked by outward normal (optionally the one nearest `near`) */
  face?: { normal: FaceNormal; near?: V3 };
}

export interface SolidSupport {
  region: SolidRegion;
  /** which translations are held (default all three) */
  dofs?: ('x' | 'y' | 'z')[];
}
export interface SolidLoad {
  region: SolidRegion;
  /** total force in N, shared equally between the selected nodes */
  force: V3;
}

export interface SolidFeaInput {
  shape: Shape3D;
  E: number; // MPa
  nu?: number; // default 0.3
  yield?: number; // MPa
  density?: number; // g/cm3, for gravity
  /** element edge length, mm */
  elementSize: number;
  supports: SolidSupport[];
  loads?: SolidLoad[];
  /** add self weight acting along -Z */
  gravity?: boolean;
  maxElements?: number;
  /** move boundary nodes onto the exact surface and use distorted-hex elements (default true); false = pure voxel staircase */
  fit?: boolean;
  /** CG relative residual tolerance (default 1e-7) */
  tolerance?: number;
  maxIterations?: number;
}

export interface SolidFeaResult {
  elements: number;
  nodes: number;
  dofs: number;
  elementSizeMm: number;
  grid: [number, number, number];
  /** voxel volume over true volume: how well the grid represents the shape (1 = exact) */
  volumeRatio: number;
  /** the mesh was fitted to the surface (curved boundaries represented as curved) */
  fitted: boolean;
  snappedNodes: number;
  /** nodes whose move was shortened to keep elements valid */
  relaxedNodes: number;
  /** worst corner Jacobian relative to an undistorted brick (1 = perfect, <0.1 is poor) */
  minJacobianRatio: number;
  iterations: number;
  converged: boolean;
  relativeResidual: number;
  maxDisplacement: { value: number; at: V3 };
  maxVonMises: { value: number; at: V3 };
  /** 99th percentile of element von Mises: robust against single-element corner spikes */
  p99VonMises: number;
  /** largest element-average von Mises (smoother than the nodal peak; Gauss points sit inside the element) */
  peakElementVonMises: number;
  medianVonMises: number;
  safetyFactorPeak?: number;
  safetyFactorP99?: number;
  /** support reactions: total force vector, N */
  reaction: V3;
  /** |applied + reaction|, N */
  equilibriumErrorN: number;
  strainEnergyJ: number;
  elementCenters: Float64Array;
  elementVonMises: Float64Array;
  /** displacement at every active node: [x, y, z, ux, uy, uz] flat */
  nodeData: Float64Array;
  warnings: string[];
}

const DEFAULT_MAX_ELEMENTS = 60000;

// ---- the one element matrix (all elements are identical cubes) -----------------------------------------------------

interface ElementModel {
  Ke: Float64Array; // 24 x 24 condensed
  /** 9 x 24: incompatible mode amplitudes from nodal displacements (alpha = R u) */
  R: Float64Array;
  D: Float64Array; // 6 x 6
  /** Gauss-point matrices for stress recovery: B (6x24) and G (6x9) per point */
  B: Float64Array[];
  G: Float64Array[];
}

const SIGNS: [number, number, number][] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

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

function buildElement(hv: V3, E: number, nu: number): ElementModel {
  const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu));
  const mu = E / (2 * (1 + nu));
  const D = new Float64Array(36);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) D[i * 6 + j] = i === j ? lam + 2 * mu : lam;
  D[3 * 6 + 3] = mu;
  D[4 * 6 + 4] = mu;
  D[5 * 6 + 5] = mu;

  const g = 1 / Math.sqrt(3);
  const pts: V3[] = [];
  for (const sz of [-g, g])
    for (const sy of [-g, g]) for (const sx of [-g, g]) pts.push([sx, sy, sz]);
  const detJ = (hv[0] * hv[1] * hv[2]) / 8;
  const sxs = 2 / hv[0]; // d/dx = (2/hx) d/dxi
  const sys = 2 / hv[1];
  const szs = 2 / hv[2];

  const Kuu = new Float64Array(24 * 24);
  const Kua = new Float64Array(24 * 9);
  const Kaa = new Float64Array(81);
  const Bs: Float64Array[] = [];
  const Gs: Float64Array[] = [];

  for (const [xi, eta, zeta] of pts) {
    const B = new Float64Array(6 * 24);
    for (let a = 0; a < 8; a++) {
      const [sx, sy, sz] = SIGNS[a] as [number, number, number];
      const dNdx = (sxs * sx * (1 + eta * sy) * (1 + zeta * sz)) / 8;
      const dNdy = (sys * sy * (1 + xi * sx) * (1 + zeta * sz)) / 8;
      const dNdz = (szs * sz * (1 + xi * sx) * (1 + eta * sy)) / 8;
      const c = a * 3;
      B[0 * 24 + c] = dNdx;
      B[1 * 24 + c + 1] = dNdy;
      B[2 * 24 + c + 2] = dNdz;
      B[3 * 24 + c] = dNdy;
      B[3 * 24 + c + 1] = dNdx;
      B[4 * 24 + c + 1] = dNdz;
      B[4 * 24 + c + 2] = dNdy;
      B[5 * 24 + c] = dNdz;
      B[5 * 24 + c + 2] = dNdx;
    }
    // incompatible modes: bubbles (1 - xi^2), (1 - eta^2), (1 - zeta^2), each in x, y and z
    const G = new Float64Array(6 * 9);
    const grad: V3[] = [
      [-2 * xi * sxs, 0, 0],
      [0, -2 * eta * sys, 0],
      [0, 0, -2 * zeta * szs],
    ];
    for (let bub = 0; bub < 3; bub++) {
      const gr = grad[bub] as V3;
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
    // DB and DG
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
        Kuu[i * 24 + j] = (Kuu[i * 24 + j] as number) + v * detJ;
      }
      for (let j = 0; j < 9; j++) {
        let v = 0;
        for (let k = 0; k < 6; k++) v += (B[k * 24 + i] as number) * (DG[k * 9 + j] as number);
        Kua[i * 9 + j] = (Kua[i * 9 + j] as number) + v * detJ;
      }
    }
    for (let i = 0; i < 9; i++)
      for (let j = 0; j < 9; j++) {
        let v = 0;
        for (let k = 0; k < 6; k++) v += (G[k * 9 + i] as number) * (DG[k * 9 + j] as number);
        Kaa[i * 9 + j] = (Kaa[i * 9 + j] as number) + v * detJ;
      }
    Bs.push(B);
    Gs.push(G);
  }

  const KaaInv = invert9(Kaa);
  // condensed: Ke = Kuu - Kua Kaa^-1 Kau ; alpha = -Kaa^-1 Kau u  (R = -Kaa^-1 Kua^T)
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
  return { Ke, R, D, B: Bs, G: Gs };
}

// ---- voxelisation --------------------------------------------------------------------------------------------------

function voxelise(shape: Shape3D, lo: V3, hv: V3, n: [number, number, number]) {
  const [nx, ny, nz] = n;
  const mesh = shape.mesh({
    tolerance: Math.max(Math.min(...hv) * 0.02, 0.005),
    angularTolerance: 0.1,
  });
  const p = mesh.vertices;
  const cols: number[][] = Array.from({ length: nx * ny }, () => []);
  // jitter the sample column slightly so rays never run exactly along a mesh edge
  const jx = hv[0] * 1.3e-6;
  const jy = hv[1] * 0.7e-6;
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const ia = (mesh.triangles[t] as number) * 3;
    const ib = (mesh.triangles[t + 1] as number) * 3;
    const ic = (mesh.triangles[t + 2] as number) * 3;
    const ax = p[ia] as number;
    const ay = p[ia + 1] as number;
    const az = p[ia + 2] as number;
    const bx = p[ib] as number;
    const by = p[ib + 1] as number;
    const bz = p[ib + 2] as number;
    const cx = p[ic] as number;
    const cy = p[ic + 1] as number;
    const cz = p[ic + 2] as number;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-14) continue; // vertical triangle: contributes no crossings
    const minx = Math.min(ax, bx, cx);
    const maxx = Math.max(ax, bx, cx);
    const miny = Math.min(ay, by, cy);
    const maxy = Math.max(ay, by, cy);
    const i0 = Math.max(0, Math.floor((minx - lo[0]) / hv[0] - 0.5));
    const i1 = Math.min(nx - 1, Math.ceil((maxx - lo[0]) / hv[0] - 0.5));
    const j0 = Math.max(0, Math.floor((miny - lo[1]) / hv[1] - 0.5));
    const j1 = Math.min(ny - 1, Math.ceil((maxy - lo[1]) / hv[1] - 0.5));
    for (let i = i0; i <= i1; i++) {
      const x = lo[0] + (i + 0.5) * hv[0] + jx;
      for (let j = j0; j <= j1; j++) {
        const y = lo[1] + (j + 0.5) * hv[1] + jy;
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
        const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        (cols[i + j * nx] as number[]).push(l1 * az + l2 * bz + l3 * cz);
      }
    }
  }
  const solid = new Uint8Array(nx * ny * nz);
  let bad = 0;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const zs = (cols[i + j * nx] as number[]).sort((a, b) => a - b);
      if (zs.length % 2 === 1) {
        bad++;
        continue;
      }
      for (let k = 0; k < nz; k++) {
        const zc = lo[2] + (k + 0.5) * hv[2];
        let below = 0;
        for (const z of zs) if (z < zc) below++;
        if (below % 2 === 1) solid[i + nx * (j + ny * k)] = 1;
      }
    }
  return { solid, badColumns: bad };
}

function selectNodes(
  region: SolidRegion,
  shape: Shape3D,
  nodeCoord: (idx: number) => V3,
  count: number,
  h: number,
  what: string,
): number[] {
  let min: V3;
  let max: V3;
  const tol = h * 0.51;
  if (region.box) {
    min = region.box.min;
    max = region.box.max;
  } else if (region.face) {
    const f = findFace(shape, region.face.normal, region.face.near);
    min = [f.min[0] - tol, f.min[1] - tol, f.min[2] - tol];
    max = [f.max[0] + tol, f.max[1] + tol, f.max[2] + tol];
    const axis = region.face.normal.endsWith('X') ? 0 : region.face.normal.endsWith('Y') ? 1 : 2;
    min[axis] = f.level - tol;
    max[axis] = f.level + tol;
  } else throw new Error(`${what}: give a "box" or a "face" region`);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const c = nodeCoord(i);
    if (
      c[0] >= min[0] - tol &&
      c[0] <= max[0] + tol &&
      c[1] >= min[1] - tol &&
      c[1] <= max[1] + tol &&
      c[2] >= min[2] - tol &&
      c[2] <= max[2] + tol
    )
      out.push(i);
  }
  if (out.length === 0)
    throw new Error(
      `${what}: the region contains no solid nodes (check its position against the body, or use a smaller element size)`,
    );
  return out;
}

export function solidFea(inp: SolidFeaInput): SolidFeaResult {
  const nu = inp.nu ?? 0.3;
  const h = inp.elementSize;
  if (!(h > 0)) throw new Error('elementSize must be positive');
  if (!(inp.E > 0)) throw new Error('E must be positive');
  if (inp.supports.length === 0)
    throw new Error('Add at least one support, or the part can move freely');
  const [bmin, bmax] = inp.shape.boundingBox.bounds as unknown as [number[], number[]];
  const lo: V3 = [bmin[0] as number, bmin[1] as number, bmin[2] as number];
  const hi: V3 = [bmax[0] as number, bmax[1] as number, bmax[2] as number];
  const n: [number, number, number] = [
    Math.max(1, Math.round((hi[0] - lo[0]) / h)),
    Math.max(1, Math.round((hi[1] - lo[1]) / h)),
    Math.max(1, Math.round((hi[2] - lo[2]) / h)),
  ];
  // the cell size differs slightly per axis so the grid spans the bounding box exactly (a 6 mm section stays 6 mm)
  const hv: V3 = [(hi[0] - lo[0]) / n[0], (hi[1] - lo[1]) / n[1], (hi[2] - lo[2]) / n[2]];
  const hmax = Math.max(...hv);
  const [nx, ny, nz] = n;
  const maxEl = inp.maxElements ?? DEFAULT_MAX_ELEMENTS;
  if (nx * ny * nz > maxEl * 4)
    throw new Error(
      `The bounding grid is ${nx} x ${ny} x ${nz} = ${nx * ny * nz} cells: use a larger elementSize (limit about ${maxEl} solid elements)`,
    );

  const { solid, badColumns } = voxelise(inp.shape, lo, hv, n);
  const warnings: string[] = [];
  if (badColumns > 0)
    warnings.push(
      `${badColumns} grid column(s) crossed the surface an odd number of times (open or non-manifold mesh); those columns were left empty`,
    );

  // active nodes
  const nodeIndex = new Int32Array((nx + 1) * (ny + 1) * (nz + 1)).fill(-1);
  const nid = (i: number, j: number, k: number) => i + (nx + 1) * (j + (ny + 1) * k);
  let nElem = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!solid[i + nx * (j + ny * k)]) continue;
        nElem++;
        for (const [sx, sy, sz] of SIGNS) {
          const gi = nid(i + (sx > 0 ? 1 : 0), j + (sy > 0 ? 1 : 0), k + (sz > 0 ? 1 : 0));
          if (nodeIndex[gi] === -1) nodeIndex[gi] = -2;
        }
      }
  if (nElem === 0)
    throw new Error('The grid captured no solid: the element size may be larger than the part');
  if (nElem > maxEl)
    throw new Error(
      `${nElem} elements is more than the limit of ${maxEl}: use a larger elementSize`,
    );
  let nNodes = 0;
  const nodeGrid: number[] = []; // active node -> grid id
  for (let g = 0; g < nodeIndex.length; g++)
    if (nodeIndex[g] === -2) {
      nodeIndex[g] = nNodes++;
      nodeGrid.push(g);
    }
  const coordOf = (a: number): V3 => {
    const g = nodeGrid[a] as number;
    const i = g % (nx + 1);
    const j = Math.floor(g / (nx + 1)) % (ny + 1);
    const k = Math.floor(g / ((nx + 1) * (ny + 1)));
    return [lo[0] + i * hv[0], lo[1] + j * hv[1], lo[2] + k * hv[2]];
  };
  const conn = new Int32Array(nElem * 8);
  const centers = new Float64Array(nElem * 3);
  {
    let e = 0;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          if (!solid[i + nx * (j + ny * k)]) continue;
          let a = 0;
          for (const [sx, sy, sz] of SIGNS) {
            conn[e * 8 + a] = nodeIndex[
              nid(i + (sx > 0 ? 1 : 0), j + (sy > 0 ? 1 : 0), k + (sz > 0 ? 1 : 0))
            ] as number;
            a++;
          }
          centers[e * 3] = lo[0] + (i + 0.5) * hv[0];
          centers[e * 3 + 1] = lo[1] + (j + 0.5) * hv[1];
          centers[e * 3 + 2] = lo[2] + (k + 0.5) * hv[2];
          e++;
        }
  }
  const ndof = nNodes * 3;

  // ---- body fitting: move boundary nodes onto the exact surface and build per-element matrices where needed ----
  const el = buildElement(hv, inp.E, nu);
  const fitOn = inp.fit ?? true;
  const base = new Float64Array(nNodes * 3);
  for (let a = 0; a < nNodes; a++) {
    const c = coordOf(a);
    base[a * 3] = c[0];
    base[a * 3 + 1] = c[1];
    base[a * 3 + 2] = c[2];
  }
  const xyz = Float64Array.from(base);
  const brickVol = hv[0] * hv[1] * hv[2];
  const evol = new Float64Array(nElem).fill(brickVol);
  const distIdx = new Int32Array(nElem).fill(-1);
  let distKe = new Float64Array(0);
  let snappedNodes = 0;
  let relaxedNodes = 0;
  let minJ = 1;
  const gatherXe = (e: number, out: Float64Array) => {
    for (let a = 0; a < 8; a++) {
      const nd = (conn[e * 8 + a] as number) * 3;
      out[a * 3] = xyz[nd] as number;
      out[a * 3 + 1] = xyz[nd + 1] as number;
      out[a * 3 + 2] = xyz[nd + 2] as number;
    }
  };
  if (fitOn) {
    const bnd = new Uint8Array(nNodes);
    {
      let e = 0;
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < nx; i++) {
            if (!solid[i + nx * (j + ny * k)]) continue;
            for (let ax = 0; ax < 3; ax++)
              for (const sg of [-1, 1]) {
                const ni = i + (ax === 0 ? sg : 0);
                const nj = j + (ax === 1 ? sg : 0);
                const nk = k + (ax === 2 ? sg : 0);
                const open =
                  ni < 0 ||
                  nj < 0 ||
                  nk < 0 ||
                  ni >= nx ||
                  nj >= ny ||
                  nk >= nz ||
                  !solid[ni + nx * (nj + ny * nk)];
                if (!open) continue;
                for (let a = 0; a < 8; a++)
                  if ((SIGNS[a] as [number, number, number])[ax] === sg)
                    bnd[conn[e * 8 + a] as number] = 1;
              }
            e++;
          }
    }
    const mesh = inp.shape.mesh({
      tolerance: Math.max(Math.min(...hv) * 0.02, 0.005),
      angularTolerance: 0.1,
    });
    const index = indexSurface(mesh.vertices, mesh.triangles, lo, 2 * hmax);
    const target = Float64Array.from(base);
    const alpha = new Float64Array(nNodes);
    let farSkipped = 0;
    for (let a = 0; a < nNodes; a++) {
      if (!bnd[a]) continue;
      const q = index.nearest([
        base[a * 3] as number,
        base[a * 3 + 1] as number,
        base[a * 3 + 2] as number,
      ]);
      if (!q || q.dist < 1e-9 * hmax) continue;
      if (q.dist > 0.95 * hmax) {
        farSkipped++;
        continue;
      }
      target[a * 3] = q.point[0];
      target[a * 3 + 1] = q.point[1];
      target[a * 3 + 2] = q.point[2];
      alpha[a] = 1;
    }
    const place = () => {
      for (let a = 0; a < nNodes; a++)
        for (let d = 0; d < 3; d++)
          xyz[a * 3 + d] =
            (base[a * 3 + d] as number) +
            (alpha[a] as number) * ((target[a * 3 + d] as number) - (base[a * 3 + d] as number));
    };
    const ref = brickVol / 8;
    const xe = new Float64Array(24);
    for (let round = 0; round < 24; round++) {
      place();
      let bad = 0;
      for (let e = 0; e < nElem; e++) {
        gatherXe(e, xe);
        if (minCornerJacobian(xe, ref) < 0.1) {
          bad++;
          for (let a = 0; a < 8; a++) {
            const nd = conn[e * 8 + a] as number;
            if ((alpha[nd] as number) > 0)
              alpha[nd] = (alpha[nd] as number) < 0.1 ? 0 : (alpha[nd] as number) * 0.5;
          }
        }
      }
      if (bad === 0) break;
    }
    place();
    for (let a = 0; a < nNodes; a++) {
      const moved = Math.hypot(
        (xyz[a * 3] as number) - (base[a * 3] as number),
        (xyz[a * 3 + 1] as number) - (base[a * 3 + 1] as number),
        (xyz[a * 3 + 2] as number) - (base[a * 3 + 2] as number),
      );
      if (moved > 1e-9 * hmax) snappedNodes++;
      const wanted = Math.hypot(
        (target[a * 3] as number) - (base[a * 3] as number),
        (target[a * 3 + 1] as number) - (base[a * 3 + 1] as number),
        (target[a * 3 + 2] as number) - (base[a * 3 + 2] as number),
      );
      if (wanted > 1e-9 * hmax && moved < wanted * 0.999) relaxedNodes++;
    }
    if (farSkipped > 0)
      warnings.push(
        `${farSkipped} boundary node(s) were more than 0.95 element sizes from the surface (thin or sharp features) and were left in place`,
      );
    // element matrices for every element that has a moved node
    let nd = 0;
    const flagged: number[] = [];
    for (let e = 0; e < nElem; e++) {
      let any = false;
      for (let a = 0; a < 8 && !any; a++) {
        const node = (conn[e * 8 + a] as number) * 3;
        for (let d = 0; d < 3; d++)
          if (Math.abs((xyz[node + d] as number) - (base[node + d] as number)) > 1e-12) any = true;
      }
      if (any) {
        distIdx[e] = nd++;
        flagged.push(e);
      }
    }
    distKe = new Float64Array(nd * 576);
    minJ = Number.POSITIVE_INFINITY;
    for (const e of flagged) {
      gatherXe(e, xe);
      minJ = Math.min(minJ, minCornerJacobian(xe, ref));
      let hb: ReturnType<typeof buildHex>;
      try {
        hb = buildHex(xe, el.D);
      } catch {
        throw new Error(
          'The fitted mesh has an inverted element: use a smaller elementSize or set fit to false',
        );
      }
      distKe.set(hb.Ke, (distIdx[e] as number) * 576);
      evol[e] = hb.volume;
    }
    if (!Number.isFinite(minJ)) minJ = 1;
    if (minJ < 0.15)
      warnings.push(
        `Some fitted elements are strongly distorted (worst corner Jacobian ratio ${Math.round(minJ * 100) / 100}): refine the grid there for reliable stress`,
      );
  }
  // element centres from the final node positions
  for (let e = 0; e < nElem; e++) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let a = 0; a < 8; a++) {
      const nd2 = (conn[e * 8 + a] as number) * 3;
      sx += xyz[nd2] as number;
      sy += xyz[nd2 + 1] as number;
      sz += xyz[nd2 + 2] as number;
    }
    centers[e * 3] = sx / 8;
    centers[e * 3 + 1] = sy / 8;
    centers[e * 3 + 2] = sz / 8;
  }
  let voxelVolume = 0;
  for (let e = 0; e < nElem; e++) voxelVolume += evol[e] as number;

  // boundary conditions
  const fixed = new Uint8Array(ndof);
  for (const s of inp.supports) {
    const nodes = selectNodes(s.region, inp.shape, coordOf, nNodes, hmax, 'support');
    const axes = s.dofs ?? ['x', 'y', 'z'];
    for (const a of nodes) for (const ax of axes) fixed[a * 3 + { x: 0, y: 1, z: 2 }[ax]] = 1;
  }
  const f = new Float64Array(ndof);
  const applied: V3 = [0, 0, 0];
  for (const l of inp.loads ?? []) {
    const nodes = selectNodes(l.region, inp.shape, coordOf, nNodes, hmax, 'load');
    for (const a of nodes)
      for (let d = 0; d < 3; d++)
        f[a * 3 + d] = (f[a * 3 + d] as number) + (l.force[d] as number) / nodes.length;
    for (let d = 0; d < 3; d++) applied[d] = (applied[d] as number) + (l.force[d] as number);
  }
  if (inp.gravity) {
    if (!inp.density) throw new Error('gravity needs a density');
    for (let e = 0; e < nElem; e++) {
      const w = inp.density * 9.81e-6 * (evol[e] as number); // N for this element
      for (let a = 0; a < 8; a++) {
        const node = conn[e * 8 + a] as number;
        f[node * 3 + 2] = (f[node * 3 + 2] as number) - w / 8;
      }
      applied[2] -= w;
    }
  }
  if (!f.some((v) => v !== 0)) throw new Error('No loads: add a load or turn on gravity');

  const Ke = el.Ke;

  // operator and Jacobi preconditioner
  const diag = new Float64Array(ndof);
  for (let e = 0; e < nElem; e++) {
    const di = distIdx[e] as number;
    const KK = di >= 0 ? distKe : Ke;
    const oo = di >= 0 ? di * 576 : 0;
    for (let a = 0; a < 8; a++)
      for (let d = 0; d < 3; d++) {
        const dof = (conn[e * 8 + a] as number) * 3 + d;
        diag[dof] = (diag[dof] as number) + (KK[oo + (a * 3 + d) * 24 + a * 3 + d] as number);
      }
  }
  const pe = new Float64Array(24);
  const apply = (x: Float64Array, y: Float64Array) => {
    y.fill(0);
    for (let e = 0; e < nElem; e++) {
      const base = e * 8;
      const di = distIdx[e] as number;
      const KK = di >= 0 ? distKe : Ke;
      const oo = di >= 0 ? di * 576 : 0;
      for (let a = 0; a < 8; a++) {
        const node = (conn[base + a] as number) * 3;
        pe[a * 3] = x[node] as number;
        pe[a * 3 + 1] = x[node + 1] as number;
        pe[a * 3 + 2] = x[node + 2] as number;
      }
      for (let r = 0; r < 24; r++) {
        let v = 0;
        const row = oo + r * 24;
        for (let c = 0; c < 24; c++) v += (KK[row + c] as number) * (pe[c] as number);
        const dof = (conn[base + ((r / 3) | 0)] as number) * 3 + (r % 3);
        y[dof] = (y[dof] as number) + v;
      }
    }
  };
  const project = (v: Float64Array) => {
    for (let i = 0; i < ndof; i++) if (fixed[i]) v[i] = 0;
  };

  const u = new Float64Array(ndof);
  const r = new Float64Array(ndof);
  const z = new Float64Array(ndof);
  const pv = new Float64Array(ndof);
  const q = new Float64Array(ndof);
  for (let i = 0; i < ndof; i++) r[i] = fixed[i] ? 0 : (f[i] as number);
  let bsum = 0;
  for (let i = 0; i < ndof; i++) bsum += (r[i] as number) ** 2;
  const bnorm = Math.sqrt(bsum) || 1;
  const prec = (a: Float64Array, b: Float64Array) => {
    for (let i = 0; i < ndof; i++) b[i] = fixed[i] ? 0 : (a[i] as number) / (diag[i] as number);
  };
  prec(r, z);
  pv.set(z);
  let rz = 0;
  for (let i = 0; i < ndof; i++) rz += (r[i] as number) * (z[i] as number);
  const tol = inp.tolerance ?? 1e-7;
  const maxIt = inp.maxIterations ?? 6000;
  let it = 0;
  let rel = 1;
  for (; it < maxIt; it++) {
    apply(pv, q);
    project(q);
    let pq = 0;
    for (let i = 0; i < ndof; i++) pq += (pv[i] as number) * (q[i] as number);
    if (!(pq > 0)) {
      warnings.push(
        'The stiffness operator is not positive definite along the search direction: the part is probably not fully supported (it can rotate or slide). Add or enlarge supports.',
      );
      break;
    }
    const alpha = rz / pq;
    let rn = 0;
    for (let i = 0; i < ndof; i++) {
      u[i] = (u[i] as number) + alpha * (pv[i] as number);
      r[i] = (r[i] as number) - alpha * (q[i] as number);
      rn += (r[i] as number) ** 2;
    }
    rel = Math.sqrt(rn) / bnorm;
    if (rel < tol) {
      it++;
      break;
    }
    prec(r, z);
    let rzNew = 0;
    for (let i = 0; i < ndof; i++) rzNew += (r[i] as number) * (z[i] as number);
    const beta = rzNew / rz;
    rz = rzNew;
    for (let i = 0; i < ndof; i++) pv[i] = (z[i] as number) + beta * (pv[i] as number);
  }
  const converged = rel < Math.max(tol, 1e-5);
  if (!converged)
    warnings.push(
      `The solver stopped at relative residual ${rel.toExponential(2)} after ${it} iterations: the result may be inaccurate. Use a larger elementSize or check the supports.`,
    );

  // reactions and equilibrium
  const Ku = new Float64Array(ndof);
  apply(u, Ku);
  const reaction: V3 = [0, 0, 0];
  for (let i = 0; i < ndof; i++)
    if (fixed[i])
      reaction[i % 3] = (reaction[i % 3] as number) + ((Ku[i] as number) - (f[i] as number));
  const eqErr = Math.hypot(
    (applied[0] as number) + (reaction[0] as number),
    (applied[1] as number) + (reaction[1] as number),
    (applied[2] as number) + (reaction[2] as number),
  );
  let energy = 0;
  for (let i = 0; i < ndof; i++) energy += (u[i] as number) * (f[i] as number);
  energy *= 0.5 / 1000; // N*mm -> J

  // stress recovery at the 8 Gauss points, averaged per element
  const vm = new Float64Array(nElem);
  const ue = new Float64Array(24);
  const xeTmp = new Float64Array(24);
  const sigGp = new Float64Array(48);
  const nodeSig = new Float64Array(nNodes * 6);
  const nodeCnt = new Float64Array(nNodes);
  const gatherInto = (e: number) => {
    gatherXe(e, xeTmp);
    return xeTmp;
  };
  const alpha9 = new Float64Array(9);
  const eps = new Float64Array(6);
  const sig = new Float64Array(6);
  for (let e = 0; e < nElem; e++) {
    for (let a = 0; a < 8; a++) {
      const node = (conn[e * 8 + a] as number) * 3;
      ue[a * 3] = u[node] as number;
      ue[a * 3 + 1] = u[node + 1] as number;
      ue[a * 3 + 2] = u[node + 2] as number;
    }
    const hbE = (distIdx[e] as number) >= 0 ? buildHex(gatherInto(e), el.D) : undefined;
    const Rm = hbE ? hbE.R : el.R;
    const Bm = hbE ? hbE.B : el.B;
    const Gm = hbE ? hbE.G : el.G;
    for (let i = 0; i < 9; i++) {
      let v = 0;
      for (let c = 0; c < 24; c++) v += (Rm[i * 24 + c] as number) * (ue[c] as number);
      alpha9[i] = v;
    }
    let sum = 0;
    for (let gp = 0; gp < 8; gp++) {
      const B = Bm[gp] as Float64Array;
      const G = Gm[gp] as Float64Array;
      for (let i = 0; i < 6; i++) {
        let v = 0;
        for (let c = 0; c < 24; c++) v += (B[i * 24 + c] as number) * (ue[c] as number);
        for (let c = 0; c < 9; c++) v += (G[i * 9 + c] as number) * (alpha9[c] as number);
        eps[i] = v;
      }
      for (let i = 0; i < 6; i++) {
        let v = 0;
        for (let c = 0; c < 6; c++) v += (el.D[i * 6 + c] as number) * (eps[c] as number);
        sig[i] = v;
      }
      sigGp.set(sig, gp * 6);
      const [sx, sy, sz, txy, tyz, txz] = sig as unknown as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      sum += Math.sqrt(
        0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) +
          3 * (txy ** 2 + tyz ** 2 + txz ** 2),
      );
    }
    vm[e] = sum / 8;
    // extrapolate the Gauss-point stresses to the 8 nodes (linear through the points at +-1/sqrt 3) and accumulate
    for (let a = 0; a < 8; a++) {
      const sg = SIGNS[a] as [number, number, number];
      const node = conn[e * 8 + a] as number;
      for (let gp = 0; gp < 8; gp++) {
        // Gauss point order: x fastest, then y, then z, each -1/sqrt 3 then +1/sqrt 3
        const gx = gp & 1 ? 1 : -1;
        const gy = gp & 2 ? 1 : -1;
        const gz = gp & 4 ? 1 : -1;
        const wgt =
          ((1 + sg[0] * gx * Math.sqrt(3)) / 2) *
          ((1 + sg[1] * gy * Math.sqrt(3)) / 2) *
          ((1 + sg[2] * gz * Math.sqrt(3)) / 2);
        for (let c = 0; c < 6; c++)
          nodeSig[node * 6 + c] =
            (nodeSig[node * 6 + c] as number) + wgt * (sigGp[gp * 6 + c] as number);
      }
      nodeCnt[node] = (nodeCnt[node] as number) + 1;
    }
  }

  const sorted = Float64Array.from(vm).sort();
  const at = (p: number) => sorted[Math.min(nElem - 1, Math.floor(p * (nElem - 1)))] as number;
  let peakE = 0;
  for (let e = 1; e < nElem; e++) if ((vm[e] as number) > (vm[peakE] as number)) peakE = e;
  // nodal (extrapolated, averaged) von Mises: reads surface stress without the half-element offset of Gauss points
  let peakNode = 0;
  let peakNodal = 0;
  for (let a = 0; a < nNodes; a++) {
    const cnt = nodeCnt[a] as number;
    if (!cnt) continue;
    const sg = [0, 1, 2, 3, 4, 5].map((c) => (nodeSig[a * 6 + c] as number) / cnt);
    const [sx, sy, sz, txy, tyz, txz] = sg as [number, number, number, number, number, number];
    const v = Math.sqrt(
      0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) +
        3 * (txy ** 2 + tyz ** 2 + txz ** 2),
    );
    if (v > peakNodal) {
      peakNodal = v;
      peakNode = a;
    }
  }
  const nodeData = new Float64Array(nNodes * 6);
  let maxU = 0;
  let maxUAt: V3 = [0, 0, 0];
  for (let a = 0; a < nNodes; a++) {
    const c: V3 = [xyz[a * 3] as number, xyz[a * 3 + 1] as number, xyz[a * 3 + 2] as number];
    nodeData.set(
      [c[0], c[1], c[2], u[a * 3] as number, u[a * 3 + 1] as number, u[a * 3 + 2] as number],
      a * 6,
    );
    const m = Math.hypot(u[a * 3] as number, u[a * 3 + 1] as number, u[a * 3 + 2] as number);
    if (m > maxU) {
      maxU = m;
      maxUAt = c;
    }
  }
  const peak = peakNodal;
  const peakElement = vm[peakE] as number;
  const p99 = at(0.99);
  return {
    elements: nElem,
    nodes: nNodes,
    dofs: ndof,
    elementSizeMm: Math.round(hmax * 1e4) / 1e4,
    grid: n,
    fitted: fitOn,
    snappedNodes,
    relaxedNodes,
    minJacobianRatio: minJ,
    volumeRatio: voxelVolume / Math.abs(measureVolume(inp.shape.clone())),
    iterations: it,
    converged,
    relativeResidual: rel,
    maxDisplacement: { value: maxU, at: maxUAt },
    maxVonMises: {
      value: peak,
      at: [
        xyz[peakNode * 3] as number,
        xyz[peakNode * 3 + 1] as number,
        xyz[peakNode * 3 + 2] as number,
      ],
    },
    peakElementVonMises: peakElement,
    p99VonMises: p99,
    medianVonMises: at(0.5),
    ...(inp.yield ? { safetyFactorPeak: inp.yield / peak, safetyFactorP99: inp.yield / p99 } : {}),
    reaction,
    equilibriumErrorN: eqErr,
    strainEnergyJ: energy,
    elementCenters: centers,
    elementVonMises: vm,
    nodeData,
    warnings,
  };
}

/**
 * A sensible grid size for a body: about 12k elements, at least 4 across the thinnest direction, never more than
 * about 40k elements. Shared by the solid_fea tool and the solid_fea spec so both mesh the same way.
 */
export function defaultSolidElementSize(volume: number, bboxSize: readonly number[]): number {
  const minDim = Math.min(...bboxSize.filter((x) => x > 1e-6));
  let h = Math.min(Math.cbrt(volume / 12000), minDim / 4);
  while (volume / h ** 3 > 40000) h *= 1.1;
  return Math.round(h * 1000) / 1000;
}
