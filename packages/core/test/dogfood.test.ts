// Regression tests for friction found by dogfooding (designing a real L-bracket through the tool interface).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel, initKernel, ModelBuilder } from '../src/index.ts';

const close = (a: number, b: number, tol = 1e-2) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

async function blockWithHole() {
  await initKernel();
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'blk', w: 40, d: 20, h: 10, at: [0, 0, 5] }); // z 0..10
  b.add({ op: 'hole', target: 'blk', at: [0, 0, 10], diameter: 4, depth: 3 }); // blind hole: its seam edges are only 3 long
  return b;
}

test('edge selectors can skip short hole/seam edges with lengthAtLeast', async () => {
  const plain = await blockWithHole();
  plain.add({
    op: 'fillet',
    id: 'f',
    target: 'blk',
    radius: 2,
    edges: { direction: 'Z', expect: 4 },
  });
  const bad = await buildModel(plain.toJSON());
  assert.equal(bad.report.ok, false); // direction Z alone also matches the hole seam(s)
  assert.match(
    bad.report.steps.find((s) => s.id === 'f')?.error ?? '',
    /matched \d+ but expected 4/,
  );

  const fixed = await blockWithHole();
  fixed.add({
    op: 'fillet',
    id: 'f',
    target: 'blk',
    radius: 2,
    edges: { direction: 'Z', lengthAtLeast: 9, expect: 4 },
  });
  const ok = await buildModel(fixed.toJSON());
  assert.ok(ok.report.ok, JSON.stringify(ok.report.steps));
});

test('edge selectors: lengthAtMost and curve:circle pick hole rims', async () => {
  const b = await blockWithHole();
  b.add({
    op: 'chamfer',
    id: 'c',
    target: 'blk',
    distance: 0.5,
    edges: { curve: 'circle', plane: { name: 'XY', offset: 10 }, expect: 1 },
  });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  const before = 40 * 20 * 10 - Math.PI * 4 * 3;
  const removed = before - (m.report.bodies.blk?.volume ?? 0);
  assert.ok(removed > 0.5 && removed < 3, `chamfer removed ${removed}`); // a 0.5 mm chamfer on a 2 mm radius rim

  // lengthAtMost picks only the short hole seam; chamfering a seam is not a valid operation, and the kernel
  // gives no message of its own: the engine must still explain it instead of returning a bare "error"
  const short = await blockWithHole();
  short.add({
    op: 'chamfer',
    id: 'c',
    target: 'blk',
    distance: 0.3,
    edges: { direction: 'Z', lengthAtMost: 4, expect: 1 },
  });
  const ms = await buildModel(short.toJSON());
  const err = ms.report.steps.find((s) => s.id === 'c')?.error ?? '';
  assert.match(err, /could not complete this chamfer step|seam/);
  assert.ok(err.length > 40, `error should explain itself, got: "${err}"`);
});

test('empty selector error mentions the new filters', async () => {
  const b = await blockWithHole();
  b.add({ op: 'fillet', id: 'f', target: 'blk', radius: 1, edges: {} });
  const m = await buildModel(b.toJSON());
  assert.match(m.report.steps.find((s) => s.id === 'f')?.error ?? '', /Empty edge selector/);
});

test('holes warn when they start inside the material or in empty space (instead of silently doing less)', async () => {
  await initKernel();
  const drill = async (at: number[], direction: string, extra: object = {}) => {
    const b = new ModelBuilder();
    b.add({ op: 'box', id: 'blk', w: 60, d: 40, h: 20, at: [0, 0, 10] }); // top face z = 20
    b.add({ op: 'hole', id: 'h', target: 'blk', at, direction, diameter: 5, ...extra } as never);
    const m = await buildModel(b.toJSON());
    return m.report.steps.find((s) => s.id === 'h');
  };
  const good = await drill([0, 0, 20], '-Z');
  assert.doesNotMatch(good?.note ?? '', /WARNING/);

  const inside = await drill([0, 0, 12], '-Z', { depth: 5 });
  assert.match(inside?.note ?? '', /WARNING: hole 1 starts INSIDE the material at \(0, 0, 12\)/);

  const air = await drill([0, 0, 30], '-Z', { depth: 5 });
  assert.match(air?.note ?? '', /WARNING: hole 1 starts in empty space/);

  const wrongWay = await drill([0, 0, 20], '+Z');
  assert.match(
    wrongWay?.note ?? '',
    /is on the surface .* but drills away from the part .* flip the direction/,
  );

  // the part is still drilled as asked (a warning, not a failure)
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'blk', w: 60, d: 40, h: 20, at: [0, 0, 10] });
  b.add({ op: 'hole', target: 'blk', at: [0, 0, 12], direction: '-Z', diameter: 5, depth: 5 });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok);
  close(m.report.bodies.blk?.volume ?? 0, 60 * 40 * 20 - Math.PI * 6.25 * 5);

  // warnings are per start point
  const many = await drill(
    [
      [10, 0, 20],
      [-10, 0, 14],
    ] as never,
    '-Z',
    { depth: 4 },
  );
  assert.match(many?.note ?? '', /hole 2 starts INSIDE/);
  assert.doesNotMatch(many?.note ?? '', /hole 1 starts/);
});
