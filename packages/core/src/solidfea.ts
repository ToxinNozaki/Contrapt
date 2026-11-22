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
import { buildHex, HEX_SIGNS, hexGaussGradients } from './solidfit.ts';
import { buildSolidMesh, faceArea, faceCorners } from './solidmesh.ts';

export interface SolidRegion {
  /** a world-space box; nodes inside it (within half an element) are selected */
  box?: { min: V3; max: V3 };
  /** or a flat face of the body picked by outward normal (optionally the one nearest `near`) */
  face?: { normal: FaceNormal; near?: V3 };
  /** or a cylindrical surface (a bore, a tube wall): nodes at about this radius from the axis */
  cylinder?: { axis: 'X' | 'Y' | 'Z'; center: V3; radius: number; range?: [number, number] };
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
  /**
   * thermal stress: a temperature at every node (from solveThermal on the same body, elementSize, fit and
   * maxElements, so the node order matches), the expansion coefficient and the stress-free reference temperature
   */
  thermal?: {
    temperatures: Float64Array;
    /** 1/K */
    alpha: number;
    referenceTemperature: number;
  };
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
  KaaInv: Float64Array; // 9 x 9
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
  return { Ke, R, KaaInv, D, B: Bs, G: Gs };
}

// ---- voxelisation --------------------------------------------------------------------------------------------------

/**
 * Nodes picked by a region. Boxes and faces use the regular-grid coordinates; a cylinder uses the final (fitted) node
 * coordinates, so the nodes snapped onto a bore or tube wall sit at its radius.
 */
export function selectNodes(
  region: SolidRegion,
  shape: Shape3D,
  nodeCoord: (idx: number) => V3,
  count: number,
  h: number,
  what: string,
  fittedCoord?: (idx: number) => V3,
): number[] {
  if (region.cylinder) {
    const { axis, center, radius, range } = region.cylinder;
    const ax = { X: 0, Y: 1, Z: 2 }[axis];
    const o = [0, 1, 2].filter((d) => d !== ax) as [number, number];
    const picked: number[] = [];
    for (let i = 0; i < count; i++) {
      const c = (fittedCoord ?? nodeCoord)(i);
      const d = Math.hypot(
        (c[o[0]] as number) - (center[o[0]] as number),
        (c[o[1]] as number) - (center[o[1]] as number),
      );
      if (Math.abs(d - radius) > 0.5 * h) continue;
      if (
        range &&
        ((c[ax] as number) < range[0] - 1e-9 * h || (c[ax] as number) > range[1] + 1e-9 * h)
      )
        continue;
      picked.push(i);
    }
    if (picked.length === 0)
      throw new Error(
        `${what}: no solid nodes lie on that cylinder (check the axis, centre, radius and range against the body)`,
      );
    return picked;
  }
  let min: V3;
  let max: V3;
  const tol = h * 0.51;
  if (region.box) {
    min = region.box.min;
    max = region.box.max;
  } else if (region.face) {
    const f = findFace(shape, region.face.normal, region.face.near);
    // the containment test below adds `tol` on every side once: the slab is the face plane +- tol, not +- 2 tol
    min = [f.min[0], f.min[1], f.min[2]];
    max = [f.max[0], f.max[1], f.max[2]];
    const axis = region.face.normal.endsWith('X') ? 0 : region.face.normal.endsWith('Y') ? 1 : 2;
    min[axis] = f.level;
    max[axis] = f.level;
  } else throw new Error(`${what}: give a "box", "face" or "cylinder" region`);
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
  const maxEl = inp.maxElements ?? DEFAULT_MAX_ELEMENTS;
  let el: ReturnType<typeof buildElement> | undefined;
  const mesh = buildSolidMesh(inp.shape, h, {
    fit: inp.fit ?? true,
    maxElements: maxEl,
    keSize: 576,
    element: (hv) => {
      const built = buildElement(hv, inp.E, nu);
      el = built;
      return (xe) => {
        const hb = buildHex(xe, built.D);
        return { K: hb.Ke, volume: hb.volume };
      };
    },
  });
  if (!el) throw new Error('internal: no element model');
  const elem = el as ReturnType<typeof buildElement>;
  const {
    hmax,
    n,
    nElem,
    nNodes,
    conn,
    xyz,
    centers,
    evol,
    distIdx,
    distK: distKe,
    snappedNodes,
    relaxedNodes,
    minJ,
    coordOf,
    gatherXe,
    warnings,
  } = mesh;
  const ndof = nNodes * 3;
  let voxelVolume = 0;
  for (let e = 0; e < nElem; e++) voxelVolume += evol[e] as number;
  const fitOn = inp.fit ?? true;

  // boundary conditions
  const fixed = new Uint8Array(ndof);
  for (const s of inp.supports) {
    const nodes = selectNodes(s.region, inp.shape, coordOf, nNodes, hmax, 'support', (a) => [
      xyz[a * 3] as number,
      xyz[a * 3 + 1] as number,
      xyz[a * 3 + 2] as number,
    ]);
    const axes = s.dofs ?? ['x', 'y', 'z'];
    for (const a of nodes) for (const ax of axes) fixed[a * 3 + { x: 0, y: 1, z: 2 }[ax]] = 1;
  }
  const f = new Float64Array(ndof);
  const applied: V3 = [0, 0, 0];
  for (const l of inp.loads ?? []) {
    const nodes = selectNodes(l.region, inp.shape, coordOf, nNodes, hmax, 'load', (a) => [
      xyz[a * 3] as number,
      xyz[a * 3 + 1] as number,
      xyz[a * 3 + 2] as number,
    ]);
    // A surface load is spread by tributary face area (corner 1/4 of a cell, edge 1/2, interior 1): the consistent
    // nodal forces of a uniform traction. Equal shares per node would overload corners and skew the end displacement.
    const sel = new Uint8Array(nNodes);
    for (const a of nodes) sel[a] = 1;
    const faces: { c: number[]; area: number }[] = [];
    let totalArea = 0;
    for (const code of mesh.boundaryFaces) {
      const c = faceCorners(mesh, code);
      if (c.every((x) => sel[x])) {
        const area = faceArea(mesh, c);
        faces.push({ c, area });
        totalArea += area;
      }
    }
    if (faces.length > 0 && totalArea > 0) {
      for (const fc of faces)
        for (const c of fc.c)
          for (let d = 0; d < 3; d++)
            f[c * 3 + d] =
              (f[c * 3 + d] as number) + ((l.force[d] as number) * fc.area) / totalArea / 4;
    } else {
      // a region that covers no whole exposed face (a box through the interior, say): share equally between its nodes
      for (const a of nodes)
        for (let d = 0; d < 3; d++)
          f[a * 3 + d] = (f[a * 3 + d] as number) + (l.force[d] as number) / nodes.length;
    }
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
  // thermal stress: equivalent nodal loads of the thermal strain, condensed onto the incompatible modes
  const brickXeRef = new Float64Array(24);
  HEX_SIGNS.forEach((sg, a) => {
    brickXeRef[a * 3] = (sg[0] * mesh.hv[0]) / 2;
    brickXeRef[a * 3 + 1] = (sg[1] * mesh.hv[1]) / 2;
    brickXeRef[a * 3 + 2] = (sg[2] * mesh.hv[2]) / 2;
  });
  const th = inp.thermal;
  const thermalGp: Float64Array[] = []; // per element: 8 temperature-rise values at the Gauss points
  const sigmaTh = (dT: number) => (inp.E * (th?.alpha ?? 0) * dT) / (1 - 2 * nu);
  if (th) {
    if (th.temperatures.length !== nNodes)
      throw new Error(
        'thermal.temperatures does not match this mesh: solve the heat conduction with the same body, elementSize, fit and maxElements',
      );
    const brickXe = new Float64Array(24);
    HEX_SIGNS.forEach((sg, a) => {
      brickXe[a * 3] = (sg[0] * mesh.hv[0]) / 2;
      brickXe[a * 3 + 1] = (sg[1] * mesh.hv[1]) / 2;
      brickXe[a * 3 + 2] = (sg[2] * mesh.hv[2]) / 2;
    });
    const brickG = hexGaussGradients(brickXe);
    const xeL = new Float64Array(24);
    const fu = new Float64Array(24);
    const fa = new Float64Array(9);
    for (let e = 0; e < nElem; e++) {
      const dist = (distIdx[e] as number) >= 0;
      let hb: ReturnType<typeof buildHex> | undefined;
      let gg = brickG;
      if (dist) {
        gatherXe(e, xeL);
        hb = buildHex(xeL, elem.D);
        gg = hexGaussGradients(xeL);
      }
      const Rm = hb ? hb.R : elem.R;
      const Bm = hb ? hb.B : elem.B;
      const Gm = hb ? hb.G : elem.G;
      fu.fill(0);
      fa.fill(0);
      const tg = new Float64Array(8);
      for (let gp = 0; gp < 8; gp++) {
        const g = gg[gp] as (typeof gg)[number];
        let t = 0;
        for (let a = 0; a < 8; a++)
          t += (g.N[a] as number) * (th.temperatures[conn[e * 8 + a] as number] as number);
        const dT = t - th.referenceTemperature;
        tg[gp] = dT;
        const s = sigmaTh(dT) * g.det;
        const B = Bm[gp] as Float64Array;
        const G = Gm[gp] as Float64Array;
        for (let j = 0; j < 24; j++)
          fu[j] =
            (fu[j] as number) +
            s * ((B[j] as number) + (B[24 + j] as number) + (B[48 + j] as number));
        for (let c = 0; c < 9; c++)
          fa[c] =
            (fa[c] as number) +
            s * ((G[c] as number) + (G[9 + c] as number) + (G[18 + c] as number));
      }
      thermalGp.push(tg);
      for (let j = 0; j < 24; j++) {
        let v = fu[j] as number;
        for (let c = 0; c < 9; c++) v += (Rm[c * 24 + j] as number) * (fa[c] as number);
        const node = conn[e * 8 + ((j / 3) | 0)] as number;
        f[node * 3 + (j % 3)] = (f[node * 3 + (j % 3)] as number) + v;
      }
    }
  }
  if (!f.some((v) => v !== 0))
    throw new Error('No loads: add a load, turn on gravity, or give a thermal field');

  const Ke = elem.Ke;

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
    const hbE = (distIdx[e] as number) >= 0 ? buildHex(gatherInto(e), elem.D) : undefined;
    const Rm = hbE ? hbE.R : elem.R;
    const Bm = hbE ? hbE.B : elem.B;
    const Gm = hbE ? hbE.G : elem.G;
    for (let i = 0; i < 9; i++) {
      let v = 0;
      for (let c = 0; c < 24; c++) v += (Rm[i * 24 + c] as number) * (ue[c] as number);
      alpha9[i] = v;
    }
    if (th) {
      // under a thermal load the incompatible amplitudes also carry alpha += Kaa^-1 f_a
      const KI = hbE ? hbE.KaaInv : elem.KaaInv;
      const faE = new Float64Array(9);
      const ggE = hexGaussGradients(distIdx[e] !== -1 ? gatherInto(e) : brickXeRef);
      for (let gp = 0; gp < 8; gp++) {
        const s =
          sigmaTh((thermalGp[e] as Float64Array)[gp] as number) * (ggE[gp] as { det: number }).det;
        const G = Gm[gp] as Float64Array;
        for (let c = 0; c < 9; c++)
          faE[c] =
            (faE[c] as number) +
            s * ((G[c] as number) + (G[9 + c] as number) + (G[18 + c] as number));
      }
      for (let i = 0; i < 9; i++) {
        let v = 0;
        for (let c = 0; c < 9; c++) v += (KI[i * 9 + c] as number) * (faE[c] as number);
        alpha9[i] = (alpha9[i] as number) + v;
      }
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
      if (th) {
        const eth = th.alpha * ((thermalGp[e] as Float64Array)[gp] as number);
        eps[0] = (eps[0] as number) - eth;
        eps[1] = (eps[1] as number) - eth;
        eps[2] = (eps[2] as number) - eth;
      }
      for (let i = 0; i < 6; i++) {
        let v = 0;
        for (let c = 0; c < 6; c++) v += (elem.D[i * 6 + c] as number) * (eps[c] as number);
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
