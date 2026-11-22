// Natural frequencies and mode shapes of a solid on the fitted hexahedral mesh: K x = lambda M x with the elasticity
// stiffness of solid_fea and a lumped mass matrix, solved for the lowest modes by LOBPCG (preconditioned block
// eigensolver, Jacobi preconditioner, matrix-free products). Units: mm, N, MPa, tonne (so Hz come out directly).
import type { Shape3D } from 'replicad';
import { buildElement, type SolidSupport, selectNodes } from './solidfea.ts';
import { buildHex } from './solidfit.ts';
import { buildSolidMesh } from './solidmesh.ts';

export interface SolidModalInput {
  shape: Shape3D;
  E: number; // MPa
  nu?: number;
  /** g/cm3 */
  density: number;
  elementSize: number;
  fit?: boolean;
  maxElements?: number;
  supports: SolidSupport[];
  /** how many modes (default 4) */
  count?: number;
  /** relative residual tolerance (default 1e-5) */
  tolerance?: number;
  maxIterations?: number;
}

export interface SolidModalResult {
  /** Hz, lowest first */
  frequencies: number[];
  /** relative residual of each returned mode */
  residuals: number[];
  /** displacement of every node in each mode, scaled so the largest component is 1: ndof numbers per mode */
  modeShapes: Float64Array[];
  nodeCoords: Float64Array;
  elements: number;
  nodes: number;
  dofs: number;
  elementSizeMm: number;
  fitted: boolean;
  iterations: number;
  converged: boolean;
  /** total mass, g */
  massG: number;
  warnings: string[];
}

type Vec = Float64Array;

/** Symmetric eigen-decomposition by cyclic Jacobi: eigenvalues ascending with their eigenvectors as columns. */
function jacobiSym(A: number[][]): { values: number[]; vectors: number[][] } {
  const n = A.length;
  const a = A.map((r) => r.slice());
  const v = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let sweep = 0; sweep < 80; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) off += ((a[i] as number[])[j] as number) ** 2;
    if (off < 1e-26) break;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = (a[p] as number[])[q] as number;
        if (Math.abs(apq) < 1e-300) continue;
        const theta =
          (((a[q] as number[])[q] as number) - ((a[p] as number[])[p] as number)) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = (a[k] as number[])[p] as number;
          const akq = (a[k] as number[])[q] as number;
          (a[k] as number[])[p] = c * akp - s * akq;
          (a[k] as number[])[q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = (a[p] as number[])[k] as number;
          const aqk = (a[q] as number[])[k] as number;
          (a[p] as number[])[k] = c * apk - s * aqk;
          (a[q] as number[])[k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = (v[k] as number[])[p] as number;
          const vkq = (v[k] as number[])[q] as number;
          (v[k] as number[])[p] = c * vkp - s * vkq;
          (v[k] as number[])[q] = s * vkp + c * vkq;
        }
      }
  }
  const order = [...Array(n).keys()].sort(
    (i, j) => ((a[i] as number[])[i] as number) - ((a[j] as number[])[j] as number),
  );
  return {
    values: order.map((i) => (a[i] as number[])[i] as number),
    vectors: v.map((row) => order.map((i) => row[i] as number)),
  };
}

export function solidModes(inp: SolidModalInput): SolidModalResult {
  const nu = inp.nu ?? 0.3;
  const h = inp.elementSize;
  if (!(h > 0)) throw new Error('elementSize must be positive');
  if (!(inp.E > 0)) throw new Error('E must be positive');
  if (!(inp.density > 0)) throw new Error('density must be positive');
  if (inp.supports.length === 0)
    throw new Error('Add at least one support, or the part has rigid-body modes at zero frequency');
  const count = Math.max(1, Math.min(12, Math.round(inp.count ?? 4)));

  let el: ReturnType<typeof buildElement> | undefined;
  const mesh = buildSolidMesh(inp.shape, h, {
    fit: inp.fit ?? true,
    maxElements: inp.maxElements ?? 30000,
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
  const { nElem, nNodes, conn, xyz, evol, distIdx, distK, hmax, warnings } = mesh;
  const n = nNodes * 3;

  const fixed = new Uint8Array(n);
  const coordFitted = (a: number): [number, number, number] => [
    xyz[a * 3] as number,
    xyz[a * 3 + 1] as number,
    xyz[a * 3 + 2] as number,
  ];
  for (const s of inp.supports) {
    const nodes = selectNodes(
      s.region,
      inp.shape,
      mesh.coordOf,
      nNodes,
      hmax,
      'support',
      coordFitted,
    );
    for (const a of nodes)
      for (const ax of s.dofs ?? ['x', 'y', 'z']) fixed[a * 3 + { x: 0, y: 1, z: 2 }[ax]] = 1;
  }

  // lumped mass: rho V / 8 per node and direction, tonne/mm3 = g/cm3 x 1e-9
  const rho = inp.density * 1e-9;
  const Md = new Float64Array(n);
  let totalMass = 0;
  for (let e = 0; e < nElem; e++) {
    const m = (rho * (evol[e] as number)) / 8;
    totalMass += rho * (evol[e] as number);
    for (let a = 0; a < 8; a++) {
      const node = (conn[e * 8 + a] as number) * 3;
      Md[node] = (Md[node] as number) + m;
      Md[node + 1] = (Md[node + 1] as number) + m;
      Md[node + 2] = (Md[node + 2] as number) + m;
    }
  }
  for (let i = 0; i < n; i++) if (fixed[i]) Md[i] = 1;

  const Kb = elem.Ke;
  const diag = new Float64Array(n);
  for (let e = 0; e < nElem; e++) {
    const di = distIdx[e] as number;
    const KK = di >= 0 ? distK : Kb;
    const oo = di >= 0 ? di * 576 : 0;
    for (let a = 0; a < 8; a++)
      for (let d = 0; d < 3; d++) {
        const dof = (conn[e * 8 + a] as number) * 3 + d;
        diag[dof] = (diag[dof] as number) + (KK[oo + (a * 3 + d) * 24 + a * 3 + d] as number);
      }
  }
  const pe = new Float64Array(24);
  const applyK = (x: Vec, y: Vec) => {
    y.fill(0);
    for (let e = 0; e < nElem; e++) {
      const base = e * 8;
      const di = distIdx[e] as number;
      const KK = di >= 0 ? distK : Kb;
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
    for (let i = 0; i < n; i++) if (fixed[i]) y[i] = 0;
  };

  const dot = (a: Vec, b: Vec) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += (a[i] as number) * (b[i] as number);
    return s;
  };
  const mdot = (a: Vec, b: Vec) => {
    let s = 0;
    for (let i = 0; i < n; i++)
      if (!fixed[i]) s += (a[i] as number) * (Md[i] as number) * (b[i] as number);
    return s;
  };

  // Block inverse (subspace) iteration: Y = K^-1 M X with inexact, warm-started preconditioned CG solves, then
  // Rayleigh-Ritz. More vectors than requested modes speed up the wanted ones. A shifted LOBPCG was tried first: for
  // slender bodies K is so ill-conditioned that a Jacobi preconditioner needs thousands of iterations.
  const freeCount = n - fixed.reduce((sum, x) => sum + x, 0);
  const q = Math.max(1, Math.min(count + 3, freeCount - 1));
  const wanted = Math.min(count, q);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296 - 0.5;
  };
  const tol = inp.tolerance ?? 1e-5;
  const maxIt = inp.maxIterations ?? 60;
  const pcg = (rhs: Vec, x0: Vec, rtol: number, cap: number): Vec => {
    const x = Float64Array.from(x0);
    const r = new Float64Array(n);
    const Kx = new Float64Array(n);
    applyK(x, Kx);
    let bn = 0;
    for (let i = 0; i < n; i++) {
      r[i] = fixed[i] ? 0 : (rhs[i] as number) - (Kx[i] as number);
      bn += (rhs[i] as number) ** 2;
    }
    bn = Math.sqrt(bn) || 1;
    const z = new Float64Array(n);
    const p = new Float64Array(n);
    const Ap = new Float64Array(n);
    for (let i = 0; i < n; i++) z[i] = fixed[i] ? 0 : (r[i] as number) / (diag[i] as number);
    p.set(z);
    let rz = dot(r, z);
    for (let k = 0; k < cap; k++) {
      if (Math.sqrt(dot(r, r)) / bn < rtol) break;
      applyK(p, Ap);
      const pAp = dot(p, Ap);
      if (!(pAp > 0)) break;
      const alpha = rz / pAp;
      for (let i = 0; i < n; i++) {
        x[i] = (x[i] as number) + alpha * (p[i] as number);
        r[i] = (r[i] as number) - alpha * (Ap[i] as number);
      }
      for (let i = 0; i < n; i++) z[i] = fixed[i] ? 0 : (r[i] as number) / (diag[i] as number);
      const rzNew = dot(r, z);
      const beta = rzNew / rz;
      rz = rzNew;
      for (let i = 0; i < n; i++) p[i] = (z[i] as number) + beta * (p[i] as number);
    }
    return x;
  };
  const rayleighRitz = (Y: Vec[], KY: Vec[]) => {
    // M-orthonormalise Y (modified Gram-Schmidt, twice), carrying K Y along
    const Z: Vec[] = [];
    const KZ: Vec[] = [];
    for (let c = 0; c < Y.length; c++) {
      const v = Float64Array.from(Y[c] as Vec);
      const kv = Float64Array.from(KY[c] as Vec);
      const n0 = Math.sqrt(mdot(v, v));
      for (let pass = 0; pass < 2; pass++)
        for (let k = 0; k < Z.length; k++) {
          const zk = Z[k] as Vec;
          const kz = KZ[k] as Vec;
          const proj = mdot(v, zk);
          for (let i = 0; i < n; i++) {
            v[i] = (v[i] as number) - proj * (zk[i] as number);
            kv[i] = (kv[i] as number) - proj * (kz[i] as number);
          }
        }
      const nr = Math.sqrt(mdot(v, v));
      if (!(nr > 1e-9 * n0)) continue;
      for (let i = 0; i < n; i++) {
        v[i] = (v[i] as number) / nr;
        kv[i] = (kv[i] as number) / nr;
      }
      Z.push(v);
      KZ.push(kv);
    }
    const s2 = Z.length;
    const A = Array.from({ length: s2 }, (_, i) =>
      Array.from({ length: s2 }, (_, j) => dot(Z[i] as Vec, KZ[j] as Vec)),
    );
    for (let i = 0; i < s2; i++)
      for (let j = i + 1; j < s2; j++) {
        const sym = (((A[i] as number[])[j] as number) + ((A[j] as number[])[i] as number)) / 2;
        (A[i] as number[])[j] = sym;
        (A[j] as number[])[i] = sym;
      }
    const e = jacobiSym(A);
    const nx: Vec[] = [];
    const nkx: Vec[] = [];
    for (let c = 0; c < s2; c++) {
      const v = new Float64Array(n);
      const kv = new Float64Array(n);
      for (let k = 0; k < s2; k++) {
        const w = (e.vectors[k] as number[])[c] as number;
        const zk = Z[k] as Vec;
        const kz = KZ[k] as Vec;
        for (let i = 0; i < n; i++) {
          v[i] = (v[i] as number) + w * (zk[i] as number);
          kv[i] = (kv[i] as number) + w * (kz[i] as number);
        }
      }
      nx.push(v);
      nkx.push(kv);
    }
    return { X: nx, KX: nkx, values: e.values };
  };

  let lambda: number[] = [];
  // start block: deterministic noise, then one Rayleigh-Ritz
  let X: Vec[] = [];
  let KXs: Vec[] = [];
  {
    const Y: Vec[] = [];
    const KY: Vec[] = [];
    for (let c = 0; c < q; c++) {
      const v = new Float64Array(n);
      for (let i = 0; i < n; i++) if (!fixed[i]) v[i] = rnd();
      const kv = new Float64Array(n);
      applyK(v, kv);
      Y.push(v);
      KY.push(kv);
    }
    const rr = rayleighRitz(Y, KY);
    X = rr.X;
    KXs = rr.KX;
    lambda = rr.values;
  }
  let it = 0;
  let converged = false;
  let res = new Array<number>(X.length).fill(1);
  for (; it < maxIt; it++) {
    for (let c = 0; c < wanted; c++) {
      const xc = X[c] as Vec;
      const kc = KXs[c] as Vec;
      let rn = 0;
      let kn = 0;
      for (let i = 0; i < n; i++) {
        if (fixed[i]) continue;
        const v = (kc[i] as number) - (lambda[c] as number) * (Md[i] as number) * (xc[i] as number);
        rn += v * v;
        kn += (kc[i] as number) ** 2;
      }
      res[c] = Math.sqrt(rn) / (Math.sqrt(kn) || 1);
    }
    if (res.slice(0, wanted).every((r) => r <= tol)) {
      converged = true;
      break;
    }
    const Y: Vec[] = [];
    const KY: Vec[] = [];
    for (let c = 0; c < X.length; c++) {
      const xc = X[c] as Vec;
      const rhs = new Float64Array(n);
      for (let i = 0; i < n; i++) rhs[i] = fixed[i] ? 0 : (Md[i] as number) * (xc[i] as number);
      // warm start: if x is near an eigenvector then K^-1 M x = x / lambda
      const x0 = new Float64Array(n);
      const lc = lambda[c] as number;
      if (lc > 0) for (let i = 0; i < n; i++) x0[i] = (xc[i] as number) / lc;
      const rtol = Math.min(1e-2, Math.max(1e-5, 0.05 * ((res[c] as number) || 1)));
      const y = pcg(rhs, x0, rtol, 4000);
      const ky = new Float64Array(n);
      applyK(y, ky);
      Y.push(y);
      KY.push(ky);
    }
    const rr = rayleighRitz(Y, KY);
    X = rr.X;
    KXs = rr.KX;
    lambda = rr.values;
    res = new Array<number>(X.length).fill(1);
  }
  if (!converged)
    warnings.push(
      `The eigensolver stopped after ${it} iterations with worst relative residual ${Math.max(...res.slice(0, wanted)).toExponential(2)}: frequencies may be slightly off`,
    );

  const frequencies = lambda.slice(0, wanted).map((l) => Math.sqrt(Math.max(l, 0)) / (2 * Math.PI));
  const modeShapes = X.slice(0, wanted).map((x) => {
    const out = Float64Array.from(x);
    let mx = 0;
    for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(out[i] as number));
    if (mx > 0) for (let i = 0; i < n; i++) out[i] = (out[i] as number) / mx;
    return out;
  });
  return {
    frequencies,
    residuals: res.slice(0, wanted),
    modeShapes,
    nodeCoords: xyz,
    elements: nElem,
    nodes: nNodes,
    dofs: n,
    elementSizeMm: Math.round(hmax * 1e4) / 1e4,
    fitted: inp.fit ?? true,
    iterations: it,
    converged,
    massG: totalMass * 1e6,
    warnings,
  };
}

/**
 * A grid for modal analysis: about 1500 elements and at least 3 across the thinnest direction (never more than about
 * 6000). Frequencies converge much faster than stresses, and every solve here is an iteration of many CG solves.
 */
export function defaultModalElementSize(volume: number, bboxSize: readonly number[]): number {
  const minDim = Math.min(...bboxSize.filter((x) => x > 1e-6));
  let h = Math.min(Math.cbrt(volume / 1500), minDim / 3);
  while (volume / h ** 3 > 6000) h *= 1.1;
  return Math.round(h * 1000) / 1000;
}
