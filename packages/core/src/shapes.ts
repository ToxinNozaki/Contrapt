// Narrowing helpers: replicad's operations return a wide union (vertex | edge | ... | compound).
// Contrapt features always expect a 3D body, so we assert that once, with a clear error.
import type { AnyShape, Shape3D } from 'replicad';

/** Assert that a kernel result is a 3D body (shell/solid/compsolid/compound). */
export function as3D(shape: AnyShape, what = 'result'): Shape3D {
  if (!('fuse' in shape) || typeof (shape as Shape3D).fuse !== 'function') {
    throw new Error(`Expected a 3D body for ${what}, got a lower-dimensional shape`);
  }
  return shape as Shape3D;
}
