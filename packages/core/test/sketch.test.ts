import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { buildModel, compileScript, initKernel, ModelBuilder } from '../src/index.ts';
import { solverDiagnostics, solveSketch } from '../src/sketch.ts';

const close = (a: number, b: number, tol = 1e-3) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

// A rectangle described with deliberately sloppy starting points.
const rect = (w: number | string, h: number | string, extra: object[] = []) => ({
  op: 'constrained_sketch' as const,
  id: 'sk',
  plane: 'XY' as const,
  points: { A: [1, 2], B: [35, -3], C: [38, 17], D: [-2, 22] },
  lines: { AB: ['A', 'B'], BC: ['B', 'C'], CD: ['C', 'D'], DA: ['D', 'A'] },
  constraints: [
    { type: 'fix', a: 'A', at: [0, 0] },
    { type: 'horizontal', a: 'AB' },
    { type: 'vertical', a: 'BC' },
    { type: 'horizontal', a: 'CD' },
    { type: 'vertical', a: 'DA' },
    { type: 'distance', a: 'A', b: 'B', value: w },
    { type: 'distance', a: 'B', b: 'C', value: h },
    ...extra,
  ],
  profile: [{ loop: ['AB', 'BC', 'CD', 'DA'] }],
});

test('init', async () => {
  await initKernel();
});

test('a sloppy sketch snaps to exact dimensions and extrudes to the right volume', async () => {
  const b = new ModelBuilder();
  b.add(rect(40, 20));
  b.add({ op: 'extrude', id: 'part', sketch: 'sk', distance: 10 });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.part?.volume ?? 0, 8000);
  assert.deepEqual(m.report.bodies.part?.bbox.size, [40, 20, 10]);
  const sk = m.report.steps.find((s) => s.id === 'sk');
  assert.match(sk?.note ?? '', /fully constrained \(0 degrees of freedom\)/);
  const data = sk?.data as { dof: number; points: Record<string, number[]> };
  assert.equal(data.dof, 0);
  assert.deepEqual(data.points.C, [40, 20]);
});

test('dimensions can be parameters: change one number, the sketch re-solves', async () => {
  const b = new ModelBuilder().param('w', 40).param('h', 'w / 2');
  b.add(rect('w', 'h'));
  b.add({ op: 'extrude', id: 'part', sketch: 'sk', distance: 10 });
  close((await buildModel(b.toJSON())).report.bodies.part?.volume ?? 0, 40 * 20 * 10);
  b.param('w', 60);
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.part?.volume ?? 0, 60 * 30 * 10);
});

test('under-constrained sketches are reported with the degrees of freedom left', async () => {
  const b = new ModelBuilder();
  const spec = rect(40, 20);
  spec.constraints.pop(); // remove the height dimension
  b.add(spec);
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok);
  const sk = m.report.steps.find((s) => s.id === 'sk');
  assert.match(sk?.note ?? '', /under-constrained: 1 degree\(s\) of freedom left/);
  assert.equal((sk?.data as { dof: number } | undefined)?.dof, 1);
});

test('conflicting constraints fail the step and name the culprits', async () => {
  const b = new ModelBuilder();
  b.add(rect(40, 20, [{ type: 'distance', a: 'A', b: 'B', value: 50 }]));
  const m = await buildModel(b.toJSON());
  assert.equal(m.report.ok, false);
  const err = m.report.steps.find((s) => s.id === 'sk')?.error ?? '';
  assert.match(err, /Conflicting constraints/);
  assert.match(err, /#6 distance\(A, B, 40\)/);
  assert.match(err, /#8 distance\(A, B, 50\)/);
});

test('redundant constraints are harmless and reported', async () => {
  const b = new ModelBuilder();
  b.add(rect(40, 20, [{ type: 'distance', a: 'A', b: 'B', value: 40 }]));
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  assert.match(m.report.steps.find((s) => s.id === 'sk')?.note ?? '', /redundant/);
});

test('equilateral triangle: equal lengths + one side + fixed corner (area sqrt(3)/4 * s^2)', async () => {
  const b = new ModelBuilder();
  b.add({
    op: 'constrained_sketch',
    id: 'tri',
    plane: 'XY',
    points: { A: [0, 0], B: [9, 1], C: [4, 7] },
    lines: { AB: ['A', 'B'], BC: ['B', 'C'], CA: ['C', 'A'] },
    constraints: [
      { type: 'fix', a: 'A', at: [0, 0] },
      { type: 'horizontal', a: 'AB' },
      { type: 'distance', a: 'A', b: 'B', value: 10 },
      { type: 'equalLength', a: 'AB', b: 'BC' },
      { type: 'equalLength', a: 'BC', b: 'CA' },
    ],
    profile: [{ loop: ['AB', 'BC', 'CA'] }],
  });
  b.add({ op: 'extrude', id: 'prism', sketch: 'tri', distance: 5 });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.prism?.volume ?? 0, (Math.sqrt(3) / 4) * 100 * 5, 1e-2);
});

test('circles: a dimensioned hole through a constrained plate; tangency to a line', async () => {
  const b = new ModelBuilder();
  const plate = rect(40, 40);
  const holeSketch = {
    ...plate,
    points: { ...plate.points, H: [12, 9] },
    circles: { hole: { center: 'H', r: 3 } },
    constraints: [
      ...plate.constraints,
      { type: 'x', a: 'H', value: 10 },
      { type: 'y', a: 'H', value: 10 },
      { type: 'diameter', a: 'hole', value: 8 },
    ],
    profile: [{ loop: ['AB', 'BC', 'CD', 'DA'] }, { circle: 'hole', cut: true }],
  };
  b.add(holeSketch);
  b.add({ op: 'extrude', id: 'part', sketch: 'sk', distance: 5 });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.part?.volume ?? 0, (40 * 40 - Math.PI * 16) * 5, 1e-2);

  // circle tangent to the bottom edge with its centre above x=10: centre must end at y = radius
  const t = new ModelBuilder();
  t.add({
    op: 'constrained_sketch',
    id: 't',
    plane: 'XY',
    points: { P: [0, 0], Q: [20, 1], O: [9, 3] },
    lines: { PQ: ['P', 'Q'] },
    circles: { c: { center: 'O', r: 4 } },
    constraints: [
      { type: 'fix', a: 'P', at: [0, 0] },
      { type: 'horizontal', a: 'PQ' },
      { type: 'distance', a: 'P', b: 'Q', value: 20 },
      { type: 'x', a: 'O', value: 10 },
      { type: 'radius', a: 'c', value: 5 },
      { type: 'tangent', a: 'PQ', b: 'c' },
    ],
    profile: [{ circle: 'c' }],
  });
  const mt = await buildModel(t.toJSON());
  assert.ok(mt.report.ok, JSON.stringify(mt.report.steps));
  const d = mt.report.steps.find((s) => s.id === 't')?.data as {
    circles: { c: { cx: number; cy: number; r: number } };
  };
  close(d.circles.c.r, 5, 1e-4);
  close(Math.abs(d.circles.c.cy), 5, 1e-3); // tangent to y = 0
  assert.match(mt.report.steps.find((s) => s.id === 't')?.note ?? '', /fully constrained/);
});

test('angle between lines: a 60 degree wedge', async () => {
  const b = new ModelBuilder();
  b.add({
    op: 'constrained_sketch',
    id: 'w',
    plane: 'XY',
    points: { O: [0, 0], P: [10, 0.5], Q: [4, 7] },
    lines: { OP: ['O', 'P'], OQ: ['O', 'Q'], PQ: ['P', 'Q'] },
    constraints: [
      { type: 'fix', a: 'O', at: [0, 0] },
      { type: 'horizontal', a: 'OP' },
      { type: 'distance', a: 'O', b: 'P', value: 10 },
      { type: 'distance', a: 'O', b: 'Q', value: 10 },
      { type: 'angle', a: 'OP', b: 'OQ', value: 60 },
    ],
    profile: [{ loop: ['OP', 'PQ', 'OQ'] }],
  });
  b.add({ op: 'extrude', id: 'e', sketch: 'w', distance: 2 });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.e?.volume ?? 0, 0.5 * 10 * 10 * Math.sin(Math.PI / 3) * 2, 1e-2);
});

test('helpful validation messages', async () => {
  const run = async (mut: (s: ReturnType<typeof rect>) => void) => {
    const spec = rect(40, 20);
    mut(spec);
    const b = new ModelBuilder();
    b.add(spec);
    const m = await buildModel(b.toJSON());
    return m.report.steps.find((s) => s.id === 'sk')?.error ?? '';
  };
  assert.match(
    await run((s) => s.constraints.push({ type: 'distance', a: 'A', b: 'Z', value: 1 })),
    /"Z" is not defined/,
  );
  assert.match(
    await run((s) => s.constraints.push({ type: 'distance', a: 'A', b: 'AB', value: 1 })),
    /"AB" is a line, expected a point/,
  );
  assert.match(
    await run((s) => s.constraints.push({ type: 'distance', a: 'A', b: 'B' } as never)),
    /needs a numeric "value"/,
  );
  assert.match(
    await run((s) => (s.profile = [{ loop: ['AB', 'CD', 'BC'] }])),
    /not connected|does not close/,
  );
  assert.match(await run((s) => (s.profile = [{ loop: ['AB', 'BC', 'CD'] }])), /does not close/);
  assert.match(await run((s) => (s.lines = { ...s.lines, A: ['A', 'B'] } as never)), /used twice/);
  const b = new ModelBuilder();
  assert.throws(
    () => b.add({ ...rect(1, 1), constraints: [{ type: 'wobble', a: 'A' }] }),
    /Invalid step/,
  );
});

test('works from a script too', async () => {
  const tl = compileScript(`
    param('w', 30);
    constrained_sketch({ id: 'sk', plane: 'XY',
      points: { A: [0.5, 0.5], B: [20, 1], C: [22, 9], D: [1, 11] },
      lines: { AB: ['A','B'], BC: ['B','C'], CD: ['C','D'], DA: ['D','A'] },
      constraints: [
        { type: 'fix', a: 'A', at: [0, 0] }, { type: 'horizontal', a: 'AB' }, { type: 'vertical', a: 'BC' },
        { type: 'horizontal', a: 'CD' }, { type: 'vertical', a: 'DA' },
        { type: 'distance', a: 'A', b: 'B', value: 'w' }, { type: 'distance', a: 'B', b: 'C', value: 10 } ],
      profile: [{ loop: ['AB','BC','CD','DA'] }] });
    extrude({ id: 'e', sketch: 'sk', distance: 2 });
  `);
  const m = await buildModel(tl);
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.e?.volume ?? 0, 30 * 10 * 2);
});

test('the solver never writes to stdout (MCP stdio safety), even when it complains', async () => {
  // In-process: the scenario below makes planegcs print; prove it was captured instead of lost.
  const before = solverDiagnostics().length;
  const b = new ModelBuilder();
  b.add(rect(40, 20, [{ type: 'distance', a: 'A', b: 'B', value: 50 }]));
  await buildModel(b.toJSON());
  assert.ok(
    solverDiagnostics().length > before,
    'expected the solver to print something that we captured',
  );

  // Out-of-process: nothing at all may reach stdout.
  const entry = new URL('../src/index.ts', import.meta.url).href;
  const code = `
    import { buildModel, initKernel, ModelBuilder } from ${JSON.stringify(entry)};
    await initKernel();
    const mk = (extra) => ({ op: 'constrained_sketch', id: 's', plane: 'XY',
      points: { A: [1,2], B: [35,-3], C: [38,17], D: [-2,22] },
      lines: { AB: ['A','B'], BC: ['B','C'], CD: ['C','D'], DA: ['D','A'] },
      constraints: [ { type: 'fix', a: 'A', at: [0,0] }, { type: 'horizontal', a: 'AB' }, { type: 'vertical', a: 'BC' },
        { type: 'horizontal', a: 'CD' }, { type: 'vertical', a: 'DA' },
        { type: 'distance', a: 'A', b: 'B', value: 40 }, { type: 'distance', a: 'B', b: 'C', value: 20 }, ...extra ],
      profile: [{ loop: ['AB','BC','CD','DA'] }] });
    for (const extra of [[{ type: 'distance', a: 'A', b: 'B', value: 50 }], [{ type: 'distance', a: 'A', b: 'B', value: 40 }]]) {
      const m = new ModelBuilder(); m.add(mk(extra)); await buildModel(m.toJSON());
    }
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '', `stdout must be empty, got: ${r.stdout.slice(0, 200)}`);
});

// ---- arcs ----------------------------------------------------------------------------------------
const stadium = (extra: object[]) => ({
  op: 'constrained_sketch' as const,
  id: 'sk',
  plane: 'XY' as const,
  points: {
    C1: [0.5, 0.3],
    C2: [29, -0.4],
    S1: [0.2, 5.3],
    E1: [-0.3, -4.8],
    S2: [30.4, -5.2],
    E2: [29.6, 5.5],
  },
  arcs: {
    left: { center: 'C1', start: 'S1', end: 'E1' },
    right: { center: 'C2', start: 'S2', end: 'E2' },
  },
  lines: { top: ['E2', 'S1'], bottom: ['E1', 'S2'] },
  constraints: [
    { type: 'fix', a: 'C1', at: [0, 0] },
    { type: 'horizontal', a: 'C1', b: 'C2' },
    { type: 'distance', a: 'C1', b: 'C2', value: 30 },
    { type: 'radius', a: 'left', value: 5 },
    { type: 'radius', a: 'right', value: 5 },
    { type: 'horizontal', a: 'top' },
    { type: 'horizontal', a: 'bottom' },
    ...extra,
  ],
  profile: [{ loop: ['left', 'bottom', 'right', 'top'] }],
});

test('arcs: a slot (two arcs + two lines) is under-constrained until tangents are added, then exact', async () => {
  const run = async (extra: object[]) => {
    const b = new ModelBuilder();
    b.add(stadium(extra));
    b.add({ op: 'extrude', id: 'e', sketch: 'sk', distance: 2 });
    return buildModel(b.toJSON());
  };
  const loose = await run([]);
  assert.ok(loose.report.ok, JSON.stringify(loose.report.steps));
  assert.match(
    loose.report.steps.find((s) => s.id === 'sk')?.note ?? '',
    /2 degree\(s\) of freedom/,
  );

  const tight = await run([
    { type: 'tangent', a: 'top', b: 'left' },
    { type: 'tangent', a: 'bottom', b: 'right' },
  ]);
  assert.ok(tight.report.ok, JSON.stringify(tight.report.steps));
  assert.match(tight.report.steps.find((s) => s.id === 'sk')?.note ?? '', /fully constrained/);
  close(tight.report.bodies.e?.volume ?? 0, (30 * 10 + Math.PI * 25) * 2, 1e-2);
  assert.deepEqual(tight.report.bodies.e?.bbox.size, [40, 10, 2]);
});

test('arcs: a plate with a tangent rounded corner (area = w*h - r^2 (1 - pi/4))', async () => {
  const b = new ModelBuilder();
  b.add({
    op: 'constrained_sketch',
    id: 'sk',
    plane: 'XY',
    points: {
      A: [0.4, 0.2],
      B: [39, 0.5],
      C: [40.5, 14],
      D: [34, 19.5],
      O: [35.5, 14.2],
      E: [0.3, 19],
    },
    arcs: { corner: { center: 'O', start: 'C', end: 'D' } },
    lines: { AB: ['A', 'B'], BC: ['B', 'C'], DE: ['D', 'E'], EA: ['E', 'A'] },
    constraints: [
      { type: 'fix', a: 'A', at: [0, 0] },
      { type: 'horizontal', a: 'AB' },
      { type: 'vertical', a: 'BC' },
      { type: 'horizontal', a: 'DE' },
      { type: 'vertical', a: 'EA' },
      { type: 'distance', a: 'A', b: 'B', value: 40 },
      { type: 'distance', a: 'A', b: 'E', value: 20 },
      { type: 'radius', a: 'corner', value: 5 },
      { type: 'tangent', a: 'BC', b: 'corner' },
      { type: 'tangent', a: 'DE', b: 'corner' },
    ],
    profile: [{ loop: ['AB', 'BC', 'corner', 'DE', 'EA'] }],
  });
  b.add({ op: 'extrude', id: 'p', sketch: 'sk', distance: 3 });
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  assert.match(m.report.steps.find((s) => s.id === 'sk')?.note ?? '', /fully constrained/);
  close(m.report.bodies.p?.volume ?? 0, (800 - 25 * (1 - Math.PI / 4)) * 3, 1e-2);
  const data = m.report.steps.find((s) => s.id === 'sk')?.data as {
    points: Record<string, number[]>;
  };
  assert.deepEqual(data.points.O, [35, 15]);
});

test('arcs: a loop can run clockwise (arc and lines traversed backwards), and bad loops give clear errors', async () => {
  // CB is declared C->B, so the loop CB, AB, EA, DE, corner runs clockwise: AB/EA/DE and the arc are walked in reverse.
  const plate = (loop: string[]) => ({
    op: 'constrained_sketch' as const,
    id: 'sk',
    plane: 'XY' as const,
    points: {
      A: [0.4, 0.2],
      B: [39, 0.5],
      C: [40.5, 14],
      D: [34, 19.5],
      O: [35.5, 14.2],
      E: [0.3, 19],
    },
    arcs: { corner: { center: 'O', start: 'C', end: 'D' } },
    lines: { AB: ['A', 'B'], CB: ['C', 'B'], DE: ['D', 'E'], EA: ['E', 'A'] },
    constraints: [
      { type: 'fix', a: 'A', at: [0, 0] },
      { type: 'horizontal', a: 'AB' },
      { type: 'vertical', a: 'CB' },
      { type: 'horizontal', a: 'DE' },
      { type: 'vertical', a: 'EA' },
      { type: 'distance', a: 'A', b: 'B', value: 40 },
      { type: 'distance', a: 'A', b: 'E', value: 20 },
      { type: 'radius', a: 'corner', value: 5 },
      { type: 'tangent', a: 'CB', b: 'corner' },
      { type: 'tangent', a: 'DE', b: 'corner' },
    ],
    profile: [{ loop }],
  });
  const run = async (loop: string[]) => {
    const b = new ModelBuilder();
    b.add(plate(loop));
    b.add({ op: 'extrude', id: 'e', sketch: 'sk', distance: 1 });
    return buildModel(b.toJSON());
  };
  const expected = 800 - 25 * (1 - Math.PI / 4);
  const clockwise = await run(['CB', 'AB', 'EA', 'DE', 'corner']);
  assert.ok(clockwise.report.ok, JSON.stringify(clockwise.report.steps));
  close(clockwise.report.bodies.e?.volume ?? 0, expected, 1e-2);

  const broken = await run(['CB', 'AB', 'DE']);
  assert.match(
    broken.report.steps.find((s) => s.id === 'sk')?.error ?? '',
    /not connected|does not close/,
  );
  const ghost = await run(['CB', 'nope', 'AB', 'EA', 'DE', 'corner']);
  assert.match(
    ghost.report.steps.find((s) => s.id === 'sk')?.error ?? '',
    /neither a line nor an arc/,
  );
});

test('arcs (solver level): diameter, point-on-arc and arc-to-arc tangency', async () => {
  const out = await solveSketch({
    points: {
      O: [0.2, -0.1],
      S: [10, 0.2],
      E: [0.1, 10],
      P: [6, 8.5],
      O2: [18, -2],
      S2: [10.3, 0.1],
      E2: [26, 0.3],
    },
    lines: {},
    circles: {},
    arcs: {
      a1: { center: 'O', start: 'S', end: 'E' },
      a2: { center: 'O2', start: 'E2', end: 'S2' },
    },
    constraints: [
      { type: 'fix', a: 'O', at: [0, 0] },
      { type: 'diameter', a: 'a1', value: 20 },
      { type: 'onCircle', a: 'P', b: 'a1' },
      { type: 'radius', a: 'a2', value: 8 },
      { type: 'tangent', a: 'a1', b: 'a2' },
    ],
  });
  assert.ok(out.ok, JSON.stringify(out));
  close(out.arcs.a1?.r ?? 0, 10, 1e-4); // diameter 20
  const P = out.points.P as [number, number];
  close(Math.hypot(P[0], P[1]), 10, 1e-4); // P sits on arc a1
  close(out.arcs.a2?.r ?? 0, 8, 1e-4);
  // tangent arcs: centre distance is the sum or the difference of the radii
  const d = Math.hypot(
    (out.arcs.a2?.cx ?? 0) - (out.arcs.a1?.cx ?? 0),
    (out.arcs.a2?.cy ?? 0) - (out.arcs.a1?.cy ?? 0),
  );
  assert.ok(Math.abs(d - 18) < 1e-3 || Math.abs(d - 2) < 1e-3, `centre distance ${d}`);
});
