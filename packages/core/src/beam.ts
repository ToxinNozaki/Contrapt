// Hand-calculation beam and column checks (Euler-Bernoulli, linear elastic, small deflection). These are the textbook
// closed-form cases from the Strength pack: ESTIMATES for sizing, not a simulation.

export const BEAM_SUPPORTS = [
  'cantilever',
  'simply-supported',
  'fixed-fixed',
  'fixed-pinned',
] as const;
export type BeamSupport = (typeof BEAM_SUPPORTS)[number];
export type LoadKind = 'point' | 'uniform';

export interface BeamInput {
  support: BeamSupport;
  /** point = one concentrated load F (N) at the free end (cantilever) or at mid-span (others); uniform = w (N/mm) */
  load: LoadKind;
  /** N for point loads, N/mm for uniform loads */
  value: number;
  /** span, mm */
  length: number;
  /** Young's modulus, MPa */
  E: number;
  /** second moment of area, mm^4 */
  I: number;
  /** distance from the neutral axis to the extreme fibre, mm */
  c: number;
  /** yield strength, MPa (optional): enables the safety factor */
  yield?: number;
}

export interface BeamResult {
  formula: { deflection: string; moment: string };
  /** mm, maximum deflection */
  deflection: number;
  /** N*mm, maximum bending moment */
  moment: number;
  /** MPa, maximum bending stress M c / I */
  stress: number;
  /** span / deflection (L/360 is a common limit for visible parts) */
  spanOverDeflection: number;
  safetyFactor?: number;
  /** N, support reaction at the (worst) support */
  reaction: number;
  where: string;
}

/** Closed-form beam cases. Fixed-pinned uses the propped-cantilever results (load at mid-span for point loads). */
export function beamCheck(b: BeamInput): BeamResult {
  const { L, F, w } = { L: b.length, F: b.value, w: b.value };
  const EI = b.E * b.I;
  if (!(L > 0) || !(EI > 0) || !(b.c > 0))
    throw new Error('length, E, I and c must all be positive');
  let delta: number;
  let M: number;
  let R: number;
  let formula: BeamResult['formula'];
  let where: string;
  const point = b.load === 'point';
  switch (b.support) {
    case 'cantilever':
      delta = point ? (F * L ** 3) / (3 * EI) : (w * L ** 4) / (8 * EI);
      M = point ? F * L : (w * L ** 2) / 2;
      R = point ? F : w * L;
      formula = point
        ? { deflection: 'F L^3 / (3 E I)', moment: 'F L' }
        : { deflection: 'w L^4 / (8 E I)', moment: 'w L^2 / 2' };
      where = 'maximum stress at the fixed end, maximum deflection at the free tip';
      break;
    case 'simply-supported':
      delta = point ? (F * L ** 3) / (48 * EI) : (5 * w * L ** 4) / (384 * EI);
      M = point ? (F * L) / 4 : (w * L ** 2) / 8;
      R = point ? F / 2 : (w * L) / 2;
      formula = point
        ? { deflection: 'F L^3 / (48 E I)', moment: 'F L / 4' }
        : { deflection: '5 w L^4 / (384 E I)', moment: 'w L^2 / 8' };
      where = 'maximum stress and deflection at mid-span';
      break;
    case 'fixed-fixed':
      delta = point ? (F * L ** 3) / (192 * EI) : (w * L ** 4) / (384 * EI);
      M = point ? (F * L) / 8 : (w * L ** 2) / 12;
      R = point ? F / 2 : (w * L) / 2;
      formula = point
        ? { deflection: 'F L^3 / (192 E I)', moment: 'F L / 8' }
        : { deflection: 'w L^4 / (384 E I)', moment: 'w L^2 / 12' };
      where = point
        ? 'maximum stress at the walls and the load point (equal), deflection at mid-span'
        : 'maximum stress at the walls, maximum deflection at mid-span';
      break;
    case 'fixed-pinned':
      // propped cantilever: fixed at one end, simple support at the other
      delta = point ? (F * L ** 3) / (107.3 * EI) : (w * L ** 4) / (185 * EI);
      M = point ? (3 * F * L) / 16 : (w * L ** 2) / 8;
      R = point ? (11 * F) / 16 : (5 * w * L) / 8;
      formula = point
        ? {
            deflection: 'F L^3 / (107.3 E I) (approx. 0.0093 F L^3/EI)',
            moment: '3 F L / 16 at the wall',
          }
        : { deflection: 'w L^4 / (185 E I) (approx.)', moment: 'w L^2 / 8 at the wall' };
      where = 'maximum stress at the fixed end';
      break;
  }
  const stress = (M * b.c) / b.I;
  return {
    formula,
    deflection: delta,
    moment: M,
    stress,
    spanOverDeflection: delta > 0 ? L / delta : Number.POSITIVE_INFINITY,
    ...(b.yield ? { safetyFactor: b.yield / stress } : {}),
    reaction: R,
    where,
  };
}

export const COLUMN_ENDS = {
  'pinned-pinned': 1.0,
  'fixed-free': 2.0,
  'fixed-pinned': 0.7,
  'fixed-fixed': 0.5,
} as const;
export type ColumnEnds = keyof typeof COLUMN_ENDS;

/** Euler buckling load for a slender column: P_cr = pi^2 E I / (K L)^2. Use the smaller I of the section. */
export function eulerBuckling(args: {
  E: number;
  I: number;
  length: number;
  ends: ColumnEnds;
  area: number;
  yield?: number;
}) {
  const K = COLUMN_ENDS[args.ends];
  const Pcr = (Math.PI ** 2 * args.E * args.I) / (K * args.length) ** 2;
  const slenderness = (K * args.length) / Math.sqrt(args.I / args.area);
  const crush = args.yield ? args.yield * args.area : undefined;
  return {
    K,
    criticalLoad: Pcr,
    slenderness,
    ...(crush !== undefined
      ? {
          crushLoad: crush,
          governs: Pcr < crush ? 'buckling' : 'crushing',
          note:
            Pcr < crush
              ? 'Buckling governs: the Euler load is below the crushing load. Apply a safety factor of at least 3 to the critical load.'
              : 'Crushing governs: the column is stocky, so the Euler load overestimates; use the crushing load.',
        }
      : {}),
  };
}

/**
 * beamCheck plus the beam's own weight as an extra uniform load (linear superposition).
 * density in g/cm3, area in mm2: weight per mm = density x 1e-6 kg/mm3 x area x 9.81 m/s2 (N/mm).
 */
export function beamWithSelfWeight(
  i: BeamInput & { area?: number; density?: number; selfWeight?: boolean },
): BeamResult & { selfWeightPerMm?: number } {
  const r = beamCheck(i);
  if (!i.selfWeight) return r;
  if (!i.area || !i.density)
    throw new Error('self weight needs a material (density) and a section area');
  const w = i.density * 1e-6 * i.area * 9.81;
  const own = beamCheck({ ...i, load: 'uniform', value: w });
  const stress = r.stress + own.stress;
  const deflection = r.deflection + own.deflection;
  return {
    ...r,
    deflection,
    moment: r.moment + own.moment,
    stress,
    reaction: r.reaction + own.reaction,
    spanOverDeflection: i.length / deflection,
    ...(i.yield ? { safetyFactor: i.yield / stress } : {}),
    selfWeightPerMm: w,
  };
}
