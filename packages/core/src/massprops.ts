// Mass properties from the tessellated boundary (divergence theorem over signed tetrahedra): volume, centre of mass and
// the full inertia tensor for uniform density. Exact for polyhedra; for curved bodies the error is the tessellation error
// (the tolerance used here keeps it well under 0.5%).
import type { Shape3D } from 'replicad';
import type { V3 } from './path.ts';

export interface MassProps {
  /** mm^3 */
  volume: number;
  centerOfMass: V3;
  /** inertia tensor about the centre of mass for unit density, mm^5 (multiply by density in g/mm3 for g*mm^2) */
  inertiaUnitDensity: number[][];
  /** principal moments (unit density, mm^5), ascending, and their unit axes */
  principalUnitDensity: { moment: number; axis: V3 }[];
}

export interface MassPropsDensity {
  massG: number;
  centerOfMass: V3;
  /** about the centre of mass, g*mm^2 */
  inertiaGmm2: number[][];
  /** the same in SI, kg*m^2 */
  inertiaKgm2: number[][];
  principal: { momentKgm2: number; axis: V3 }[];
  /** radius of gyration about each principal axis, mm */
  gyrationMm: number[];
}

type M3 = number[][];
const zero = (): M3 => [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];

/** Eigen-decomposition of a symmetric 3x3 matrix by Jacobi rotations. */
function eigenSym(A: M3): { values: number[]; vectors: V3[] } {
  const a = A.map((r) => r.slice());
  const v: M3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0]?.[1] ?? 0) + Math.abs(a[0]?.[2] ?? 0) + Math.abs(a[1]?.[2] ?? 0);
    if (
      off <
      1e-14 *
        (Math.abs(a[0]?.[0] ?? 0) + Math.abs(a[1]?.[1] ?? 0) + Math.abs(a[2]?.[2] ?? 0) + 1e-300)
    )
      break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      const apq = (a[p] as number[])[q] as number;
      if (Math.abs(apq) < 1e-300) continue;
      const theta =
        (((a[q] as number[])[q] as number) - ((a[p] as number[])[p] as number)) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = (a[k] as number[])[p] as number;
        const akq = (a[k] as number[])[q] as number;
        (a[k] as number[])[p] = c * akp - s * akq;
        (a[k] as number[])[q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = (a[p] as number[])[k] as number;
        const aqk = (a[q] as number[])[k] as number;
        (a[p] as number[])[k] = c * apk - s * aqk;
        (a[q] as number[])[k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = (v[k] as number[])[p] as number;
        const vkq = (v[k] as number[])[q] as number;
        (v[k] as number[])[p] = c * vkp - s * vkq;
        (v[k] as number[])[q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort(
    (i, j) => ((a[i] as number[])[i] as number) - ((a[j] as number[])[j] as number),
  );
  return {
    values: order.map((i) => (a[i] as number[])[i] as number),
    vectors: order.map(
      (i) =>
        [
          (v[0] as number[])[i] as number,
          (v[1] as number[])[i] as number,
          (v[2] as number[])[i] as number,
        ] as V3,
    ),
  };
}

export function massProps(shape: Shape3D): MassProps {
  const mesh = shape.mesh({ tolerance: 0.005, angularTolerance: 0.05 });
  const p = mesh.vertices;
  let vol = 0;
  const first = [0, 0, 0];
  const C = zero(); // integral of x x^T dV
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const ia = (mesh.triangles[t] as number) * 3;
    const ib = (mesh.triangles[t + 1] as number) * 3;
    const ic = (mesh.triangles[t + 2] as number) * 3;
    const a = [p[ia] as number, p[ia + 1] as number, p[ia + 2] as number];
    const b = [p[ib] as number, p[ib + 1] as number, p[ib + 2] as number];
    const c = [p[ic] as number, p[ic + 1] as number, p[ic + 2] as number];
    const [ax, ay, az] = a as [number, number, number];
    const [bx, by, bz] = b as [number, number, number];
    const [cx, cy, cz] = c as [number, number, number];
    const v6 = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const V = v6 / 6; // signed tetrahedron volume with the origin
    vol += V;
    const sv = [ax + bx + cx, ay + by + cy, az + bz + cz];
    for (let i = 0; i < 3; i++) first[i] = (first[i] as number) + (V / 4) * (sv[i] as number);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const sum =
          (a[i] as number) * (a[j] as number) +
          (b[i] as number) * (b[j] as number) +
          (c[i] as number) * (c[j] as number) +
          (sv[i] as number) * (sv[j] as number);
        (C[i] as number[])[j] = ((C[i] as number[])[j] as number) + (V / 20) * sum;
      }
  }
  if (!(Math.abs(vol) > 1e-12)) throw new Error('The body has no volume');
  const sign = vol < 0 ? -1 : 1; // an inside-out mesh would flip every sign
  vol *= sign;
  const com: V3 = [
    (sign * (first[0] as number)) / vol,
    (sign * (first[1] as number)) / vol,
    (sign * (first[2] as number)) / vol,
  ];
  // covariance about the centre of mass: C - V c c^T
  const Cc = zero();
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      (Cc[i] as number[])[j] =
        sign * ((C[i] as number[])[j] as number) - vol * (com[i] as number) * (com[j] as number);
  const tr =
    ((Cc[0] as number[])[0] as number) +
    ((Cc[1] as number[])[1] as number) +
    ((Cc[2] as number[])[2] as number);
  const I = zero();
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      (I[i] as number[])[j] = (i === j ? tr : 0) - ((Cc[i] as number[])[j] as number);
  const e = eigenSym(I);
  return {
    volume: vol,
    centerOfMass: com,
    inertiaUnitDensity: I,
    principalUnitDensity: e.values.map((moment, k) => ({ moment, axis: e.vectors[k] as V3 })),
  };
}

/** Apply a density (g/cm3) to get mass and inertia in g*mm^2 and kg*m^2. */
export function withDensity(mp: MassProps, densityGcm3: number): MassPropsDensity {
  const rho = densityGcm3 / 1000; // g/mm3
  const mass = mp.volume * rho;
  const scale = (x: number) => x * rho;
  const toKg = (x: number) => x * rho * 1e-3 * 1e-6; // g*mm^2 -> kg*m^2
  return {
    massG: mass,
    centerOfMass: mp.centerOfMass,
    inertiaGmm2: mp.inertiaUnitDensity.map((r) => r.map(scale)),
    inertiaKgm2: mp.inertiaUnitDensity.map((r) => r.map(toKg)),
    principal: mp.principalUnitDensity.map((q) => ({ momentKgm2: toKg(q.moment), axis: q.axis })),
    gyrationMm: mp.principalUnitDensity.map((q) => Math.sqrt((q.moment * rho) / mass)),
  };
}

/** Moment of inertia (kg*m^2) of the body about an arbitrary axis (parallel-axis theorem). */
export function inertiaAboutAxis(
  mp: MassProps,
  densityGcm3: number,
  origin: V3,
  direction: V3,
): number {
  const n = Math.hypot(...direction);
  if (!(n > 0)) throw new Error('The axis direction must not be zero');
  const u: V3 = [direction[0] / n, direction[1] / n, direction[2] / n];
  const d = withDensity(mp, densityGcm3);
  // about the COM along u
  let iu = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      iu += (u[i] as number) * ((d.inertiaKgm2[i] as number[])[j] as number) * (u[j] as number);
  // perpendicular distance from the COM to the axis (mm -> m)
  const w: V3 = [
    mp.centerOfMass[0] - origin[0],
    mp.centerOfMass[1] - origin[1],
    mp.centerOfMass[2] - origin[2],
  ];
  const along = w[0] * u[0] + w[1] * u[1] + w[2] * u[2];
  const perp2 = (w[0] ** 2 + w[1] ** 2 + w[2] ** 2 - along * along) * 1e-6; // mm^2 -> m^2
  return iu + (d.massG / 1000) * perp2;
}
