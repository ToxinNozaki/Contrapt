// Face-relative placement: find a planar face of a body by its outward normal, and map 2D (u, v) coordinates on it to
// world points, so an AI never has to compute surface coordinates by hand.
import type { Face, Shape3D } from 'replicad';

import type { V3 } from './path.ts';
export type FaceNormal = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';
export type UvFrom = 'world' | 'center' | 'corner';

const AXIS: Record<FaceNormal, { axis: 0 | 1 | 2; sign: 1 | -1; u: 0 | 1 | 2; v: 0 | 1 | 2 }> = {
  '+X': { axis: 0, sign: 1, u: 1, v: 2 },
  '-X': { axis: 0, sign: -1, u: 1, v: 2 },
  '+Y': { axis: 1, sign: 1, u: 0, v: 2 },
  '-Y': { axis: 1, sign: -1, u: 0, v: 2 },
  '+Z': { axis: 2, sign: 1, u: 0, v: 1 },
  '-Z': { axis: 2, sign: -1, u: 0, v: 1 },
};

const NAMES = ['X', 'Y', 'Z'] as const;

export interface FoundFace {
  normal: FaceNormal;
  /** Coordinate of the face's plane along the normal axis (mm). */
  level: number;
  center: V3;
  /** In-plane extent of the face's bounding box. */
  min: V3;
  max: V3;
  /** How many planar faces had this normal (so the caller can say "chose 1 of 3"). */
  candidates: number;
  description: string;
}

/** Name of the in-plane axes for a normal, e.g. '+Z' -> ['X', 'Y']. */
export function uvAxes(normal: FaceNormal): [string, string] {
  const a = AXIS[normal];
  return [NAMES[a.u], NAMES[a.v]];
}

const fmt = (x: number) => Math.round(x * 100) / 100;

/**
 * Find the planar face of `shape` whose outward normal is `normal`.
 * With `near`: the candidate closest to that point. Without: the outermost one along the normal.
 */
export function findFace(shape: Shape3D, normal: FaceNormal, near?: V3): FoundFace {
  const { axis, sign } = AXIS[normal];
  const found: { face: Face; level: number; lo: V3; hi: V3; center: V3 }[] = [];
  for (const face of shape.faces) {
    if (face.geomType !== 'PLANE') continue;
    const nv = face.normalAt();
    const comp = [nv.x, nv.y, nv.z];
    if ((comp[axis] ?? 0) * sign < 0.999999) continue;
    const [lo, hi] = face.boundingBox.bounds as unknown as [number[], number[]];
    const c = face.center;
    found.push({
      face,
      level: c.toTuple()[axis] ?? 0,
      lo: [lo[0] ?? 0, lo[1] ?? 0, lo[2] ?? 0],
      hi: [hi[0] ?? 0, hi[1] ?? 0, hi[2] ?? 0],
      center: [c.x, c.y, c.z],
    });
  }
  if (found.length === 0) {
    throw new Error(
      `The body has no flat face pointing ${normal}. Faces with that outward normal must be planar; check the direction, or use "at" with explicit coordinates`,
    );
  }

  let best = found[0];
  if (!best) throw new Error('unreachable');
  if (near) {
    const dist = (f: (typeof found)[number]) => {
      // distance from the point to the face's bounding box (0 when inside it)
      let s = 0;
      for (let i = 0; i < 3; i++) {
        const d = Math.max((f.lo[i] ?? 0) - (near[i] ?? 0), 0, (near[i] ?? 0) - (f.hi[i] ?? 0));
        s += d * d;
      }
      return Math.sqrt(s);
    };
    for (const f of found) if (dist(f) < dist(best) - 1e-9) best = f;
  } else {
    for (const f of found) if (f.level * sign > best.level * sign + 1e-9) best = f;
  }

  const where = near ? `nearest to (${near.map(fmt).join(', ')})` : 'outermost';
  return {
    normal,
    level: best.level,
    center: best.center,
    min: best.lo,
    max: best.hi,
    candidates: found.length,
    description: `${normal} face at ${NAMES[axis]}=${fmt(best.level)} (${where}${found.length > 1 ? `, 1 of ${found.length} such faces` : ''})`,
  };
}

/** Map a 2D point on a face to world coordinates. `from`: world = u,v are world coordinates of the in-plane axes. */
export function faceToWorld(face: FoundFace, uv: [number, number], from: UvFrom = 'world'): V3 {
  const { axis, u, v } = AXIS[face.normal];
  const origin: [number, number] =
    from === 'center'
      ? [face.center[u] ?? 0, face.center[v] ?? 0]
      : from === 'corner'
        ? [face.min[u] ?? 0, face.min[v] ?? 0]
        : [0, 0];
  const p: V3 = [0, 0, 0];
  p[axis] = face.level;
  p[u] = origin[0] + uv[0];
  p[v] = origin[1] + uv[1];
  return p;
}
