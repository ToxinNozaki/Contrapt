import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel, compileScript, initKernel, ModelBuilder, SCREWS } from '../src/index.ts';

const close = (a: number, b: number, tol = 1e-2) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);
const BLOCK = 60 * 40 * 20; // centred in X/Y, z from 0 to 20
const circle = (d: number, len: number) => Math.PI * (d / 2) ** 2 * len;

async function drill(hole: object, build?: (b: ModelBuilder) => void) {
  await initKernel();
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'blk', w: 60, d: 40, h: 20, at: [0, 0, 10] });
  build?.(b);
  b.add({ op: 'hole', id: 'h', target: 'blk', ...hole } as never);
  const m = await buildModel(b.toJSON());
  return {
    m,
    step: m.report.steps.find((s) => s.id === 'h'),
    vol: m.report.bodies.blk?.volume ?? 0,
  };
}

test('plain holes from standard screw sizes: clearance, close and tap drill', async () => {
  for (const [fit, d] of [
    ['normal', 4.5],
    ['close', 4.3],
    ['tap', 3.3],
  ] as const) {
    const { m, step, vol } = await drill({ at: [0, 0, 20], size: 'M4', fit });
    assert.ok(m.report.ok, JSON.stringify(m.report.steps));
    close(vol, BLOCK - circle(d, 20));
    assert.match(step?.note ?? '', new RegExp(`Ø${d}`));
  }
  assert.equal(SCREWS.M4.clearance, 4.5);
});

test('counterbore sized for the screw head, countersink cone, and blind depth', async () => {
  const cb = await drill({ at: [0, 0, 20], size: 'M4', counterbore: true });
  assert.ok(cb.m.report.ok, JSON.stringify(cb.m.report.steps));
  // head 7 + 0.5 = 7.5 wide, 4 + 0.3 = 4.3 deep; the 4.5 hole continues through the rest
  close(cb.vol, BLOCK - circle(7.5, 4.3) - circle(4.5, 20 - 4.3));

  const cs = await drill({ at: [0, 0, 20], size: 'M4', countersink: true });
  assert.ok(cs.m.report.ok, JSON.stringify(cs.m.report.steps));
  // 90 degree countersink to diameter 8: cone depth (4 - 2.25) / tan 45 = 1.75, a frustum from r=4 down to r=2.25
  const cone = ((Math.PI * 1.75) / 3) * (4 ** 2 + 4 * 2.25 + 2.25 ** 2);
  close(cs.vol, BLOCK - cone - circle(4.5, 20 - 1.75));

  const blind = await drill({ at: [0, 0, 20], diameter: 6, depth: 8 });
  close(blind.vol, BLOCK - circle(6, 8));
  assert.match(blind.step?.note ?? '', /8 deep/);
});

test('every drilling direction removes exactly pi r^2 L (so each orientation is right)', async () => {
  const d = 5;
  const cases: [string, number[], number][] = [
    ['-Z', [10, 5, 20], 20],
    ['+Z', [10, 5, 0], 20],
    ['-X', [30, 5, 10], 60],
    ['+X', [-30, 5, 10], 60],
    ['-Y', [5, 20, 10], 40],
    ['+Y', [5, -20, 10], 40],
  ];
  for (const [direction, at, length] of cases) {
    const { m, vol } = await drill({ at, direction, diameter: d });
    assert.ok(m.report.ok, `${direction}: ${JSON.stringify(m.report.steps)}`);
    close(vol, BLOCK - circle(d, length));
  }
});

test('lists of positions, linear patterns and circular patterns', async () => {
  const many = await drill({
    at: [
      [-20, 0, 20],
      [0, 0, 20],
      [20, 0, 20],
    ],
    diameter: 5,
  });
  close(many.vol, BLOCK - 3 * circle(5, 20));

  const linear = await drill({
    at: [-15, 10, 20],
    diameter: 5,
    pattern: { kind: 'linear', count: 4, step: [10, 0, 0] },
  });
  assert.ok(linear.m.report.ok, JSON.stringify(linear.m.report.steps));
  close(linear.vol, BLOCK - 4 * circle(5, 20));
  assert.match(linear.step?.note ?? '', /4 hole\(s\)/);

  const ring = await drill({
    at: [15, 0, 20],
    diameter: 5,
    pattern: { kind: 'circular', count: 6, axis: 'Z' },
  });
  assert.ok(ring.m.report.ok, JSON.stringify(ring.m.report.steps));
  close(ring.vol, BLOCK - 6 * circle(5, 20));
  assert.match(ring.step?.note ?? '', /6 hole\(s\)/);

  // spread evenly around the circle, so the part stays balanced about the Z axis
  const com = ring.m.report.bodies.blk?.centerOfMass ?? [1, 1, 1];
  close(com[0], 0, 1e-3);
  close(com[1], 0, 1e-3);
});

test('hole validation', async () => {
  const noSize = await drill({ at: [0, 0, 20] });
  assert.match(noSize.step?.error ?? '', /needs a "size"/);
  const both = await drill({ at: [0, 0, 20], size: 'M4', counterbore: true, countersink: true });
  assert.match(both.step?.error ?? '', /counterbore or a countersink/);
  const noHead = await drill({ at: [0, 0, 20], diameter: 5, counterbore: true });
  assert.match(noHead.step?.error ?? '', /counterbore needs a screw "size"/);
  const tooDeep = await drill({ at: [0, 0, 20], size: 'M4', depth: 3, counterbore: true });
  assert.match(tooDeep.step?.error ?? '', /counterbore depth must be less/);
  const b = new ModelBuilder();
  assert.throws(
    () => b.add({ op: 'hole', target: 'ghost', at: [0, 0, 0], diameter: 3 }),
    /Unknown body "ghost"/,
  );
  b.add({ op: 'box', id: 'x', w: 1, d: 1, h: 1 });
  assert.throws(
    () => b.add({ op: 'hole', target: 'x', at: [0, 0, 0], size: 'M7' }),
    /Invalid step/,
  );
});

test('pattern step: repeat a tool body to cut or add, consuming the tool', async () => {
  await initKernel();
  const cut = new ModelBuilder();
  cut.add({ op: 'box', id: 'blk', w: 60, d: 40, h: 20, at: [0, 0, 10] });
  cut.add({ op: 'cylinder', id: 'tool', r: 2, h: 30, at: [-10, 0, 10] });
  cut.add({
    op: 'pattern',
    target: 'blk',
    tool: 'tool',
    pattern: { kind: 'linear', count: 3, step: [10, 0, 0] },
    mode: 'cut',
  });
  const m = await buildModel(cut.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.blk?.volume ?? 0, BLOCK - 3 * circle(4, 20));
  assert.deepEqual([...m.bodies.keys()], ['blk']); // the tool is consumed

  const add = new ModelBuilder();
  add.add({ op: 'cylinder', id: 'base', r: 30, h: 4 }); // z from -2 to 2
  add.add({ op: 'cylinder', id: 'peg', r: 2, h: 10, at: [20, 0, 7] }); // z from 2 to 12, standing on the base
  add.add({
    op: 'pattern',
    target: 'base',
    tool: 'peg',
    pattern: { kind: 'circular', count: 4, axis: 'Z' },
    mode: 'add',
  });
  const ma = await buildModel(add.toJSON());
  assert.ok(ma.report.ok, JSON.stringify(ma.report.steps));
  close(ma.report.bodies.base?.volume ?? 0, circle(60, 4) + 4 * circle(4, 10));

  const b = new ModelBuilder();
  assert.throws(
    () =>
      b.add({
        op: 'pattern',
        target: 'a',
        tool: 'b',
        pattern: { kind: 'linear', count: 1, step: [1, 0, 0] },
        mode: 'cut',
      }),
    /Invalid step|Unknown/,
  );
});

test('mirror: add makes a symmetric part, new makes a separate body, offset moves the plane', async () => {
  await initKernel();
  const half = () => {
    const b = new ModelBuilder();
    b.add({ op: 'box', id: 'h', w: 20, d: 10, h: 10, at: [10, 0, 5] }); // x from 0 to 20
    return b;
  };
  const sym = half();
  sym.add({ op: 'mirror', target: 'h', axis: 'X' });
  const m = await buildModel(sym.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.h?.volume ?? 0, 2 * 2000);
  assert.deepEqual(m.report.bodies.h?.bbox.size, [40, 10, 10]);

  const sep = half();
  sep.add({ op: 'mirror', id: 'copy', target: 'h', axis: 'X', offset: 30, mode: 'new' });
  const m2 = await buildModel(sep.toJSON());
  assert.ok(m2.report.ok, JSON.stringify(m2.report.steps));
  assert.deepEqual([...m2.bodies.keys()].sort(), ['copy', 'h']);
  assert.deepEqual(m2.report.bodies.copy?.bbox.min, [40, -5, 0]); // x -> 60 - x, so 0..20 becomes 40..60
  assert.deepEqual(m2.report.bodies.copy?.bbox.max, [60, 5, 10]);
});

test('hole with a pattern works from scripts', async () => {
  await initKernel();
  const tl = compileScript(`
    param('d', 5);
    box({ id: 'blk', w: 60, d: 40, h: 20, at: [0, 0, 10] });
    hole({ target: 'blk', at: [15, 0, 20], diameter: 'd', pattern: { kind: 'circular', count: 6, axis: 'Z' } });
  `);
  const m = await buildModel(tl);
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.blk?.volume ?? 0, BLOCK - 6 * circle(5, 20));
});
