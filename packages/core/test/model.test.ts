// Model core tests: timeline -> geometry, checked against closed-form answers, plus the golden
// test that script mode and tool-call mode produce the same timeline and the same geometry.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel, compileScript, initKernel, ModelBuilder } from '../src/index.ts';

const close = (a: number, b: number, tol = 1e-3) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

test('init', async () => {
  await initKernel();
});

test('box primitive: volume, area, centre of mass, bbox', async () => {
  const b = new ModelBuilder('box');
  b.add({ op: 'box', id: 'b', w: 40, d: 20, h: 10, at: [5, 0, 0] });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok);
  const info = m.report.bodies.b;
  assert.ok(info);
  close(info.volume, 8000);
  close(info.area, 2 * (800 + 400 + 200));
  assert.deepEqual(info.centerOfMass.map(Math.round), [5, 0, 0]);
  assert.deepEqual(info.bbox.size, [40, 20, 10]);
});

test('cylinder and sphere analytic volumes', async () => {
  const b = new ModelBuilder();
  b.add({ op: 'cylinder', id: 'c', r: 5, h: 12, axis: 'X' });
  b.add({ op: 'sphere', id: 's', r: 3, at: [20, 0, 0] });
  const m = await buildModel(b.toJSON());
  close(m.report.bodies.c?.volume ?? 0, Math.PI * 25 * 12);
  close(m.report.bodies.s?.volume ?? 0, (4 / 3) * Math.PI * 27);
  // cylinder along X is centred on `at` (origin): spans x in [-6, 6]
  assert.deepEqual(m.report.bodies.c?.bbox.min.map(Math.round), [-6, -5, -5]);
});

test('bracket: rounded rectangle plate with cut holes (analytic volume)', async () => {
  const b = new ModelBuilder('bracket');
  b.param('t', 6);
  const sk = b.add({
    op: 'sketch',
    plane: 'XY',
    profile: [
      { shape: 'rect', w: 60, h: 40, cornerRadius: 3 },
      ...[
        [-22, -12],
        [22, -12],
        [-22, 12],
        [22, 12],
      ].map(([cx, cy]) => ({
        shape: 'circle' as const,
        r: 2.5,
        cx: cx as number,
        cy: cy as number,
        cut: true,
      })),
    ],
  });
  b.add({ op: 'extrude', id: 'plate', sketch: sk, distance: 't' });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  const area = 60 * 40 - 4 * (1 - Math.PI / 4) * 9 - 4 * Math.PI * 6.25;
  close(m.report.bodies.plate?.volume ?? 0, area * 6, 1e-2);
});

test('fillet with selector count assertion', async () => {
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'b', w: 40, d: 20, h: 10 });
  b.add({ op: 'fillet', target: 'b', radius: 3, edges: { direction: 'Z', expect: 4 } });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.b?.volume ?? 0, 8000 - 4 * (1 - Math.PI / 4) * 9 * 10);
});

test('wrong selector count fails the step with a clear message, later steps are skipped', async () => {
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'b', w: 40, d: 20, h: 10 });
  b.add({ op: 'fillet', id: 'f1', target: 'b', radius: 3, edges: { direction: 'Z', expect: 6 } });
  b.add({ op: 'chamfer', id: 'c1', target: 'b', distance: 1, edges: { all: true } });
  const m = await buildModel(b.toJSON());
  assert.equal(m.report.ok, false);
  const f1 = m.report.steps.find((s) => s.id === 'f1');
  assert.equal(f1?.status, 'error');
  assert.match(f1?.error ?? '', /matched 4 but expected 6/);
  assert.equal(m.report.steps.find((s) => s.id === 'c1')?.status, 'skipped');
});

test('empty selector is rejected with guidance', async () => {
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'b', w: 10, d: 10, h: 10 });
  b.add({ op: 'fillet', id: 'f', target: 'b', radius: 1, edges: {} });
  const m = await buildModel(b.toJSON());
  assert.match(m.report.steps.find((s) => s.id === 'f')?.error ?? '', /Empty edge selector/);
});

test('shell hollows a box (open top)', async () => {
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'b', w: 40, d: 20, h: 10 });
  b.add({
    op: 'shell',
    target: 'b',
    thickness: 2,
    faces: { plane: { name: 'XY', offset: 5 }, expect: 1 },
  });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  // open box: outer - inner cavity (36 x 16 x 8)
  close(m.report.bodies.b?.volume ?? 0, 8000 - 36 * 16 * 8, 1e-2);
});

test('booleans: union of overlapping boxes, cut of a cylinder', async () => {
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'a', w: 10, d: 10, h: 10 });
  b.add({ op: 'box', id: 'b', w: 10, d: 10, h: 10, at: [5, 0, 0] });
  b.add({ op: 'boolean', id: 'u', kind: 'union', a: 'a', b: 'b' });
  b.add({ op: 'cylinder', id: 'hole', r: 2, h: 20 });
  b.add({ op: 'boolean', id: 'part', kind: 'cut', a: 'u', b: 'hole' });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  assert.deepEqual([...m.bodies.keys()], ['part']); // inputs are consumed
  // union is 15 x 10 x 10; a through-hole r=2 along Z at the origin removes pi r^2 * 10
  close(m.report.bodies.part?.volume ?? 0, 1500 - Math.PI * 4 * 10, 1e-2);
});

test('transform moves and rotates a body', async () => {
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'b', w: 20, d: 10, h: 10 });
  b.add({ op: 'transform', target: 'b', rotate: { angle: 90, axis: 'Z' }, translate: [0, 0, 100] });
  const m = await buildModel(b.toJSON());
  const info = m.report.bodies.b;
  assert.deepEqual(info?.bbox.size.map(Math.round), [10, 20, 10]); // rotated 90 degrees about Z
  assert.equal(Math.round(info?.centerOfMass[2] ?? 0), 100);
});

test('parameters: expressions, dependencies, and parametric rebuild', async () => {
  const b = new ModelBuilder();
  b.param('w', 40).param('half', 'w / 2').param('h', 10);
  b.add({ op: 'box', id: 'b', w: 'w', d: 'half', h: 'h' });
  const v1 = (await buildModel(b.toJSON())).report.bodies.b?.volume ?? 0;
  close(v1, 40 * 20 * 10);
  b.param('w', 80); // change one parameter, everything dependent follows
  const v2 = (await buildModel(b.toJSON())).report.bodies.b?.volume ?? 0;
  close(v2, 80 * 40 * 10);
});

test('parameter cycles and unknown names are reported, not thrown', async () => {
  const b = new ModelBuilder();
  b.param('a', 'b + 1').param('b', 'a + 1');
  b.add({ op: 'box', w: 1, d: 1, h: 1 });
  const m = await buildModel(b.toJSON());
  assert.equal(m.report.ok, false);
  assert.match(m.report.steps[0]?.error ?? '', /cycle/i);
});

test('builder validates early with readable errors', () => {
  const b = new ModelBuilder();
  assert.throws(() => b.add({ op: 'box', w: 1, d: 1 }), /Invalid step/);
  assert.throws(
    () => b.add({ op: 'extrude', sketch: 'nope', distance: 1 }),
    /Unknown sketch "nope"/,
  );
  assert.throws(() => b.add({ op: 'warp' }), /Invalid step/);
  b.add({ op: 'box', id: 'x', w: 1, d: 1, h: 1 });
  assert.throws(() => b.add({ op: 'box', id: 'x', w: 1, d: 1, h: 1 }), /already exists/);
  assert.throws(() => b.param('bad name', 1), /Bad parameter name/);
});

test('timeline round-trips through JSON', async () => {
  const b = new ModelBuilder('rt');
  b.param('w', 10);
  b.add({ op: 'box', id: 'b', w: 'w', d: 5, h: 5 });
  const json = JSON.parse(JSON.stringify(b.toJSON()));
  const b2 = ModelBuilder.fromJSON(json);
  assert.deepEqual(b2.toJSON(), b.toJSON());
  assert.throws(() => ModelBuilder.fromJSON({ version: 99 }), /Invalid timeline/);
});

test('suppressing a step removes it from the build', async () => {
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'b', w: 10, d: 10, h: 10 });
  b.add({ op: 'sphere', id: 's', r: 5 });
  b.suppress('s');
  const m = await buildModel(b.toJSON());
  assert.deepEqual([...m.bodies.keys()], ['b']);
  assert.equal(m.report.steps.find((s) => s.id === 's')?.status, 'suppressed');
});

// ---- extra selector / extrude-cut coverage ----------------------------------------------------
test('box selector picks edges by region (top edges of a box)', async () => {
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'b', w: 40, d: 20, h: 10 });
  b.add({
    op: 'chamfer',
    target: 'b',
    distance: 1,
    edges: { box: { min: [-100, -100, 4.9], max: [100, 100, 5.1] }, expect: 4 },
  });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  // Exact: the top 1 mm is a prism whose cross-section shrinks linearly, so the kept volume there is
  // integral_0^1 (40-2s)(20-2s) ds = 800 - 60 + 4/3, and 58.667 mm^3 is removed from 8000.
  close(m.report.bodies.b?.volume ?? 0, 8000 - (800 - (800 - 60 + 4 / 3)), 1e-2);
});

test('extrude mode "cut" drills a hole in a target body', async () => {
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'blk', w: 40, d: 40, h: 10 });
  const hole = b.add({
    op: 'sketch',
    plane: 'XY',
    offset: -5,
    profile: [{ shape: 'circle', r: 4 }],
  });
  b.add({ op: 'extrude', sketch: hole, distance: 10, mode: 'cut', target: 'blk' });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.blk?.volume ?? 0, 16000 - Math.PI * 16 * 10, 1e-2);
});

test('symmetric extrude is centred on the sketch plane', async () => {
  const b = new ModelBuilder();
  const s = b.add({ op: 'sketch', plane: 'XY', profile: [{ shape: 'rect', w: 10, h: 10 }] });
  b.add({ op: 'extrude', id: 'e', sketch: s, distance: 20, symmetric: true });
  const m = await buildModel(b.toJSON());
  assert.deepEqual(m.report.bodies.e?.bbox.min, [-5, -5, -10]);
  assert.deepEqual(m.report.bodies.e?.bbox.max, [5, 5, 10]);
});

// ---- the golden test: script mode == tool-call mode ----------------------------------------------
test('GOLDEN: a script and equivalent tool calls give identical timelines and geometry', async () => {
  const script = `
    param('w', 40);
    param('t', 8);
    const s = sketch({ id: 'base', plane: 'XY', profile: [{ shape: 'rect', w: 'w', h: 20 }] });
    extrude({ id: 'body', sketch: s, distance: 't' });
    fillet({ id: 'round', target: 'body', radius: 2, edges: { direction: 'Z', expect: 4 } });
    const h = sketch({ id: 'hole', plane: 'XY', offset: -1, profile: [{ shape: 'circle', r: 3 }] });
    extrude({ id: 'drill', sketch: h, distance: 't + 2', mode: 'cut', target: 'body' });
  `;
  const fromScript = compileScript(script, { name: 'golden' });

  const b = new ModelBuilder('golden');
  b.param('w', 40).param('t', 8);
  const s = b.add({
    op: 'sketch',
    id: 'base',
    plane: 'XY',
    profile: [{ shape: 'rect', w: 'w', h: 20 }],
  });
  b.add({ op: 'extrude', id: 'body', sketch: s, distance: 't' });
  b.add({
    op: 'fillet',
    id: 'round',
    target: 'body',
    radius: 2,
    edges: { direction: 'Z', expect: 4 },
  });
  const h = b.add({
    op: 'sketch',
    id: 'hole',
    plane: 'XY',
    offset: -1,
    profile: [{ shape: 'circle', r: 3 }],
  });
  b.add({ op: 'extrude', id: 'drill', sketch: h, distance: 't + 2', mode: 'cut', target: 'body' });

  assert.deepEqual(fromScript, b.toJSON());

  const [m1, m2] = await Promise.all([buildModel(fromScript), buildModel(b.toJSON())]);
  assert.ok(m1.report.ok, JSON.stringify(m1.report.steps));
  assert.deepEqual(m1.report.bodies, m2.report.bodies);
  // and the answer is right, not just consistent: plate - rounded corners - hole
  const expected = (40 * 20 - 4 * (1 - Math.PI / 4) * 4 - Math.PI * 9) * 8;
  close(m1.report.bodies.body?.volume ?? 0, expected, 1e-2);
});

// ---- script sandbox behaviour ---------------------------------------------------------------------
test('script: host objects and code generation are unreachable', () => {
  assert.throws(() => compileScript('process.exit(1)'), /Script failed/);
  assert.throws(() => compileScript('require("fs")'), /Script failed/);
  assert.throws(() => compileScript('eval("1+1")'), /Script failed/);
  assert.throws(
    () => compileScript('this.constructor.constructor("return process")()'),
    /Script failed/,
  );
  assert.throws(() => compileScript('box.constructor("return process")()'), /Script failed/);
});

test('script: infinite loops are stopped by the timeout', () => {
  assert.throws(() => compileScript('while (true) {}', { timeoutMs: 100 }), /Script failed/);
});

test('script: validation errors surface with the same readable messages', () => {
  assert.throws(() => compileScript('box({ w: 1 })'), /Invalid step/);
  assert.throws(
    () => compileScript("extrude({ sketch: 'ghost', distance: 1 })"),
    /Unknown sketch "ghost"/,
  );
});

test('revolve: full ring, partial angle, and cut mode match closed-form volumes', async () => {
  const ring = (angle?: number) => {
    const b = new ModelBuilder();
    const s = b.add({
      op: 'sketch',
      plane: 'XZ',
      profile: [{ shape: 'rect', w: 10, h: 30, cx: 15, cy: 15 }],
    });
    b.add({ op: 'revolve', id: 'r', sketch: s, axis: 'Z', ...(angle ? { angle } : {}) });
    return b;
  };
  const full = await buildModel(ring().toJSON());
  assert.ok(full.report.ok, JSON.stringify(full.report.steps));
  close(full.report.bodies.r?.volume ?? 0, Math.PI * (20 ** 2 - 10 ** 2) * 30, 1e-2);
  assert.deepEqual(full.report.bodies.r?.bbox.size, [40, 40, 30]);

  const half = await buildModel(ring(180).toJSON());
  close(half.report.bodies.r?.volume ?? 0, (Math.PI * (20 ** 2 - 10 ** 2) * 30) / 2, 1e-2);
  const viaParam = new ModelBuilder().param('a', 90);
  const s = viaParam.add({
    op: 'sketch',
    plane: 'XZ',
    profile: [{ shape: 'rect', w: 10, h: 30, cx: 15, cy: 15 }],
  });
  viaParam.add({ op: 'revolve', id: 'q', sketch: s, axis: 'Z', angle: 'a' });
  close(
    (await buildModel(viaParam.toJSON())).report.bodies.q?.volume ?? 0,
    (Math.PI * 300 * 30) / 4,
    1e-2,
  );

  // cut mode: bore a hole with a revolved profile that touches the axis
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'blk', w: 50, d: 50, h: 30, at: [0, 0, 15] });
  const hole = b.add({
    op: 'sketch',
    plane: 'XZ',
    profile: [{ shape: 'rect', w: 10, h: 30, cx: 5, cy: 15 }],
  });
  b.add({ op: 'revolve', sketch: hole, axis: 'Z', mode: 'cut', target: 'blk' });
  const cut = await buildModel(b.toJSON());
  assert.ok(cut.report.ok, JSON.stringify(cut.report.steps));
  close(cut.report.bodies.blk?.volume ?? 0, 50 * 50 * 30 - Math.PI * 100 * 30, 1e-2);
});

test('revolve validates its inputs', async () => {
  const b = new ModelBuilder();
  assert.throws(() => b.add({ op: 'revolve', sketch: 'nope', axis: 'Z' }), /Unknown sketch "nope"/);
  assert.throws(() => b.add({ op: 'revolve', sketch: 's', axis: 'W' }), /Invalid step/);
  const s = b.add({
    op: 'sketch',
    plane: 'XZ',
    profile: [{ shape: 'rect', w: 10, h: 30, cx: 15, cy: 15 }],
  });
  b.add({ op: 'revolve', id: 'bad', sketch: s, axis: 'Z', angle: 400 });
  const m = await buildModel(b.toJSON());
  assert.match(m.report.steps.find((x) => x.id === 'bad')?.error ?? '', /between 0 and 360/);
  const noTarget = new ModelBuilder();
  const s2 = noTarget.add({
    op: 'sketch',
    plane: 'XZ',
    profile: [{ shape: 'rect', w: 10, h: 30, cx: 15, cy: 15 }],
  });
  noTarget.add({ op: 'revolve', id: 'x', sketch: s2, axis: 'Z', mode: 'cut' });
  const m2 = await buildModel(noTarget.toJSON());
  assert.match(m2.report.steps.find((x) => x.id === 'x')?.error ?? '', /needs a target/);
});

test('loft matches closed-form frustum, cone-frustum, prism and 3-section volumes', async () => {
  const loft = async (
    sections: { shape: 'rect' | 'circle'; w?: number; h?: number; r?: number }[],
    ruled?: boolean,
  ) => {
    const b = new ModelBuilder();
    const ids = sections.map((s, i) =>
      b.add({ op: 'sketch', plane: 'XY', offset: i * 10, profile: [s] }),
    );
    b.add({ op: 'loft', id: 'l', sketches: ids, ...(ruled === undefined ? {} : { ruled }) });
    const m = await buildModel(b.toJSON());
    assert.ok(m.report.ok, JSON.stringify(m.report.steps));
    return m.report.bodies.l;
  };
  const r = (w: number) => ({ shape: 'rect' as const, w, h: w });
  close((await loft([r(20), r(10)], true))?.volume ?? 0, (10 / 3) * (400 + 100 + 200), 1e-2);
  close(
    (
      await loft([
        { shape: 'circle', r: 10 },
        { shape: 'circle', r: 5 },
      ])
    )?.volume ?? 0,
    ((Math.PI * 10) / 3) * (100 + 50 + 25),
    1e-2,
  );
  close((await loft([r(20), r(20)]))?.volume ?? 0, 4000, 1e-2);
  const three = await loft([r(20), r(10), r(20)], true);
  close(three?.volume ?? 0, 2 * (10 / 3) * (400 + 100 + 200), 1e-2);
  assert.deepEqual(three?.bbox.size, [20, 20, 20]);
});

test('loft: round-to-square adapter is a valid solid; validation and cut mode', async () => {
  const b = new ModelBuilder();
  const a = b.add({ op: 'sketch', plane: 'XY', profile: [{ shape: 'circle', r: 10 }] });
  const c = b.add({
    op: 'sketch',
    plane: 'XY',
    offset: 20,
    profile: [{ shape: 'rect', w: 16, h: 16 }],
  });
  b.add({ op: 'loft', id: 'adapter', sketches: [a, c] });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  const v = m.report.bodies.adapter?.volume ?? 0;
  assert.ok(v > Math.PI * 100 * 20 * 0.6 && v < 16 * 16 * 20 * 1.3, `volume ${v}`); // between the two prisms' scale

  const bad = new ModelBuilder();
  const s = bad.add({ op: 'sketch', plane: 'XY', profile: [{ shape: 'circle', r: 5 }] });
  assert.throws(() => bad.add({ op: 'loft', sketches: [s] }), /Invalid step/);
  assert.throws(() => bad.add({ op: 'loft', sketches: [s, 'ghost'] }), /Unknown sketch "ghost"/);

  const cut = new ModelBuilder();
  cut.add({ op: 'box', id: 'blk', w: 40, d: 40, h: 10, at: [0, 0, 5] });
  const top = cut.add({
    op: 'sketch',
    plane: 'XY',
    offset: 10,
    profile: [{ shape: 'circle', r: 10 }],
  });
  const bottom = cut.add({
    op: 'sketch',
    plane: 'XY',
    offset: 0,
    profile: [{ shape: 'circle', r: 5 }],
  });
  cut.add({ op: 'loft', sketches: [top, bottom], mode: 'cut', target: 'blk' });
  const mc = await buildModel(cut.toJSON());
  assert.ok(mc.report.ok, JSON.stringify(mc.report.steps));
  close(mc.report.bodies.blk?.volume ?? 0, 16000 - ((Math.PI * 10) / 3) * (100 + 50 + 25), 1e-2); // countersink
});
