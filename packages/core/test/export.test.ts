import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildModel,
  exportStep,
  exportStl,
  initKernel,
  ModelBuilder,
  meshBodies,
} from '../src/index.ts';

const plate = async () => {
  await initKernel();
  const b = new ModelBuilder('plate');
  b.add({ op: 'box', id: 'p', w: 40, d: 20, h: 6 });
  b.add({ op: 'cylinder', id: 'c', r: 3, h: 20 });
  b.add({ op: 'boolean', id: 'part', kind: 'cut', a: 'p', b: 'c' });
  return buildModel(b.toJSON());
};

test('STEP export is valid and names the body count', async () => {
  const m = await plate();
  const step = await exportStep(m, 'part');
  assert.match(step, /^ISO-10303-21;/);
  assert.match(step, /MANIFOLD_SOLID_BREP/);
});

test('STL export is a well-formed binary STL', async () => {
  const m = await plate();
  const stl = await exportStl(m, 'part');
  const triCount = new DataView(stl.buffer, stl.byteOffset).getUint32(80, true);
  assert.ok(triCount > 12, `triangles: ${triCount}`);
  assert.equal(stl.byteLength, 84 + 50 * triCount);
});

test('viewer mesh has consistent index ranges', async () => {
  const m = await plate();
  const [mesh] = meshBodies(m);
  assert.ok(mesh);
  assert.equal(mesh.id, 'part');
  assert.equal(mesh.vertices.length, mesh.normals.length);
  const vcount = mesh.vertices.length / 3;
  assert.ok(mesh.triangles.length % 3 === 0 && mesh.triangles.every((i) => i >= 0 && i < vcount));
  assert.ok(mesh.edges.length > 0);
});

test('exporting a missing body gives a helpful error', async () => {
  const m = await plate();
  await assert.rejects(() => exportStep(m, 'nope'), /No body "nope"\. Bodies: part/);
});
