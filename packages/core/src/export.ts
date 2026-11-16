// Exports and meshes. STEP is exact B-rep (what you'd send to a fabricator or another CAD tool);
// STL and the viewer mesh are tessellated approximations.
import type { Shape3D } from 'replicad';
import type { Model } from './engine.ts';

function pick(model: Model, id?: string): Shape3D {
  if (id) {
    const s = model.bodies.get(id);
    if (!s)
      throw new Error(
        `No body "${id}". Bodies: ${[...model.bodies.keys()].join(', ') || '(none)'}`,
      );
    return s;
  }
  const first = [...model.bodies.values()];
  if (first.length === 0) throw new Error('The model has no bodies yet');
  const only = first[0] as Shape3D;
  // Several bodies: fuse into one compound-like export by fusing (non-destructive to the model).
  return first.length === 1 ? only : first.slice(1).reduce((acc, s) => acc.fuse(s), only);
}

/** Exact STEP text for one body (or all bodies fused when `id` is omitted). */
export async function exportStep(model: Model, id?: string): Promise<string> {
  return pick(model, id).blobSTEP().text();
}

/** Binary STL bytes. `tolerance`/`angularTolerance` control smoothness vs size. */
export async function exportStl(
  model: Model,
  id?: string,
  opts: { tolerance?: number; angularTolerance?: number } = {},
): Promise<Uint8Array> {
  const blob = pick(model, id).blobSTL({
    binary: true,
    tolerance: opts.tolerance ?? 0.05,
    angularTolerance: opts.angularTolerance ?? 0.1,
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export interface ViewerMesh {
  id: string;
  vertices: number[];
  normals: number[];
  triangles: number[];
  /** Polyline edge geometry for crisp outlines: flat xyz list per edge group. */
  edges: number[];
}

/** Tessellate every body for the browser viewer. */
export function meshBodies(
  model: Model,
  opts: { tolerance?: number; angularTolerance?: number } = {},
): ViewerMesh[] {
  const mo = { tolerance: opts.tolerance ?? 0.05, angularTolerance: opts.angularTolerance ?? 0.1 };
  return [...model.bodies].map(([id, shape]) => {
    const m = shape.mesh(mo);
    const e = shape.meshEdges(mo);
    return { id, vertices: m.vertices, normals: m.normals, triangles: m.triangles, edges: e.lines };
  });
}
