// 3D frame finite-element analysis: Euler-Bernoulli beam elements with 6 degrees of freedom per node, static solve
// (nodal loads, member distributed loads, gravity) and modal frequencies (consistent mass). Units: mm, N, MPa, tonne
// (so density g/cm3 x 1e-9 = tonne/mm3 and frequencies come out in Hz).
//
// Honest scope: slender prismatic members, linear elastic, small deflections, rigid joints. It is NOT a solid/shell
// FEA: stress concentrations at holes, fillets and joints are not captured. Validated in tests against closed-form
// beam results.
import type { V3 } from './path.ts';

export const DOFS = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const;
export type Dof = (typeof DOFS)[number];

export interface FrameMember {
  id: string;
  a: string;
  b: string;
  E: number; // MPa
  G?: number; // MPa, default E / 2.6 (Poisson 0.3)
  A: number; // mm2
  /** second moment about the member's local y axis (bending that deflects along local z), mm4 */
  Iy: number;
  /** second moment about local z (bending that deflects along local y), mm4 */
  Iz: number;
  /** torsion constant, mm4 */
  J: number;
  /** distance from the neutral axes to the extreme fibres: along local z (for Iy bending) and local y (for Iz) */
  cz: number;
  cy: number;
  /** density g/cm3 (needed for modes and gravity) */
  density?: number;
  yield?: number; // MPa
  /** rotate the local y/z axes about the member axis, degrees */
  rollDeg?: number;
  /** distributed load in GLOBAL axes, N/mm along the member length */
  w?: V3;
}

export interface FrameSupport {
  node: string;
  fix: Dof[];
}
export interface FrameNodalLoad {
  node: string;
  force?: V3; // N
  moment?: V3; // N*mm
}
export interface FrameInput {
  nodes: Record<string, V3>;
  members: FrameMember[];
  supports: FrameSupport[];
  loads?: FrameNodalLoad[];
  /** add each member's own weight as a distributed load along -Z (needs density) */
  gravity?: boolean;
}

export interface MemberForces {
  id: string;
  length: number;
  /** end forces on the member in LOCAL axes: [N, Vy, Vz, T, My, Mz] at each end */
  end1: number[];
  end2: number[];
  maxAxial: number;
  maxShear: number;
  maxMomentY: number;
  maxMomentZ: number;
  maxTorque: number;
  /** worst combined normal stress |N|/A + |My| cz/Iy + |Mz| cy/Iz along the member, MPa */
  maxStress: number;
  safetyFactor?: number;
}

export interface FrameResult {
  displacements: Record<string, number[]>;
  maxDisplacement: { node: string; value: number };
  reactions: Record<string, number[]>;
  members: MemberForces[];
  worstMember?: { id: string; maxStress: number; safetyFactor?: number };
  /** sum of applied forces plus reactions: should be ~0 */
  equilibriumErrorN: number;
  totalMassTonne?: number;
  notes: string[];
}

const MAX_NODES = 150;

// ---- dense linear algebra ------------------------------------------------------------------------------------------

type Mat = number[][];
const zeros = (n: number, m = n): Mat =>
  Array.from({ length: n }, () => new Array<number>(m).fill(0));

/** Gaussian elimination with partial pivoting on a copy. Throws if the system is singular. */
function solve(Ain: Mat, bin: number[]): number[] {
  const n = bin.length;
  const A = Ain.map((r) => r.slice());
  const b = bin.slice();
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(A[i]?.[i] ?? 0));
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(A[i]?.[k] ?? 0) > Math.abs(A[p]?.[k] ?? 0)) p = i;
    if (Math.abs(A[p]?.[k] ?? 0) < 1e-12 * scale) throw new Error('UNSTABLE');
    [A[k], A[p]] = [A[p] as number[], A[k] as number[]];
    [b[k], b[p]] = [b[p] as number, b[k] as number];
    const rk = A[k] as number[];
    const d = rk[k] as number;
    for (let i = k + 1; i < n; i++) {
      const ri = A[i] as number[];
      const f = (ri[k] as number) / d;
      if (f === 0) continue;
      for (let j = k; j < n; j++) ri[j] = (ri[j] as number) - f * (rk[j] as number);
      b[i] = (b[i] as number) - f * (b[k] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    const ri = A[i] as number[];
    let s = b[i] as number;
    for (let j = i + 1; j < n; j++) s -= (ri[j] as number) * (x[j] as number);
    x[i] = s / (ri[i] as number);
  }
  return x;
}

function cholesky(A: Mat): Mat {
  const n = A.length;
  const L = zeros(n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = (A[i] as number[])[j] as number;
      for (let k = 0; k < j; k++)
        s -= ((L[i] as number[])[k] as number) * ((L[j] as number[])[k] as number);
      if (i === j) {
        if (s <= 0) throw new Error('MASS_NOT_PD');
        (L[i] as number[])[j] = Math.sqrt(s);
      } else (L[i] as number[])[j] = s / ((L[j] as number[])[j] as number);
    }
  return L;
}

/** Eigenvalues of a symmetric matrix by cyclic Jacobi rotations. */
function jacobiEigenvalues(Ain: Mat): number[] {
  const n = Ain.length;
  const A = Ain.map((r) => r.slice());
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) off += ((A[i] as number[])[j] as number) ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = (A[p] as number[])[q] as number;
        if (Math.abs(apq) < 1e-300) continue;
        const app = (A[p] as number[])[p] as number;
        const aqq = (A[q] as number[])[q] as number;
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = (A[k] as number[])[p] as number;
          const akq = (A[k] as number[])[q] as number;
          (A[k] as number[])[p] = c * akp - s * akq;
          (A[k] as number[])[q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = (A[p] as number[])[k] as number;
          const aqk = (A[q] as number[])[k] as number;
          (A[p] as number[])[k] = c * apk - s * aqk;
          (A[q] as number[])[k] = s * apk + c * aqk;
        }
      }
  }
  return A.map((r, i) => r[i] as number);
}

// ---- element matrices ----------------------------------------------------------------------------------------------

function localAxes(a: V3, b: V3, rollDeg = 0) {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(...d);
  if (!(L > 1e-9)) throw new Error('has zero length');
  const ex: V3 = [d[0] / L, d[1] / L, d[2] / L];
  // local z points "up": global Z for ordinary members, global X for members that are (nearly) vertical
  const ref: V3 = Math.abs(ex[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
  const dot = ref[0] * ex[0] + ref[1] * ex[1] + ref[2] * ex[2];
  let ez: V3 = [ref[0] - dot * ex[0], ref[1] - dot * ex[1], ref[2] - dot * ex[2]];
  const nz = Math.hypot(...ez);
  ez = [ez[0] / nz, ez[1] / nz, ez[2] / nz];
  let ey: V3 = [
    ez[1] * ex[2] - ez[2] * ex[1],
    ez[2] * ex[0] - ez[0] * ex[2],
    ez[0] * ex[1] - ez[1] * ex[0],
  ];
  if (rollDeg) {
    const c = Math.cos((rollDeg * Math.PI) / 180);
    const s = Math.sin((rollDeg * Math.PI) / 180);
    const ey2: V3 = [c * ey[0] + s * ez[0], c * ey[1] + s * ez[1], c * ey[2] + s * ez[2]];
    const ez2: V3 = [-s * ey[0] + c * ez[0], -s * ey[1] + c * ez[1], -s * ey[2] + c * ez[2]];
    ey = ey2;
    ez = ez2;
  }
  return { L, ex, ey, ez };
}

function transform12(ex: V3, ey: V3, ez: V3): Mat {
  const T = zeros(12);
  const rows = [ex, ey, ez];
  for (let blk = 0; blk < 4; blk++)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        (T[blk * 3 + i] as number[])[blk * 3 + j] = (rows[i] as V3)[j] as number;
  return T;
}

function localStiffness(m: FrameMember, L: number): Mat {
  const k = zeros(12);
  const G = m.G ?? m.E / 2.6;
  const set = (i: number, j: number, v: number) => {
    (k[i] as number[])[j] = v;
  };
  const EA = (m.E * m.A) / L;
  set(0, 0, EA);
  set(0, 6, -EA);
  set(6, 0, -EA);
  set(6, 6, EA);
  const GJ = (G * m.J) / L;
  set(3, 3, GJ);
  set(3, 9, -GJ);
  set(9, 3, -GJ);
  set(9, 9, GJ);
  // bending in the local x-y plane (dofs v1 th_z1 v2 th_z2 = 1, 5, 7, 11), stiffness E Iz
  const cz = (m.E * m.Iz) / L ** 3;
  const xy = [
    [12, 6 * L, -12, 6 * L],
    [6 * L, 4 * L * L, -6 * L, 2 * L * L],
    [-12, -6 * L, 12, -6 * L],
    [6 * L, 2 * L * L, -6 * L, 4 * L * L],
  ];
  const ixy = [1, 5, 7, 11];
  // bending in the local x-z plane (dofs w1 th_y1 w2 th_y2 = 2, 4, 8, 10), stiffness E Iy; th_y = -dw/dx flips coupling signs
  const cy = (m.E * m.Iy) / L ** 3;
  const xz = [
    [12, -6 * L, -12, -6 * L],
    [-6 * L, 4 * L * L, 6 * L, 2 * L * L],
    [-12, 6 * L, 12, 6 * L],
    [-6 * L, 2 * L * L, 6 * L, 4 * L * L],
  ];
  const ixz = [2, 4, 8, 10];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      set(ixy[i] as number, ixy[j] as number, cz * ((xy[i] as number[])[j] as number));
      set(ixz[i] as number, ixz[j] as number, cy * ((xz[i] as number[])[j] as number));
    }
  return k;
}

function localMass(m: FrameMember, L: number): Mat {
  const rho = (m.density ?? 0) * 1e-9; // tonne/mm3
  const mm = zeros(12);
  const set = (i: number, j: number, v: number) => {
    (mm[i] as number[])[j] = v;
  };
  const ax = (rho * m.A * L) / 6;
  set(0, 0, 2 * ax);
  set(0, 6, ax);
  set(6, 0, ax);
  set(6, 6, 2 * ax);
  const tq = (rho * (m.Iy + m.Iz) * L) / 6; // polar mass moment per unit length: rho x polar second moment
  set(3, 3, 2 * tq);
  set(3, 9, tq);
  set(9, 3, tq);
  set(9, 9, 2 * tq);
  const c = (rho * m.A * L) / 420;
  const xy = [
    [156, 22 * L, 54, -13 * L],
    [22 * L, 4 * L * L, 13 * L, -3 * L * L],
    [54, 13 * L, 156, -22 * L],
    [-13 * L, -3 * L * L, -22 * L, 4 * L * L],
  ];
  const xz = [
    [156, -22 * L, 54, 13 * L],
    [-22 * L, 4 * L * L, -13 * L, -3 * L * L],
    [54, -13 * L, 156, 22 * L],
    [13 * L, -3 * L * L, 22 * L, 4 * L * L],
  ];
  const ixy = [1, 5, 7, 11];
  const ixz = [2, 4, 8, 10];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      set(ixy[i] as number, ixy[j] as number, c * ((xy[i] as number[])[j] as number));
      set(ixz[i] as number, ixz[j] as number, c * ((xz[i] as number[])[j] as number));
    }
  return mm;
}

/** Equivalent nodal load vector (local axes) for a uniform load q = [qx, qy, qz] N/mm. */
function equivalentLoads(q: V3, L: number): number[] {
  const f = new Array<number>(12).fill(0);
  f[0] = (q[0] * L) / 2;
  f[6] = (q[0] * L) / 2;
  f[1] = (q[1] * L) / 2;
  f[7] = (q[1] * L) / 2;
  f[5] = (q[1] * L * L) / 12;
  f[11] = -(q[1] * L * L) / 12;
  f[2] = (q[2] * L) / 2;
  f[8] = (q[2] * L) / 2;
  f[4] = -(q[2] * L * L) / 12;
  f[10] = (q[2] * L * L) / 12;
  return f;
}

const addTo = (A: Mat, i: number, j: number, v: number) => {
  const row = A[i] as number[];
  row[j] = (row[j] as number) + v;
};
const mulMV = (A: Mat, x: number[]) =>
  A.map((r) => r.reduce((s, v, j) => s + v * (x[j] as number), 0));
const transpose = (A: Mat): Mat => (A[0] as number[]).map((_, j) => A.map((r) => r[j] as number));

// ---- model assembly ------------------------------------------------------------------------------------------------

interface Prepared {
  nodeIds: string[];
  index: Map<string, number>;
  elems: {
    m: FrameMember;
    L: number;
    T: Mat;
    kl: Mat;
    dofs: number[];
    fEqLocal: number[];
    q: V3;
    ey: V3;
  }[];
  fixed: boolean[];
  ndof: number;
}

function prepare(inp: FrameInput): Prepared {
  const nodeIds = Object.keys(inp.nodes);
  if (nodeIds.length < 2) throw new Error('A frame needs at least two nodes');
  if (nodeIds.length > MAX_NODES)
    throw new Error(`${nodeIds.length} nodes is too many for the dense solver (max ${MAX_NODES})`);
  if (inp.members.length === 0) throw new Error('A frame needs at least one member');
  const index = new Map(nodeIds.map((id, i) => [id, i]));
  const ids = new Set<string>();
  const elems: Prepared['elems'] = [];
  for (const m of inp.members) {
    if (ids.has(m.id)) throw new Error(`Duplicate member id "${m.id}"`);
    ids.add(m.id);
    const ia = index.get(m.a);
    const ib = index.get(m.b);
    if (ia === undefined) throw new Error(`Member "${m.id}" uses unknown node "${m.a}"`);
    if (ib === undefined) throw new Error(`Member "${m.id}" uses unknown node "${m.b}"`);
    if (ia === ib) throw new Error(`Member "${m.id}" connects node "${m.a}" to itself`);
    for (const k of ['E', 'A', 'Iy', 'Iz', 'J'] as const)
      if (!(m[k] > 0)) throw new Error(`Member "${m.id}": ${k} must be positive`);
    let ax: ReturnType<typeof localAxes>;
    try {
      ax = localAxes(inp.nodes[m.a] as V3, inp.nodes[m.b] as V3, m.rollDeg);
    } catch (e) {
      throw new Error(`Member "${m.id}" ${e instanceof Error ? e.message : String(e)}`);
    }
    const T = transform12(ax.ex, ax.ey, ax.ez);
    // member load in global axes -> local components
    const w: V3 = [...(m.w ?? [0, 0, 0])] as V3;
    if (inp.gravity) {
      if (!m.density) throw new Error(`Member "${m.id}" needs a density for gravity`);
      w[2] -= m.density * 1e-6 * m.A * 9.81;
    }
    const q: V3 = [
      w[0] * ax.ex[0] + w[1] * ax.ex[1] + w[2] * ax.ex[2],
      w[0] * ax.ey[0] + w[1] * ax.ey[1] + w[2] * ax.ey[2],
      w[0] * ax.ez[0] + w[1] * ax.ez[1] + w[2] * ax.ez[2],
    ];
    const dofs = [
      ...Array.from({ length: 6 }, (_, i) => ia * 6 + i),
      ...Array.from({ length: 6 }, (_, i) => ib * 6 + i),
    ];
    elems.push({
      m,
      L: ax.L,
      T,
      kl: localStiffness(m, ax.L),
      dofs,
      fEqLocal: equivalentLoads(q, ax.L),
      q,
      ey: ax.ey,
    });
  }
  const ndof = nodeIds.length * 6;
  const fixed = new Array<boolean>(ndof).fill(false);
  for (const s of inp.supports) {
    const i = index.get(s.node);
    if (i === undefined) throw new Error(`Support on unknown node "${s.node}"`);
    for (const d of s.fix) fixed[i * 6 + DOFS.indexOf(d)] = true;
  }
  if (!fixed.some(Boolean))
    throw new Error('No supports: the frame is free to fly away. Fix at least one node');
  return { nodeIds, index, elems, fixed, ndof };
}

function assembleK(p: Prepared): Mat {
  const K = zeros(p.ndof);
  for (const e of p.elems) {
    const kg = mulMM(transpose(e.T), mulMM(e.kl, e.T));
    for (let i = 0; i < 12; i++)
      for (let j = 0; j < 12; j++)
        addTo(K, e.dofs[i] as number, e.dofs[j] as number, (kg[i] as number[])[j] as number);
  }
  return K;
}

function mulMM(A: Mat, B: Mat): Mat {
  const n = A.length;
  const m = (B[0] as number[]).length;
  const C = zeros(n, m);
  for (let i = 0; i < n; i++) {
    const Ai = A[i] as number[];
    const Ci = C[i] as number[];
    for (let k = 0; k < Ai.length; k++) {
      const a = Ai[k] as number;
      if (a === 0) continue;
      const Bk = B[k] as number[];
      for (let j = 0; j < m; j++) Ci[j] = (Ci[j] as number) + a * (Bk[j] as number);
    }
  }
  return C;
}

// ---- static analysis -----------------------------------------------------------------------------------------------

export function analyzeFrame(inp: FrameInput): FrameResult {
  const p = prepare(inp);
  const K = assembleK(p);
  const F = new Array<number>(p.ndof).fill(0);
  for (const l of inp.loads ?? []) {
    const i = p.index.get(l.node);
    if (i === undefined) throw new Error(`Load on unknown node "${l.node}"`);
    (l.force ?? [0, 0, 0]).forEach((v, k) => {
      F[i * 6 + k] = (F[i * 6 + k] as number) + v;
    });
    (l.moment ?? [0, 0, 0]).forEach((v, k) => {
      F[i * 6 + 3 + k] = (F[i * 6 + 3 + k] as number) + v;
    });
  }
  // member loads -> global nodal loads
  for (const e of p.elems) {
    const g = mulMV(transpose(e.T), e.fEqLocal);
    e.dofs.forEach((d, i) => {
      F[d] = (F[d] as number) + (g[i] as number);
    });
  }
  const free = p.fixed.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
  let uFree: number[];
  try {
    uFree = solve(
      free.map((i) => free.map((j) => (K[i] as number[])[j] as number)),
      free.map((i) => F[i] as number),
    );
  } catch (e) {
    if (e instanceof Error && e.message === 'UNSTABLE')
      throw new Error(
        'The structure is unstable (a mechanism or under-supported): add supports or members, or fix more degrees of freedom. A pinned joint needs at least one rotation fixed somewhere along the chain.',
      );
    throw e;
  }
  const u = new Array<number>(p.ndof).fill(0);
  free.forEach((d, i) => {
    u[d] = uFree[i] as number;
  });
  const Ku = mulMV(K, u);
  const notes: string[] = [];

  const displacements: Record<string, number[]> = {};
  let maxD = { node: p.nodeIds[0] as string, value: 0 };
  p.nodeIds.forEach((id, i) => {
    const d = u.slice(i * 6, i * 6 + 6);
    displacements[id] = d.map((x) => x);
    const mag = Math.hypot(d[0] as number, d[1] as number, d[2] as number);
    if (mag > maxD.value) maxD = { node: id, value: mag };
  });

  const reactions: Record<string, number[]> = {};
  const sum = [0, 0, 0];
  p.nodeIds.forEach((id, i) => {
    const r = [0, 0, 0, 0, 0, 0];
    let any = false;
    for (let k = 0; k < 6; k++)
      if (p.fixed[i * 6 + k]) {
        r[k] = (Ku[i * 6 + k] as number) - (F[i * 6 + k] as number);
        any = true;
      }
    if (any) {
      reactions[id] = r;
      sum[0] = (sum[0] as number) + (r[0] as number);
      sum[1] = (sum[1] as number) + (r[1] as number);
      sum[2] = (sum[2] as number) + (r[2] as number);
    }
  });
  // applied force total (nodal + member loads, global forces only)
  const applied = [0, 0, 0];
  p.nodeIds.forEach((_id, i) => {
    for (let k = 0; k < 3; k++) applied[k] = (applied[k] as number) + (F[i * 6 + k] as number);
  });
  const eq = Math.hypot(
    (sum[0] as number) + (applied[0] as number),
    (sum[1] as number) + (applied[1] as number),
    (sum[2] as number) + (applied[2] as number),
  );

  const members: MemberForces[] = p.elems.map((e) => {
    const ug = e.dofs.map((d) => u[d] as number);
    const ul = mulMV(e.T, ug);
    const fl = mulMV(e.kl, ul).map((v, i) => v - (e.fEqLocal[i] as number));
    const end1 = fl.slice(0, 6);
    const end2 = fl.slice(6, 12);
    // internal forces at 21 stations along the member (free body of the part before the section)
    const [F1x, F1y, F1z, M1x, M1y, M1z] = end1 as [number, number, number, number, number, number];
    let maxN = 0;
    let maxV = 0;
    let maxMy = 0;
    let maxMz = 0;
    let maxT = 0;
    let maxS = 0;
    const m = e.m;
    const S = 20;
    for (let s = 0; s <= S; s++) {
      const x = (e.L * s) / S;
      const N = -(F1x + e.q[0] * x);
      const Vy = -(F1y + e.q[1] * x);
      const Vz = -(F1z + e.q[2] * x);
      const T = -M1x;
      const My = -(M1y + x * F1z + (e.q[2] * x * x) / 2);
      const Mz = -(M1z - x * F1y - (e.q[1] * x * x) / 2);
      maxN = Math.max(maxN, Math.abs(N));
      maxV = Math.max(maxV, Math.hypot(Vy, Vz));
      maxMy = Math.max(maxMy, Math.abs(My));
      maxMz = Math.max(maxMz, Math.abs(Mz));
      maxT = Math.max(maxT, Math.abs(T));
      maxS = Math.max(
        maxS,
        Math.abs(N) / m.A + (Math.abs(My) * m.cz) / m.Iy + (Math.abs(Mz) * m.cy) / m.Iz,
      );
    }
    return {
      id: m.id,
      length: e.L,
      end1,
      end2,
      maxAxial: maxN,
      maxShear: maxV,
      maxMomentY: maxMy,
      maxMomentZ: maxMz,
      maxTorque: maxT,
      maxStress: maxS,
      ...(m.yield ? { safetyFactor: m.yield / maxS } : {}),
    };
  });
  const worst = [...members].sort((a, b) => b.maxStress - a.maxStress)[0];
  if (inp.members.some((m) => m.J === m.Iy + m.Iz))
    notes.push(
      'some members use the polar second moment as their torsion constant: exact for round sections, an overestimate of stiffness for others',
    );
  notes.push(
    'Rigid-joint Euler-Bernoulli frame model: member stress is bending plus axial only (no shear stress, no stress concentrations at joints, holes or welds). It is an estimate for sizing, not a certification.',
  );

  const totalMass = inp.members.every((m) => m.density)
    ? p.elems.reduce((s, e) => s + (e.m.density as number) * 1e-9 * e.m.A * e.L, 0)
    : undefined;
  return {
    displacements,
    maxDisplacement: maxD,
    reactions,
    members,
    worstMember: worst
      ? { id: worst.id, maxStress: worst.maxStress, safetyFactor: worst.safetyFactor }
      : undefined,
    equilibriumErrorN: eq,
    totalMassTonne: totalMass,
    notes,
  };
}

// ---- modal analysis ------------------------------------------------------------------------------------------------

export interface ModalResult {
  /** natural frequencies, Hz, lowest first */
  frequencies: number[];
  notes: string[];
}

const MAX_MODAL_DOF = 360;

export function frameModes(inp: FrameInput, count = 5): ModalResult {
  const p = prepare(inp);
  for (const e of p.elems)
    if (!e.m.density) throw new Error(`Member "${e.m.id}" needs a density for modal analysis`);
  const free = p.fixed.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
  if (free.length > MAX_MODAL_DOF)
    throw new Error(
      `${free.length} free degrees of freedom is too many for modal analysis (max ${MAX_MODAL_DOF}): use fewer nodes`,
    );
  const K = assembleK(p);
  const M = zeros(p.ndof);
  for (const e of p.elems) {
    const mg = mulMM(transpose(e.T), mulMM(localMass(e.m, e.L), e.T));
    for (let i = 0; i < 12; i++)
      for (let j = 0; j < 12; j++)
        addTo(M, e.dofs[i] as number, e.dofs[j] as number, (mg[i] as number[])[j] as number);
  }
  const Kf = free.map((i) => free.map((j) => (K[i] as number[])[j] as number));
  const Mf = free.map((i) => free.map((j) => (M[i] as number[])[j] as number));
  let L: Mat;
  try {
    L = cholesky(Mf);
  } catch {
    throw new Error('The mass matrix is singular: every free node needs a member with a density');
  }
  // standard form: A = L^-1 K L^-T, eigenvalues are omega^2
  const n = free.length;
  const Y = zeros(n); // Y = L^-1 K
  for (let c = 0; c < n; c++)
    for (let i = 0; i < n; i++) {
      let s = (Kf[i] as number[])[c] as number;
      for (let k = 0; k < i; k++)
        s -= ((L[i] as number[])[k] as number) * ((Y[k] as number[])[c] as number);
      (Y[i] as number[])[c] = s / ((L[i] as number[])[i] as number);
    }
  const A = zeros(n); // A = Y L^-T  (solve row-wise)
  for (let r = 0; r < n; r++)
    for (let i = 0; i < n; i++) {
      let s = (Y[r] as number[])[i] as number;
      for (let k = 0; k < i; k++)
        s -= ((L[i] as number[])[k] as number) * ((A[r] as number[])[k] as number);
      (A[r] as number[])[i] = s / ((L[i] as number[])[i] as number);
    }
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const v = (((A[i] as number[])[j] as number) + ((A[j] as number[])[i] as number)) / 2;
      (A[i] as number[])[j] = v;
      (A[j] as number[])[i] = v;
    }
  const ev = jacobiEigenvalues(A)
    .filter((x) => x > 1e-6)
    .sort((a, b) => a - b);
  const freqs = ev.slice(0, count).map((w2) => Math.sqrt(w2) / (2 * Math.PI));
  return {
    frequencies: freqs,
    notes: [
      'Frequencies of the frame alone (consistent mass, no added masses, no damping). Torsional and axial modes are included in the list.',
      'Accuracy depends on mesh density: use at least 4 elements per member that can bend, and compare against a refined mesh.',
    ],
  };
}
