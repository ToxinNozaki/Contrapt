// Spine paths for sweeps: a 3D polyline whose corners can be rounded with a bend radius (like pipe bends).
import { assembleWire, makeLine, makeThreePointArc, type Wire } from 'replicad';

export type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Drop consecutive duplicate points. */
export function cleanPoints(pts: V3[]): V3[] {
  return pts.filter((p, i) => i === 0 || len(sub(p, pts[i - 1] as V3)) > 1e-9);
}

/**
 * Build the spine wire: straight segments between the points, with an exact circular arc at every
 * interior corner when `bendRadius` > 0. Throws a plain-language error when a bend does not fit.
 */
export function buildSpine(points: V3[], bendRadius: number): Wire {
  const pts = cleanPoints(points);
  if (pts.length < 2) throw new Error('A sweep path needs at least two different points');
  type Corner = { t1: V3; t2: V3; mid: V3; t: number } | undefined;
  const corners: Corner[] = pts.map(() => undefined);

  if (bendRadius > 0) {
    for (let i = 1; i < pts.length - 1; i++) {
      const c = pts[i] as V3;
      const u = unit(sub(pts[i - 1] as V3, c));
      const v = unit(sub(pts[i + 1] as V3, c));
      const cosPhi = Math.max(-1, Math.min(1, dot(u, v)));
      const phi = Math.acos(cosPhi);
      if (phi > Math.PI - 1e-6) continue; // collinear: nothing to round
      if (phi < 1e-6) throw new Error(`The path doubles back on itself at point ${i + 1}`);
      const t = bendRadius / Math.tan(phi / 2);
      const bis = unit(add(u, v));
      const center = add(c, mul(bis, bendRadius / Math.sin(phi / 2)));
      corners[i] = {
        t,
        t1: add(c, mul(u, t)),
        t2: add(c, mul(v, t)),
        mid: sub(center, mul(bis, bendRadius)),
      };
    }
    // each straight piece must be long enough for the bends at both of its ends
    for (let i = 0; i < pts.length - 1; i++) {
      const used = (corners[i]?.t ?? 0) + (corners[i + 1]?.t ?? 0);
      const segLen = len(sub(pts[i + 1] as V3, pts[i] as V3));
      if (used > segLen + 1e-6) {
        throw new Error(
          `Bend radius ${bendRadius} is too large for the path: the straight piece between points ${i + 1} and ${i + 2} is ${segLen.toFixed(2)} long but the bends need ${used.toFixed(2)}. Use a smaller bendRadius or longer straight pieces.`,
        );
      }
    }
  }

  const edges = [];
  let from = pts[0] as V3;
  for (let i = 1; i < pts.length; i++) {
    const k = corners[i];
    if (k && i < pts.length - 1) {
      edges.push(makeLine(from, k.t1), makeThreePointArc(k.t1, k.mid, k.t2));
      from = k.t2;
    } else {
      edges.push(makeLine(from, pts[i] as V3));
    }
  }
  return assembleWire(edges);
}

/** Orientation of the profile plane at the start of a path: x is horizontal where possible. */
export function profileFrame(first: V3, second: V3): { dir: V3; xDir: V3 } {
  const dir = unit(sub(second, first));
  const up: V3 = [0, 0, 1];
  const xDir = Math.abs(dot(dir, up)) > 0.99 ? ([1, 0, 0] as V3) : unit(cross(up, dir));
  return { dir, xDir };
}
