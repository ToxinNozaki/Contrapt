// Interference check between two bodies: do they overlap (and by how much), touch, or keep clear of each other?
// Exact: overlap volume from a boolean intersection, clearance from OpenCASCADE's shape-to-shape distance.
import { measureDistanceBetween, measureVolume, type Shape3D } from 'replicad';

export type InterferenceStatus = 'interferes' | 'touching' | 'clear';

export interface InterferenceResult {
  status: InterferenceStatus;
  /** mm^3 of material the two bodies share (0 when they only touch or are apart). */
  overlapVolume: number;
  /** Smallest distance between the two surfaces, mm (0 when they touch or overlap). */
  minDistance: number;
  /** Bounding box of the shared region, when there is one. */
  overlapBbox?: { min: [number, number, number]; max: [number, number, number] };
  /** One plain-language sentence, ready to show the owner. */
  summary: string;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
// Below this volume (mm^3) an "overlap" is numerical noise from faces that merely touch.
const VOLUME_EPS = 1e-6;
// Below this distance (mm) two surfaces count as touching.
const TOUCH_EPS = 1e-6;

export function checkInterference(
  a: Shape3D,
  b: Shape3D,
  names: [string, string] = ['a', 'b'],
): InterferenceResult {
  const [na, nb] = names;
  let overlapVolume = 0;
  let overlapBbox: InterferenceResult['overlapBbox'];
  try {
    // intersect consumes nothing we need, but clone anyway: replicad booleans can invalidate inputs on some kernels
    const common = a.clone().intersect(b.clone());
    overlapVolume = Math.abs(measureVolume(common));
    if (overlapVolume > VOLUME_EPS) {
      const [lo, hi] = common.boundingBox.bounds as unknown as [
        ArrayLike<number>,
        ArrayLike<number>,
      ];
      overlapBbox = {
        min: [r6(lo[0] ?? 0), r6(lo[1] ?? 0), r6(lo[2] ?? 0)],
        max: [r6(hi[0] ?? 0), r6(hi[1] ?? 0), r6(hi[2] ?? 0)],
      };
    }
  } catch {
    // an empty or degenerate intersection (separated or merely touching bodies) is not an overlap
    overlapVolume = 0;
  }

  if (overlapVolume > VOLUME_EPS) {
    return {
      status: 'interferes',
      overlapVolume: r6(overlapVolume),
      minDistance: 0,
      overlapBbox,
      summary: `${na} and ${nb} overlap by ${r6(overlapVolume)} mm3`,
    };
  }

  const dist = measureDistanceBetween(a, b);
  if (dist < TOUCH_EPS) {
    return {
      status: 'touching',
      overlapVolume: 0,
      minDistance: 0,
      summary: `${na} and ${nb} touch (shared surface, no overlapping volume)`,
    };
  }
  return {
    status: 'clear',
    overlapVolume: 0,
    minDistance: r6(dist),
    summary: `${na} and ${nb} are clear of each other by ${r6(dist)} mm`,
  };
}
