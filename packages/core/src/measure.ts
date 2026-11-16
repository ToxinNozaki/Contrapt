// Measurement: the numbers an AI needs to check its own work.
import { measureArea, measureShapeVolumeProperties, type Shape3D } from 'replicad';

export interface BodyInfo {
  /** mm^3 */
  volume: number;
  /** mm^2, total surface area */
  area: number;
  /** mm, [x, y, z] (assumes uniform density) */
  centerOfMass: [number, number, number];
  bbox: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const v3 = (a: ArrayLike<number>): [number, number, number] => [
  r6(a[0] ?? 0),
  r6(a[1] ?? 0),
  r6(a[2] ?? 0),
];

export function describeBody(shape: Shape3D): BodyInfo {
  const props = measureShapeVolumeProperties(shape);
  const [min, max] = shape.boundingBox.bounds;
  const lo = v3(min as unknown as ArrayLike<number>);
  const hi = v3(max as unknown as ArrayLike<number>);
  return {
    volume: r6(props.volume),
    area: r6(measureArea(shape)),
    centerOfMass: v3(props.centerOfMass),
    bbox: { min: lo, max: hi, size: [r6(hi[0] - lo[0]), r6(hi[1] - lo[1]), r6(hi[2] - lo[2])] },
  };
}
