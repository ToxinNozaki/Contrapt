// Cross-section properties (area, centroid, second moments) of a 2D sketch, by Green's theorem over the exact
// boundary sampled finely. Straight edges are exact; curves are sampled densely enough for ~1e-5 relative error.
import type { Drawing, Edge, Face, Wire } from 'replicad';

export interface SectionProps {
  /** mm^2 */
  area: number;
  /** centroid in sketch coordinates, mm */
  centroid: [number, number];
  /** second moments of area about axes through the centroid, mm^4 (Ix bends about the sketch x axis: depth is along y) */
  Ix: number;
  Iy: number;
  Ixy: number;
  /** principal second moments (I1 >= I2) and the angle of the I1 axis from sketch x, degrees */
  I1: number;
  I2: number;
  principalAngleDeg: number;
  /** distances from the centroid to the extreme fibres, mm */
  extent: { yMax: number; yMin: number; xMax: number; xMin: number };
  /** elastic section moduli, mm^3 (I over the farthest fibre) */
  Zx: number;
  Zy: number;
  /** radii of gyration, mm */
  rx: number;
  ry: number;
  /** polar second moment about the centroid, Ix + Iy (NOT the torsion constant) */
  Jpolar: number;
  bbox: { min: [number, number]; max: [number, number] };
}

type P = [number, number];
const CURVE_SAMPLES = 720;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

function edgePoints(e: Edge): P[] {
  const straight = e.geomType === 'LINE';
  const n = straight ? 1 : CURVE_SAMPLES;
  const pts: P[] = [];
  for (let i = 0; i <= n; i++) {
    const v = e.pointAt(i / n);
    pts.push([v.x, v.y]);
  }
  return pts;
}

const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Chain a wire's edges into one closed polyline (edges may be stored in either direction). */
function wireLoop(w: Wire): P[] {
  const pieces = w.edges.map(edgePoints);
  const first = pieces.shift();
  if (!first) return [];
  const loop: P[] = [...first];
  while (pieces.length) {
    const end = loop[loop.length - 1] as P;
    let bestIdx = 0;
    let bestRev = false;
    let best = Number.POSITIVE_INFINITY;
    pieces.forEach((p, i) => {
      const dS = dist(end, p[0] as P);
      const dE = dist(end, p[p.length - 1] as P);
      if (dS < best) [best, bestIdx, bestRev] = [dS, i, false];
      if (dE < best) [best, bestIdx, bestRev] = [dE, i, true];
    });
    const [piece] = pieces.splice(bestIdx, 1);
    if (!piece) break;
    const seq = bestRev ? [...piece].reverse() : piece;
    loop.push(...seq.slice(1));
  }
  return loop;
}

/** Signed raw moments of a closed polygon: area, first moments, second moments about the sketch origin. */
function polygonMoments(pts: P[]) {
  let a = 0;
  let sx = 0;
  let sy = 0;
  let ixx = 0;
  let iyy = 0;
  let ixy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i] as P;
    const [x1, y1] = pts[(i + 1) % pts.length] as P;
    const c = x0 * y1 - x1 * y0;
    a += c;
    sx += (x0 + x1) * c;
    sy += (y0 + y1) * c;
    ixx += (y0 * y0 + y0 * y1 + y1 * y1) * c;
    iyy += (x0 * x0 + x0 * x1 + x1 * x1) * c;
    ixy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c;
  }
  return { A: a / 2, Sx: sx / 6, Sy: sy / 6, Ixx: ixx / 12, Iyy: iyy / 12, Ixy: ixy / 24 };
}

export function sectionProperties(drawing: Drawing): SectionProps {
  const sk = drawing.sketchOnPlane('XY', 0) as unknown as {
    face?: () => Face;
    faces?: () => { faces: Face[] };
  };
  const faces: Face[] = sk.face ? [sk.face()] : (sk.faces?.().faces ?? []);
  const outers: P[][] = [];
  const holes: P[][] = [];
  for (const face of faces) {
    outers.push(wireLoop(face.clone().outerWire()));
    for (const h of face.clone().innerWires()) holes.push(wireLoop(h));
  }
  if (outers.length === 0 || outers.some((o) => o.length < 3))
    throw new Error('The sketch has no closed outline to measure');

  let A = 0;
  let Sx = 0;
  let Sy = 0;
  let Ixx = 0;
  let Iyy = 0;
  let Ixy = 0;
  const add = (loop: P[], sign: 1 | -1) => {
    const m = polygonMoments(loop);
    const orient = m.A < 0 ? -1 : 1; // make every loop positive, then apply +1 (material) or -1 (hole)
    const k = sign * orient;
    A += k * m.A;
    Sx += k * m.Sx;
    Sy += k * m.Sy;
    Ixx += k * m.Ixx;
    Iyy += k * m.Iyy;
    Ixy += k * m.Ixy;
  };
  for (const o of outers) add(o, 1);
  for (const h of holes) add(h, -1);
  if (!(A > 0)) throw new Error('The sketch encloses no area');

  const cx = Sx / A;
  const cy = Sy / A;
  const Ix = Ixx - A * cy * cy;
  const Iy = Iyy - A * cx * cx;
  const Ixy_c = Ixy - A * cx * cy;
  const mid = (Ix + Iy) / 2;
  const rad = Math.hypot((Ix - Iy) / 2, Ixy_c);
  const angle = 0.5 * Math.atan2(-2 * Ixy_c, Ix - Iy);

  const all = [...outers, ...holes].flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const ext = { yMax: yMax - cy, yMin: cy - yMin, xMax: xMax - cx, xMin: cx - xMin };

  return {
    area: r6(A),
    centroid: [r6(cx), r6(cy)],
    Ix: r6(Ix),
    Iy: r6(Iy),
    Ixy: r6(Ixy_c),
    I1: r6(mid + rad),
    I2: r6(mid - rad),
    principalAngleDeg: r6((angle * 180) / Math.PI),
    extent: {
      yMax: r6(ext.yMax),
      yMin: r6(ext.yMin),
      xMax: r6(ext.xMax),
      xMin: r6(ext.xMin),
    },
    Zx: r6(Ix / Math.max(ext.yMax, ext.yMin)),
    Zy: r6(Iy / Math.max(ext.xMax, ext.xMin)),
    rx: r6(Math.sqrt(Ix / A)),
    ry: r6(Math.sqrt(Iy / A)),
    Jpolar: r6(Ix + Iy),
    bbox: { min: [r6(xMin), r6(yMin)], max: [r6(xMax), r6(yMax)] },
  };
}
