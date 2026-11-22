import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fourBarCheck, initKernel, sweepMechanism } from '../src/index.ts';

type P2 = [number, number];
const DEG = Math.PI / 180;
const near = (a: number, b: number, tol: number, what = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b}`);

/** Coupler-rocker joint C for crank pin B and rocker pivot O4 (same branch convention as fourBarCheck). */
function joint(B: P2, O4: P2, k: number, r: number): P2 {
  const dx = O4[0] - B[0];
  const dy = O4[1] - B[1];
  const d = Math.hypot(dx, dy);
  const a = (k * k - r * r + d * d) / (2 * d);
  const h = Math.sqrt(k * k - a * a);
  const mx = B[0] + (a * dx) / d;
  const my = B[1] + (a * dy) / d;
  return [mx + (h * dy) / d, my - (h * dx) / d];
}

test('slider-crank: slider position r cos t + sqrt(l^2 - r^2 sin^2 t) at every pose, stroke = 2 r', async () => {
  await initKernel();
  const r = 30;
  const l = 100;
  const res = await sweepMechanism({
    points: { O: [0, 0], A: [r, 0], B: [r + l, 0] },
    grounds: ['O'],
    links: [{ a: 'A', b: 'B' }],
    sliders: [{ point: 'B', axis: 'y' }],
    crank: { pivot: 'O', tip: 'A', fromDeg: 0, toDeg: 360 },
    steps: 72,
    track: ['A', 'B'],
  });
  assert.equal(res.feasible, 73);
  assert.deepEqual(res.warnings, []);
  for (const p of res.poses) {
    const t = p.deg * DEG;
    const expected = r * Math.cos(t) + Math.sqrt(l * l - (r * Math.sin(t)) ** 2);
    const slider = p.tracked?.B ?? [Number.NaN, Number.NaN];
    near(slider[0], expected, 2e-3, `slider at ${p.deg}`);
    near(slider[1], 0, 1e-6);
  }
  const e = res.extents.B;
  near((e?.maxX ?? 0) - (e?.minX ?? 0), 2 * r, 5e-3, 'stroke');
  near(e?.maxX ?? 0, l + r, 5e-3);
});

test('four-bar sweep: link lengths hold, rocker swing and transmission angles match the closed-form analysis', async () => {
  await initKernel();
  const [g, c, k, r] = [50, 20, 55, 40];
  const theta0 = 60 * DEG;
  const B0: P2 = [c * Math.cos(theta0), c * Math.sin(theta0)];
  const C0 = joint(B0, [g, 0], k, r);
  const res = await sweepMechanism({
    points: { O2: [0, 0], O4: [g, 0], B: B0, C: C0 },
    grounds: ['O2', 'O4'],
    links: [
      { a: 'B', b: 'C' },
      { a: 'C', b: 'O4' },
    ],
    crank: { pivot: 'O2', tip: 'B', fromDeg: 60, toDeg: 420 },
    steps: 180,
    track: ['B', 'C'],
    angles: [{ name: 'rocker', a: 'O4', b: 'C' }],
    joints: [{ name: 'transmission', p: 'B', q: 'C', r: 'O4' }],
  });
  assert.equal(res.feasible, 181);
  for (const p of res.poses) {
    const B = p.tracked?.B as P2;
    const C = p.tracked?.C as P2;
    near(Math.hypot(C[0] - B[0], C[1] - B[1]), k, 2e-3, 'coupler');
    near(Math.hypot(C[0] - g, C[1]), r, 2e-3, 'rocker');
  }
  const fb = fourBarCheck(g, c, k, r);
  assert.equal(fb.type, 'crank-rocker');
  assert.equal(fb.crankTurnsFully, true);
  const rocker = res.ranges.rocker;
  near(
    (rocker?.max ?? 0) - (rocker?.min ?? 0),
    fb.rockerRangeDeg?.swing ?? -1,
    0.6,
    'rocker swing',
  );
  const mu = res.ranges.transmission;
  near(mu?.min ?? 0, fb.transmissionDeg?.min ?? -1, 0.6, 'min transmission');
  near(mu?.max ?? 0, fb.transmissionDeg?.max ?? -1, 0.6, 'max transmission');
});

test('four-bar classification follows Grashof for every link arrangement', () => {
  assert.equal(fourBarCheck(50, 20, 55, 40).type, 'crank-rocker');
  assert.equal(fourBarCheck(20, 45, 50, 40).type, 'double-crank (drag link)');
  assert.equal(fourBarCheck(20, 45, 50, 40).crankTurnsFully, true);
  assert.match(fourBarCheck(50, 45, 20, 40).type, /^double-rocker \(Grashof/);
  assert.equal(fourBarCheck(50, 45, 20, 40).crankTurnsFully, false);
  assert.match(fourBarCheck(50, 45, 40, 20).type, /^rocker-crank/);
  assert.equal(fourBarCheck(50, 40, 45, 60).type, 'triple-rocker (non-Grashof)');
  assert.equal(fourBarCheck(50, 40, 45, 60).grashof, false);
  assert.equal(fourBarCheck(40, 40, 60, 60).type, 'change point (special case)');
  assert.throws(() => fourBarCheck(0, 1, 1, 1), /ground length must be positive/);
});

test('transmission-angle verdicts: a well-proportioned crank-rocker is good, a cramped one is flagged', () => {
  const good = fourBarCheck(50, 20, 55, 40);
  assert.ok((good.transmissionDeg?.min ?? 0) > 25, `${good.transmissionDeg?.min}`);
  const cramped = fourBarCheck(50, 24, 30, 24); // short coupler and rocker: the loop closes with extreme angles
  assert.match(cramped.quality, /marginal|jam|never closes/i);
  const impossible = fourBarCheck(100, 10, 10, 10);
  assert.match(impossible.quality, /never closes/);
});

test('a non-Grashof linkage locks: the sweep reports where it can no longer be assembled', async () => {
  await initKernel();
  const [g, c, k, r] = [50, 40, 45, 60];
  const B0: P2 = [0, c]; // crank at 90 degrees: the loop closes here
  const C0 = joint(B0, [g, 0], k, r);
  const res = await sweepMechanism({
    points: { O2: [0, 0], O4: [g, 0], B: B0, C: C0 },
    grounds: ['O2', 'O4'],
    links: [
      { a: 'B', b: 'C' },
      { a: 'C', b: 'O4' },
    ],
    crank: { pivot: 'O2', tip: 'B', fromDeg: 90, toDeg: 450 },
    steps: 72,
  });
  assert.ok(res.feasible < 73);
  assert.ok(res.infeasibleFromDeg !== undefined);
  assert.ok(res.warnings.some((w) => /locks or cannot be assembled/.test(w)));
});

test('input validation gives clear messages', async () => {
  await initKernel();
  const base = {
    points: { O: [0, 0], A: [10, 0], B: [50, 0] } as Record<string, P2>,
    grounds: ['O'],
    links: [{ a: 'A', b: 'B' }],
    sliders: [{ point: 'B', axis: 'y' as const }],
    crank: { pivot: 'O', tip: 'A', fromDeg: 0, toDeg: 90 },
  };
  await assert.rejects(sweepMechanism({ ...base, links: [{ a: 'A', b: 'Z' }] }), /unknown pin "Z"/);
  await assert.rejects(
    sweepMechanism({ ...base, crank: { ...base.crank, pivot: 'A', tip: 'B' } }),
    /pivot must be one of the grounds/,
  );
  await assert.rejects(
    sweepMechanism({ ...base, crank: { ...base.crank, tip: 'O' } }),
    /cannot be a ground|must not coincide/,
  );
  await assert.rejects(
    // a 5 mm link cannot reach a slider that runs along the vertical line x = 50 from a crank tip at x = 10
    sweepMechanism({
      ...base,
      links: [{ a: 'A', b: 'B', length: 5 }],
      sliders: [{ point: 'B', axis: 'x' }],
    }),
    /starting pose cannot be assembled/,
  );
});
