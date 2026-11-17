// Repeating features: linear and circular patterns, and mirroring.
import type { Shape3D } from 'replicad';

export type V3 = [number, number, number];

export type PatternNumeric =
  | { kind: 'linear'; count: number; step: V3 }
  | { kind: 'circular'; count: number; center: V3; axis: 'X' | 'Y' | 'Z'; angle: number };

const AXIS: Record<'X' | 'Y' | 'Z', V3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

/** Rotation step for instance i of a circular pattern: a full 360 spreads evenly, a partial sweep ends on the last instance. */
function circularAngle(p: Extract<PatternNumeric, { kind: 'circular' }>, i: number): number {
  const full = Math.abs(p.angle - 360) < 1e-9;
  const step = full ? p.angle / p.count : p.angle / (p.count - 1);
  return step * i;
}

function rotatePoint(pt: V3, center: V3, axis: 'X' | 'Y' | 'Z', deg: number): V3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = pt[0] - center[0];
  const y = pt[1] - center[1];
  const z = pt[2] - center[2];
  const [rx, ry, rz] =
    axis === 'Z'
      ? [x * c - y * s, x * s + y * c, z]
      : axis === 'X'
        ? [x, y * c - z * s, y * s + z * c]
        : [x * c + z * s, y, -x * s + z * c];
  return [rx + center[0], ry + center[1], rz + center[2]];
}

/** All positions of a point under a pattern (the original is instance 0). */
export function patternPositions(pt: V3, p: PatternNumeric): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < p.count; i++) {
    out.push(
      p.kind === 'linear'
        ? [pt[0] + p.step[0] * i, pt[1] + p.step[1] * i, pt[2] + p.step[2] * i]
        : rotatePoint(pt, p.center, p.axis, circularAngle(p, i)),
    );
  }
  return out;
}

/** All copies of a body under a pattern (the original is instance 0). */
export function patternCopies(shape: Shape3D, p: PatternNumeric): Shape3D[] {
  const out: Shape3D[] = [];
  for (let i = 0; i < p.count; i++) {
    if (i === 0) out.push(shape);
    else if (p.kind === 'linear')
      out.push(shape.clone().translate(p.step[0] * i, p.step[1] * i, p.step[2] * i));
    else out.push(shape.clone().rotate(circularAngle(p, i), p.center, AXIS[p.axis]));
  }
  return out;
}

/** Plane name and origin for mirroring across the plane perpendicular to `axis` at `offset`. */
export function mirrorPlane(
  axis: 'X' | 'Y' | 'Z',
  offset: number,
): { plane: 'YZ' | 'XZ' | 'XY'; origin: V3 } {
  return axis === 'X'
    ? { plane: 'YZ', origin: [offset, 0, 0] }
    : axis === 'Y'
      ? { plane: 'XZ', origin: [0, offset, 0] }
      : { plane: 'XY', origin: [0, 0, offset] };
}
