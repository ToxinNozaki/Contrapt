// Assembly-level checks over several bodies: all-pairs interference, a bill of materials, and motion-range sweeps.
import type { Shape3D } from 'replicad';
import type { Model } from './engine.ts';
import { checkInterference, type InterferenceResult } from './interference.ts';
import type { V3 } from './path.ts';

const MAX_BODIES = 40;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export interface PairResult extends InterferenceResult {
  a: string;
  b: string;
}

/** Every pair of bodies (or of the listed ones): who overlaps, who touches, and the smallest clearance of the rest. */
export function interferenceReport(model: Model, ids?: string[]) {
  const all = ids ?? [...model.bodies.keys()];
  for (const id of all)
    if (!model.bodies.has(id))
      throw new Error(`No body "${id}". Bodies: ${[...model.bodies.keys()].join(', ')}`);
  if (all.length < 2) throw new Error('Need at least two bodies to check');
  if (all.length > MAX_BODIES)
    throw new Error(
      `${all.length} bodies is too many for an all-pairs check (max ${MAX_BODIES}): pass a shorter "bodies" list`,
    );
  const pairs: PairResult[] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i] as string;
      const b = all[j] as string;
      pairs.push({
        a,
        b,
        ...checkInterference(model.bodies.get(a) as Shape3D, model.bodies.get(b) as Shape3D, [
          a,
          b,
        ]),
      });
    }
  const interfering = pairs.filter((p) => p.status === 'interferes');
  const touching = pairs.filter((p) => p.status === 'touching');
  const clear = pairs.filter((p) => p.status === 'clear');
  const tightest = [...clear].sort((x, y) => x.minDistance - y.minDistance)[0];
  return { checked: pairs.length, interfering, touching, clear, tightestClear: tightest };
}

export interface BomLine {
  /** body ids that are identical (same material, volume and size) */
  ids: string[];
  quantity: number;
  material?: string;
  massEachG?: number;
  massTotalG?: number;
  sizeMm: [number, number, number];
  volumeMm3: number;
}

/** Bill of materials: identical bodies grouped with a quantity, plus the total mass of everything with a material. */
export function billOfMaterials(model: Model) {
  const groups = new Map<string, BomLine>();
  for (const [id, b] of Object.entries(model.report.bodies)) {
    const size = [...b.bbox.size].sort((p, q) => q - p).map((x) => Math.round(x * 100) / 100);
    const key = `${b.material ?? '-'}|${Math.round(b.volume * 1000) / 1000}|${size.join('x')}`;
    const g = groups.get(key);
    if (g) {
      g.ids.push(id);
      g.quantity++;
      if (g.massEachG !== undefined) g.massTotalG = r4(g.massEachG * g.quantity);
    } else
      groups.set(key, {
        ids: [id],
        quantity: 1,
        material: b.material,
        massEachG: b.massG,
        massTotalG: b.massG,
        sizeMm: b.bbox.size,
        volumeMm3: b.volume,
      });
  }
  const lines = [...groups.values()];
  const withMass = lines.filter((l) => l.massTotalG !== undefined);
  return {
    lines,
    parts: lines.reduce((s, l) => s + l.quantity, 0),
    totalMassG: withMass.length
      ? r4(withMass.reduce((s, l) => s + (l.massTotalG ?? 0), 0))
      : undefined,
    missingMaterial: lines.filter((l) => l.massTotalG === undefined).flatMap((l) => l.ids),
  };
}

export interface MotionInput {
  body: string;
  /** straight-line motion: total displacement from the start pose, mm */
  translate?: V3;
  /** rotation: degrees about an axis through origin (default the world origin) */
  rotate?: { axis: 'X' | 'Y' | 'Z'; degrees: number; origin?: V3 };
  /** poses checked = steps + 1 (the start pose included), default 20, max 120 */
  steps?: number;
  /** bodies to check against (default: every other body) */
  against?: string[];
}

export interface MotionStep {
  step: number;
  /** fraction of the full motion, 0..1 */
  fraction: number;
  collisions: { body: string; overlapMm3: number }[];
  minGapMm?: number;
}

/** Sweep a body through a straight-line or rotary motion and report where it hits something. Poses are sampled, not swept: use enough steps. */
export function motionCheck(model: Model, inp: MotionInput) {
  const shape = model.bodies.get(inp.body);
  if (!shape)
    throw new Error(`No body "${inp.body}". Bodies: ${[...model.bodies.keys()].join(', ')}`);
  if (!inp.translate && !inp.rotate) throw new Error('Give a "translate" or a "rotate" motion');
  if (inp.translate && inp.rotate) throw new Error('Give either "translate" or "rotate", not both');
  const others = (inp.against ?? [...model.bodies.keys()].filter((k) => k !== inp.body)).filter(
    (k) => k !== inp.body,
  );
  for (const o of others)
    if (!model.bodies.has(o))
      throw new Error(`No body "${o}". Bodies: ${[...model.bodies.keys()].join(', ')}`);
  if (others.length === 0) throw new Error('There is nothing to check against: add another body');
  const steps = Math.max(1, Math.min(120, Math.round(inp.steps ?? 20)));
  const results: MotionStep[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    let moved = shape.clone();
    if (inp.translate)
      moved = moved.translate(inp.translate[0] * f, inp.translate[1] * f, inp.translate[2] * f);
    else if (inp.rotate) {
      const o = inp.rotate.origin ?? [0, 0, 0];
      const dir: V3 =
        inp.rotate.axis === 'X' ? [1, 0, 0] : inp.rotate.axis === 'Y' ? [0, 1, 0] : [0, 0, 1];
      moved = moved.rotate(inp.rotate.degrees * f, o, dir);
    }
    const collisions: MotionStep['collisions'] = [];
    let minGap: number | undefined;
    for (const o of others) {
      const c = checkInterference(moved, model.bodies.get(o) as Shape3D, [inp.body, o]);
      if (c.status === 'interferes') collisions.push({ body: o, overlapMm3: c.overlapVolume });
      else minGap = Math.min(minGap ?? Number.POSITIVE_INFINITY, c.minDistance);
    }
    results.push({
      step: i,
      fraction: r4(f),
      collisions,
      ...(minGap !== undefined ? { minGapMm: r4(minGap) } : {}),
    });
  }
  const hits = results.filter((r) => r.collisions.length > 0);
  const first = hits[0];
  const startsHit = (results[0]?.collisions.length ?? 0) > 0;
  const gaps = results.map((r) => r.minGapMm).filter((g): g is number => g !== undefined);
  return {
    poses: results.length,
    firstCollision: first,
    collisionFree: hits.length === 0,
    startsInCollision: startsHit,
    collidingPoses: hits.length,
    tightestGapMm: gaps.length ? Math.min(...gaps) : undefined,
    results,
  };
}
