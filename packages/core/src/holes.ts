// Hole features: simple, counterbored and countersunk holes, sized from real metric fastener data.
// The cutting tool is a revolved profile built drilling toward -Z from the surface point, then rotated
// and moved into place. (Threads are cosmetic: a tapped hole is cut at the tap-drill diameter.)
import { draw, type Shape3D } from 'replicad';
import { as3D } from './shapes.ts';

/** Metric screw reference (mm). Matches the "Fasteners and joints" knowledge pack. */
export const SCREWS = {
  M2: { clearance: 2.4, close: 2.2, tap: 1.6, headDia: 3.8, headHeight: 2 },
  'M2.5': { clearance: 2.9, close: 2.7, tap: 2.05, headDia: 4.5, headHeight: 2.5 },
  M3: { clearance: 3.4, close: 3.2, tap: 2.5, headDia: 5.5, headHeight: 3 },
  M4: { clearance: 4.5, close: 4.3, tap: 3.3, headDia: 7, headHeight: 4 },
  M5: { clearance: 5.5, close: 5.3, tap: 4.2, headDia: 8.5, headHeight: 5 },
  M6: { clearance: 6.6, close: 6.4, tap: 5.0, headDia: 10, headHeight: 6 },
  M8: { clearance: 9.0, close: 8.4, tap: 6.8, headDia: 13, headHeight: 8 },
  M10: { clearance: 11.0, close: 10.5, tap: 8.5, headDia: 16, headHeight: 10 },
} as const;
export type ScrewSize = keyof typeof SCREWS;
export const SCREW_SIZES = Object.keys(SCREWS) as [ScrewSize, ...ScrewSize[]];
export type Fit = 'normal' | 'close' | 'tap';
export const DIRECTIONS = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export interface HoleSpec {
  diameter: number;
  /** Depth of the plain hole from the surface (mm). */
  depth: number;
  counterbore?: { diameter: number; depth: number };
  countersink?: { diameter: number; angle: number };
}

/** Build the tool for one hole, drilling toward -Z from the origin. */
export function holeProfile(spec: HoleSpec): [number, number][] {
  const r = spec.diameter / 2;
  const d = spec.depth;
  if (spec.counterbore) {
    const R = spec.counterbore.diameter / 2;
    const cd = spec.counterbore.depth;
    if (!(R > r)) throw new Error('The counterbore diameter must be larger than the hole diameter');
    if (!(cd < d)) throw new Error('The counterbore depth must be less than the hole depth');
    // a little stick-out above the surface (z = +0.5) so the cut never leaves a skin
    return [
      [0, 0.5],
      [R, 0.5],
      [R, -cd],
      [r, -cd],
      [r, -d],
      [0, -d],
    ];
  }
  if (spec.countersink) {
    const R = spec.countersink.diameter / 2;
    if (!(R > r)) throw new Error('The countersink diameter must be larger than the hole diameter');
    const half = (spec.countersink.angle * Math.PI) / 360;
    const coneDepth = (R - r) / Math.tan(half);
    if (!(coneDepth < d)) throw new Error('The countersink is deeper than the hole');
    // extend the cone upward by the same slope for the stick-out
    const up = 0.5;
    return [
      [0, up],
      [R + up * Math.tan(half), up],
      [r, -coneDepth],
      [r, -d],
      [0, -d],
    ];
  }
  return [
    [0, 0.5],
    [r, 0.5],
    [r, -d],
    [0, -d],
  ];
}

const ROT: Record<Direction, { angle: number; axis: [number, number, number] } | undefined> = {
  '-Z': undefined,
  '+Z': { angle: 180, axis: [1, 0, 0] },
  '-X': { angle: 90, axis: [0, 1, 0] },
  '+X': { angle: -90, axis: [0, 1, 0] },
  '+Y': { angle: 90, axis: [1, 0, 0] },
  '-Y': { angle: -90, axis: [1, 0, 0] },
};

/** The solid to subtract for one hole, already positioned at `at` and pointing along `direction`. */
export function holeTool(
  spec: HoleSpec,
  at: [number, number, number],
  direction: Direction,
): Shape3D {
  const pts = holeProfile(spec);
  let pen = draw(pts[0] as [number, number]);
  for (const p of pts.slice(1)) pen = pen.lineTo(p);
  let tool = as3D(pen.close().sketchOnPlane('XZ').revolve('Z'), 'hole tool');
  const rot = ROT[direction];
  if (rot) tool = tool.rotate(rot.angle, [0, 0, 0], rot.axis);
  return tool.translate(at[0], at[1], at[2]);
}

/** Standard diameter for a screw size and fit. */
export function screwDiameter(size: ScrewSize, fit: Fit): number {
  const s = SCREWS[size];
  return fit === 'tap' ? s.tap : fit === 'close' ? s.close : s.clearance;
}
