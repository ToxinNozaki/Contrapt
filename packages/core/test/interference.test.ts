import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel, checkInterference, initKernel, ModelBuilder } from '../src/index.ts';

const build = async (steps: Parameters<ModelBuilder['add']>[0][]) => {
  await initKernel();
  const b = new ModelBuilder();
  for (const s of steps) b.add(s);
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  return m;
};
const check = (m: Awaited<ReturnType<typeof build>>, a: string, b: string) => {
  const sa = m.bodies.get(a);
  const sb = m.bodies.get(b);
  assert.ok(sa && sb);
  return checkInterference(sa, sb, [a, b]);
};

test('overlapping boxes: exact overlap volume and its bounding box', async () => {
  const m = await build([
    { op: 'box', id: 'a', w: 10, d: 10, h: 10 },
    { op: 'box', id: 'b', w: 10, d: 10, h: 10, at: [5, 0, 0] },
  ]);
  const r = check(m, 'a', 'b');
  assert.equal(r.status, 'interferes');
  assert.ok(Math.abs(r.overlapVolume - 500) < 1e-3);
  assert.equal(r.minDistance, 0);
  assert.deepEqual(r.overlapBbox?.min, [0, -5, -5]);
  assert.deepEqual(r.overlapBbox?.max, [5, 5, 5]);
  assert.match(r.summary, /a and b overlap by 500/);
});

test('face-to-face bodies touch: no overlap, zero gap', async () => {
  const m = await build([
    { op: 'box', id: 'a', w: 10, d: 10, h: 10 },
    { op: 'box', id: 'b', w: 10, d: 10, h: 10, at: [10, 0, 0] },
  ]);
  const r = check(m, 'a', 'b');
  assert.equal(r.status, 'touching');
  assert.equal(r.overlapVolume, 0);
  assert.equal(r.minDistance, 0);
});

test('separated bodies are clear and report the exact gap', async () => {
  const m = await build([
    { op: 'box', id: 'a', w: 10, d: 10, h: 10 },
    { op: 'box', id: 'b', w: 10, d: 10, h: 10, at: [13.5, 0, 0] },
  ]);
  const r = check(m, 'a', 'b');
  assert.equal(r.status, 'clear');
  assert.ok(Math.abs(r.minDistance - 3.5) < 1e-6);
  assert.match(r.summary, /clear .* 3\.5 mm/);
});

test('the checker does not consume or change the bodies it inspects', async () => {
  const m = await build([
    { op: 'box', id: 'a', w: 10, d: 10, h: 10 },
    { op: 'box', id: 'b', w: 10, d: 10, h: 10, at: [5, 0, 0] },
  ]);
  check(m, 'a', 'b');
  const again = check(m, 'a', 'b'); // would throw "object has been deleted" if the first call consumed a body
  assert.ok(Math.abs(again.overlapVolume - 500) < 1e-3);
});

test('pin in a hole: a loose pin is clear, a tight one interferes by exactly the ring volume', async () => {
  const m = await build([
    { op: 'box', id: 'plate', w: 30, d: 30, h: 10, at: [0, 0, 5] },
    { op: 'hole', target: 'plate', at: [0, 0, 10], diameter: 8 },
    { op: 'cylinder', id: 'loose', r: 3.9, h: 10, at: [0, 0, 5] },
    { op: 'cylinder', id: 'tight', r: 4.5, h: 10, at: [0, 0, 5] },
  ]);
  const loose = check(m, 'plate', 'loose');
  assert.equal(loose.status, 'clear');
  assert.ok(Math.abs(loose.minDistance - 0.1) < 1e-4, `gap ${loose.minDistance}`);
  const tight = check(m, 'plate', 'tight');
  assert.equal(tight.status, 'interferes');
  const ring = Math.PI * (4.5 ** 2 - 4 ** 2) * 10;
  assert.ok(Math.abs(tight.overlapVolume - ring) < 0.5, `${tight.overlapVolume} vs ${ring}`);
});
