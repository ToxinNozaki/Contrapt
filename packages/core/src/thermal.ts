// Steady-state heat conduction in a solid on the same fitted hexahedral mesh as solid_fea: fixed-temperature surfaces,
// heat input over surfaces, convection to an ambient, and volumetric heat generation. Matrix-free CG. The temperature
// field can then drive thermal stress (see the `thermal` option of solidFea).
//
// Units: mm, W, degrees C (or K: only differences matter). Conductivity is given in W/(m K) and converted.
import { measureVolume, type Shape3D } from 'replicad';
import type { V3 } from './path.ts';
import { type SolidRegion, selectNodes } from './solidfea.ts';
import { hexGaussGradients } from './solidfit.ts';
import { buildSolidMesh, faceArea, faceCorners } from './solidmesh.ts';

export interface ThermalInput {
  shape: Shape3D;
  /** W/(m K) */
  conductivity: number;
  elementSize: number;
  fit?: boolean;
  maxElements?: number;
  /** surfaces held at a temperature, degrees C */
  fixedTemperatures?: { region: SolidRegion; temperature: number }[];
  /** heat INTO the body through a surface: total power in W spread over the exposed faces of the region */
  heatInputs?: { region: SolidRegion; power: number }[];
  /** convection from an exposed surface to an ambient: h in W/(m2 K), ambient in degrees C */
  convections?: { region: SolidRegion; h: number; ambient: number }[];
  /** heat generated inside the body, total W, uniform over the volume */
  generation?: number;
  tolerance?: number;
  maxIterations?: number;
}

export interface ThermalResult {
  elements: number;
  nodes: number;
  elementSizeMm: number;
  fitted: boolean;
  volumeRatio: number;
  temperature: { min: number; max: number; minAt: V3; maxAt: V3; mean: number };
  /** heat balance in W: what goes in, and where it leaves */
  heat: {
    /** applied heat input and generation */
    inputW: number;
    /** heat entering through fixed-temperature surfaces hotter than the body, and leaving through colder ones */
    fixedInW: number;
    fixedOutW: number;
    /** heat entering from a hotter ambient, and lost to a colder one, by convection */
    convectionInW: number;
    convectionOutW: number;
    /** everything in minus everything out: zero when the solution is converged */
    imbalanceW: number;
  };
  /** largest element-average heat flux magnitude, W/mm2, and where */
  maxHeatFlux: { value: number; at: V3 };
  iterations: number;
  converged: boolean;
  relativeResidual: number;
  /** temperature at every node, in mesh node order (feed to solidFea `thermal`) */
  temperatures: Float64Array;
  /** final node coordinates, x y z per node */
  nodeCoords: Float64Array;
  warnings: string[];
}

export function solveThermal(inp: ThermalInput): ThermalResult {
  const k = inp.conductivity / 1000; // W/(mm K)
  if (!(k > 0)) throw new Error('conductivity must be positive');
  const h = inp.elementSize;
  if (!(h > 0)) throw new Error('elementSize must be positive');
  const fixedTemps = inp.fixedTemperatures ?? [];
  if (fixedTemps.length === 0 && (inp.convections ?? []).length === 0)
    throw new Error(
      'Give at least one fixed-temperature surface or a convection surface, or the temperature level is undetermined',
    );
  if (
    (inp.heatInputs ?? []).length === 0 &&
    (inp.generation ?? 0) === 0 &&
    fixedTemps.length > 0 &&
    new Set(fixedTemps.map((f) => f.temperature)).size === 1 &&
    (inp.convections ?? []).every((c) => c.ambient === fixedTemps[0]?.temperature)
  )
    throw new Error(
      'Nothing drives heat flow: every temperature is the same and there is no heat input or generation',
    );

  const fitOn = inp.fit ?? true;
  const kBrickOf = (xe: Float64Array) => {
    const K = new Float64Array(64);
    let volume = 0;
    for (const g of hexGaussGradients(xe)) {
      volume += g.det;
      for (let a = 0; a < 8; a++)
        for (let b = 0; b < 8; b++) {
          const ga = g.dNdx[a] as number[];
          const gb = g.dNdx[b] as number[];
          K[a * 8 + b] =
            (K[a * 8 + b] as number) +
            k *
              ((ga[0] as number) * (gb[0] as number) +
                (ga[1] as number) * (gb[1] as number) +
                (ga[2] as number) * (gb[2] as number)) *
              g.det;
        }
    }
    return { K, volume };
  };
  const mesh = buildSolidMesh(inp.shape, h, {
    fit: fitOn,
    maxElements: inp.maxElements ?? 60000,
    keSize: 64,
    element: () => kBrickOf,
  });
  const { nElem, nNodes, conn, xyz, evol, distIdx, distK, hmax, warnings } = mesh;
  // the shared brick matrix
  const hv = mesh.hv;
  const brickXe = new Float64Array(24);
  const SG: [number, number, number][] = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ];
  SG.forEach((s, a) => {
    brickXe[a * 3] = (s[0] * hv[0]) / 2;
    brickXe[a * 3 + 1] = (s[1] * hv[1]) / 2;
    brickXe[a * 3 + 2] = (s[2] * hv[2]) / 2;
  });
  const Kb = kBrickOf(brickXe).K;

  const coordOf = mesh.coordOf;
  const fitted = (a: number): V3 => [
    xyz[a * 3] as number,
    xyz[a * 3 + 1] as number,
    xyz[a * 3 + 2] as number,
  ];
  const pick = (region: SolidRegion, what: string) =>
    selectNodes(region, inp.shape, coordOf, nNodes, hmax, what, fitted);

  // fixed temperatures
  const fixed = new Uint8Array(nNodes);
  const Td = new Float64Array(nNodes);
  for (const ft of fixedTemps) {
    for (const a of pick(ft.region, 'fixed temperature')) {
      fixed[a] = 1;
      Td[a] = ft.temperature;
    }
  }

  // exposed faces whose four nodes all lie in a region
  const facesIn = (region: SolidRegion, what: string) => {
    const sel = new Uint8Array(nNodes);
    for (const a of pick(region, what)) sel[a] = 1;
    const out: { corners: number[]; area: number }[] = [];
    for (const code of mesh.boundaryFaces) {
      const corners = faceCorners(mesh, code);
      if (corners.every((c) => sel[c])) out.push({ corners, area: faceArea(mesh, corners) });
    }
    if (out.length === 0)
      throw new Error(
        `${what}: no exposed surface faces lie in that region (pick a face, or a box that fully covers whole faces)`,
      );
    return out;
  };

  const src = new Float64Array(nNodes); // heat sources into nodes, W
  const Hd = new Float64Array(nNodes); // convective conductance on the diagonal, W/K
  const Hamb = new Float64Array(nNodes); // H * ambient
  let powerIn = 0;
  for (const hi of inp.heatInputs ?? []) {
    const faces = facesIn(hi.region, 'heat input');
    const total = faces.reduce((s, f) => s + f.area, 0);
    for (const f of faces)
      for (const c of f.corners) src[c] = (src[c] as number) + (hi.power * f.area) / total / 4;
    powerIn += hi.power;
  }
  for (const cv of inp.convections ?? []) {
    const hh = cv.h * 1e-6; // W/(mm2 K)
    for (const f of facesIn(cv.region, 'convection')) {
      for (const c of f.corners) {
        Hd[c] = (Hd[c] as number) + (hh * f.area) / 4;
        Hamb[c] = (Hamb[c] as number) + (hh * f.area * cv.ambient) / 4;
      }
    }
  }
  let totalVol = 0;
  for (let e = 0; e < nElem; e++) totalVol += evol[e] as number;
  if (inp.generation) {
    for (let e = 0; e < nElem; e++) {
      const q = (inp.generation * (evol[e] as number)) / totalVol;
      for (let a = 0; a < 8; a++) {
        const c = conn[e * 8 + a] as number;
        src[c] = (src[c] as number) + q / 8;
      }
    }
    powerIn += inp.generation;
  }
  const f = new Float64Array(nNodes);
  for (let i = 0; i < nNodes; i++) f[i] = (src[i] as number) + (Hamb[i] as number);

  const te = new Float64Array(8);
  const conduct = (x: Float64Array, y: Float64Array) => {
    y.fill(0);
    for (let e = 0; e < nElem; e++) {
      const di = distIdx[e] as number;
      const K = di >= 0 ? distK : Kb;
      const o = di >= 0 ? di * 64 : 0;
      for (let a = 0; a < 8; a++) te[a] = x[conn[e * 8 + a] as number] as number;
      for (let a = 0; a < 8; a++) {
        let v = 0;
        for (let b = 0; b < 8; b++) v += (K[o + a * 8 + b] as number) * (te[b] as number);
        const node = conn[e * 8 + a] as number;
        y[node] = (y[node] as number) + v;
      }
    }
  };
  const apply = (x: Float64Array, y: Float64Array) => {
    conduct(x, y);
    for (let i = 0; i < nNodes; i++) y[i] = (y[i] as number) + (Hd[i] as number) * (x[i] as number);
  };

  // solve for u = T - Td on the free nodes
  const diag = new Float64Array(nNodes);
  for (let e = 0; e < nElem; e++) {
    const di = distIdx[e] as number;
    const K = di >= 0 ? distK : Kb;
    const o = di >= 0 ? di * 64 : 0;
    for (let a = 0; a < 8; a++) {
      const node = conn[e * 8 + a] as number;
      diag[node] = (diag[node] as number) + (K[o + a * 9] as number);
    }
  }
  for (let i = 0; i < nNodes; i++) diag[i] = (diag[i] as number) + (Hd[i] as number);

  const AT = new Float64Array(nNodes);
  apply(Td, AT);
  const r = new Float64Array(nNodes);
  for (let i = 0; i < nNodes; i++) r[i] = fixed[i] ? 0 : (f[i] as number) - (AT[i] as number);
  const u = new Float64Array(nNodes);
  const z = new Float64Array(nNodes);
  const p = new Float64Array(nNodes);
  const q = new Float64Array(nNodes);
  let bsum = 0;
  for (let i = 0; i < nNodes; i++) bsum += (r[i] as number) ** 2;
  const bnorm = Math.sqrt(bsum) || 1;
  const prec = (a: Float64Array, b: Float64Array) => {
    for (let i = 0; i < nNodes; i++) b[i] = fixed[i] ? 0 : (a[i] as number) / (diag[i] as number);
  };
  prec(r, z);
  p.set(z);
  let rz = 0;
  for (let i = 0; i < nNodes; i++) rz += (r[i] as number) * (z[i] as number);
  const tol = inp.tolerance ?? 1e-9;
  const maxIt = inp.maxIterations ?? 8000;
  let it = 0;
  let rel = bsum === 0 ? 0 : 1;
  if (bsum > 0)
    for (; it < maxIt; it++) {
      apply(p, q);
      for (let i = 0; i < nNodes; i++) if (fixed[i]) q[i] = 0;
      let pq = 0;
      for (let i = 0; i < nNodes; i++) pq += (p[i] as number) * (q[i] as number);
      if (!(pq > 0)) {
        warnings.push(
          'The conduction operator is singular along the search direction: part of the body is not connected to any fixed temperature or convection surface',
        );
        break;
      }
      const alpha = rz / pq;
      let rn = 0;
      for (let i = 0; i < nNodes; i++) {
        u[i] = (u[i] as number) + alpha * (p[i] as number);
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
      for (let i = 0; i < nNodes; i++) rzNew += (r[i] as number) * (z[i] as number);
      const beta = rzNew / rz;
      rz = rzNew;
      for (let i = 0; i < nNodes; i++) p[i] = (z[i] as number) + beta * (p[i] as number);
    }
  const converged = rel < Math.max(tol, 1e-6);
  if (!converged)
    warnings.push(
      `The solver stopped at relative residual ${rel.toExponential(2)} after ${it} iterations: the result may be inaccurate`,
    );
  const T = new Float64Array(nNodes);
  for (let i = 0; i < nNodes; i++) T[i] = (u[i] as number) + (Td[i] as number);

  // heat balance
  const KT = new Float64Array(nNodes);
  conduct(T, KT);
  let fixedOut = 0;
  let fixedIn = 0;
  for (let i = 0; i < nNodes; i++)
    if (fixed[i]) {
      const q =
        (src[i] as number) -
        (KT[i] as number) -
        ((Hd[i] as number) * (T[i] as number) - (Hamb[i] as number)); // heat extracted at this fixed node, beyond conduction and convection
      if (q > 0) fixedOut += q;
      else fixedIn -= q;
    }
  let convOut = 0;
  let convIn = 0;
  for (let i = 0; i < nNodes; i++) {
    const q = (Hd[i] as number) * (T[i] as number) - (Hamb[i] as number);
    if (q > 0) convOut += q;
    else convIn -= q;
  }

  // temperature extremes and the largest element heat flux
  let tmin = Number.POSITIVE_INFINITY;
  let tmax = Number.NEGATIVE_INFINITY;
  let iMin = 0;
  let iMax = 0;
  let tsum = 0;
  for (let i = 0; i < nNodes; i++) {
    const t = T[i] as number;
    tsum += t;
    if (t < tmin) {
      tmin = t;
      iMin = i;
    }
    if (t > tmax) {
      tmax = t;
      iMax = i;
    }
  }
  let qmax = 0;
  let qAt: V3 = [0, 0, 0];
  const xe = new Float64Array(24);
  for (let e = 0; e < nElem; e++) {
    mesh.gatherXe(e, xe);
    let gx = 0;
    let gy = 0;
    let gz = 0;
    let wsum = 0;
    for (const g of hexGaussGradients(xe)) {
      for (let a = 0; a < 8; a++) {
        const t = T[conn[e * 8 + a] as number] as number;
        const gr = g.dNdx[a] as number[];
        gx += t * (gr[0] as number) * g.det;
        gy += t * (gr[1] as number) * g.det;
        gz += t * (gr[2] as number) * g.det;
      }
      wsum += g.det;
    }
    const qv = (k * Math.hypot(gx, gy, gz)) / wsum;
    if (qv > qmax) {
      qmax = qv;
      qAt = [
        mesh.centers[e * 3] as number,
        mesh.centers[e * 3 + 1] as number,
        mesh.centers[e * 3 + 2] as number,
      ];
    }
  }
  return {
    elements: nElem,
    nodes: nNodes,
    elementSizeMm: Math.round(hmax * 1e4) / 1e4,
    fitted: fitOn,
    volumeRatio: totalVol / Math.abs(measureVolume(inp.shape.clone())),
    temperature: {
      min: tmin,
      max: tmax,
      minAt: fitted(iMin),
      maxAt: fitted(iMax),
      mean: tsum / nNodes,
    },
    heat: {
      inputW: powerIn,
      fixedInW: fixedIn,
      fixedOutW: fixedOut,
      convectionInW: convIn,
      convectionOutW: convOut,
      imbalanceW: powerIn + fixedIn + convIn - fixedOut - convOut,
    },
    maxHeatFlux: { value: qmax, at: qAt },
    iterations: it,
    converged,
    relativeResidual: rel,
    temperatures: T,
    nodeCoords: xyz,
    warnings,
  };
}
