import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel, compileScript, initKernel, ModelBuilder } from '../src/index.ts';

const close = (a: number, b: number, tol = 1e-2) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);
type Pt = [number, number, number];

async function sweep(profile: object[], points: Pt[], bendRadius?: number) {
  await initKernel();
  const b = new ModelBuilder();
  const s = b.add({ op: 'sketch', plane: 'XY', profile } as never);
  b.add({
    op: 'sweep',
    id: 'pipe',
    sketch: s,
    path: { points, ...(bendRadius === undefined ? {} : { bendRadius }) },
  });
  const m = await buildModel(b.toJSON());
  return { m, step: m.report.steps.find((x) => x.id === 'pipe'), body: m.report.bodies.pipe };
}

test('bent pipe: volume = profile area x centre-line length (Pappus), 90 degree bend radius 10', async () => {
  const { m, body } = await sweep(
    [{ shape: 'circle', r: 3 }],
    [
      [0, 0, 0],
      [30, 0, 0],
      [30, 30, 0],
    ],
    10,
  );
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  const length = 20 + (Math.PI / 2) * 10 + 20;
  close(body?.volume ?? 0, Math.PI * 9 * length);
});

test('straight sweeps equal extrudes and the profile is oriented predictably', async () => {
  // path along +Z: profile x -> world X, profile y -> world Y
  const up = await sweep(
    [{ shape: 'rect', w: 10, h: 4 }],
    [
      [0, 0, 0],
      [0, 0, 25],
    ],
  );
  assert.ok(up.m.report.ok, JSON.stringify(up.m.report.steps));
  close(up.body?.volume ?? 0, 1000);
  assert.deepEqual(up.body?.bbox.size, [10, 4, 25]);
  // path along +X: profile x -> world Y, profile y -> world Z
  const along = await sweep(
    [{ shape: 'rect', w: 10, h: 4 }],
    [
      [0, 0, 0],
      [30, 0, 0],
    ],
  );
  assert.deepEqual(along.body?.bbox.size, [30, 10, 4]);
  close(along.body?.volume ?? 0, 1200);
});

test('a 3D path with two bends (not in one plane) follows Pappus too', async () => {
  const { m, body } = await sweep(
    [{ shape: 'circle', r: 2 }],
    [
      [0, 0, 0],
      [20, 0, 0],
      [20, 20, 0],
      [20, 20, 20],
    ],
    4,
  );
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  const length = 16 + 12 + 16 + 2 * ((Math.PI / 2) * 4);
  close(body?.volume ?? 0, Math.PI * 4 * length);
});

test('sweep cut: a curved channel through a block removes pipe volume', async () => {
  await initKernel();
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'blk', w: 60, d: 60, h: 20, at: [30, 30, 0] });
  const s = b.add({ op: 'sketch', plane: 'XY', profile: [{ shape: 'circle', r: 3 }] });
  b.add({
    op: 'sweep',
    sketch: s,
    mode: 'cut',
    target: 'blk',
    path: {
      points: [
        [-1, 30, 0],
        [30, 30, 0],
        [30, 61, 0],
      ],
      bendRadius: 8,
    },
  });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  // the channel is 31 + 31 long minus the corner saving 2*8 - (pi/2)*8, all inside the block's 60 x 60 footprint
  const centreLine = 31 - 8 + (Math.PI / 2) * 8 + (31 - 8);
  const inside = centreLine - 1 - 1; // 1 mm stick-out at each end lies outside the block
  close(m.report.bodies.blk?.volume ?? 0, 60 * 60 * 20 - Math.PI * 9 * inside, 0.5);
});

test('helpful errors: bend too large, hollow profile, doubling back, unknown sketch', async () => {
  const tight = await sweep(
    [{ shape: 'circle', r: 2 }],
    [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ],
    12,
  );
  assert.match(tight.step?.error ?? '', /too large for the path/);
  const hollow = await sweep(
    [
      { shape: 'circle', r: 5 },
      { shape: 'circle', r: 4, cut: true },
    ],
    [
      [0, 0, 0],
      [0, 0, 20],
    ],
  );
  assert.match(hollow.step?.error ?? '', /single closed outline/);
  const back = await sweep(
    [{ shape: 'circle', r: 1 }],
    [
      [0, 0, 0],
      [10, 0, 0],
      [0, 0, 0],
    ],
    2,
  );
  assert.match(back.step?.error ?? '', /doubles back/);
  const b = new ModelBuilder();
  assert.throws(
    () =>
      b.add({
        op: 'sweep',
        sketch: 'ghost',
        path: {
          points: [
            [0, 0, 0],
            [1, 0, 0],
          ],
        },
      }),
    /Unknown sketch "ghost"/,
  );
  assert.throws(
    () => b.add({ op: 'sweep', sketch: 'ghost', path: { points: [[0, 0, 0]] } }),
    /Invalid step/,
  );
});

test('parameters in path points and bend radius, and script mode', async () => {
  await initKernel();
  const tl = compileScript(`
    param('len', 40);
    param('r', 5);
    const s = sketch({ plane: 'XY', profile: [{ shape: 'circle', r: 2 }] });
    sweep({ id: 'pipe', sketch: s, path: { points: [[0,0,0],['len',0,0],['len','len',0]], bendRadius: 'r' } });
  `);
  const m = await buildModel(tl);
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.pipe?.volume ?? 0, Math.PI * 4 * (40 - 5 + (Math.PI / 2) * 5 + (40 - 5)));
});
