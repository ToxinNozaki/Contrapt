import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beamCheck,
  buildModel,
  eulerBuckling,
  initKernel,
  ModelBuilder,
  sectionProperties,
} from '../src/index.ts';

type Step = Parameters<ModelBuilder['add']>[0];
const sectionOf = async (profile: unknown[]) => {
  await initKernel();
  const b = new ModelBuilder();
  b.add({ op: 'sketch', id: 's', plane: 'XY', profile } as Step);
  const m = await buildModel(b.toJSON());
  const sk = m.sketches.get('s');
  assert.ok(sk, JSON.stringify(m.report.steps));
  return sectionProperties(sk.drawing);
};
const rel = (a: number, b: number, tol: number) =>
  assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} vs ${b}`);

test('rectangle 20 x 5: A, I = b h^3 / 12 about the centroid, section modulus, radius of gyration', async () => {
  const s = await sectionOf([{ shape: 'rect', w: 20, h: 5 }]);
  rel(s.area, 100, 1e-6);
  rel(s.Ix, (20 * 5 ** 3) / 12, 1e-6);
  rel(s.Iy, (5 * 20 ** 3) / 12, 1e-6);
  assert.ok(Math.abs(s.Ixy) < 1e-6);
  rel(s.Zx, (20 * 5 ** 3) / 12 / 2.5, 1e-6);
  rel(s.rx, Math.sqrt(5 ** 2 / 12), 1e-6);
  assert.deepEqual(s.centroid, [0, 0]);
});

test('off-centre rectangle: centroid moves, centroidal inertia does not', async () => {
  const s = await sectionOf([{ shape: 'rect', w: 20, h: 5, cx: 30, cy: -7 }]);
  assert.deepEqual(s.centroid, [30, -7]);
  rel(s.Ix, 208.333333, 1e-6);
});

test('solid circle r = 10: pi r^4 / 4 within 0.01%', async () => {
  const s = await sectionOf([{ shape: 'circle', r: 10 }]);
  rel(s.area, Math.PI * 100, 1e-4);
  rel(s.Ix, (Math.PI * 10 ** 4) / 4, 1e-4);
  rel(s.Iy, (Math.PI * 10 ** 4) / 4, 1e-4);
  rel(s.Jpolar, (Math.PI * 10 ** 4) / 2, 1e-4);
});

test('tube: a circular hole subtracts (outer 20 mm dia, inner 16 mm dia)', async () => {
  const s = await sectionOf([
    { shape: 'circle', r: 10 },
    { shape: 'circle', r: 8, cut: true },
  ]);
  rel(s.Ix, (Math.PI * (10 ** 4 - 8 ** 4)) / 4, 1e-4);
  rel(s.area, Math.PI * (100 - 64), 1e-4);
});

test('rectangular tube: (b h^3 - bi hi^3) / 12', async () => {
  const s = await sectionOf([
    { shape: 'rect', w: 30, h: 20 },
    { shape: 'rect', w: 26, h: 16, cut: true },
  ]);
  rel(s.Ix, (30 * 20 ** 3 - 26 * 16 ** 3) / 12, 1e-6);
  rel(s.Iy, (20 * 30 ** 3 - 16 * 26 ** 3) / 12, 1e-6);
});

test('an L angle 40 x 40 x 5: centroid, product of inertia, principal axes at 45 degrees', async () => {
  const s = await sectionOf([
    {
      shape: 'polygon',
      points: [
        [0, 0],
        [40, 0],
        [40, 5],
        [5, 5],
        [5, 40],
        [0, 40],
      ],
    },
  ]);
  rel(s.area, 375, 1e-6);
  // centroid from each back: (flange 200 mm2 at 20 + leg 175 mm2 at 2.5) / 375 measured along the flange direction
  // is NOT the right formula for both axes, so check the closed form per axis:
  // x: (40*5 at x=20) + (35*5 at x=2.5) over A ; y: (40*5 at y=2.5) + (35*5 at y=22.5) over A
  rel(s.centroid[0], (200 * 20 + 175 * 2.5) / 375, 1e-6);
  rel(s.centroid[1], (200 * 2.5 + 175 * 22.5) / 375, 1e-6);
  // the angle is symmetric about the 45 degree line: Ix = Iy and the principal axes sit at +-45 degrees
  rel(s.Ix, s.Iy, 1e-6);
  assert.ok(Math.abs(Math.abs(s.principalAngleDeg) - 45) < 1e-6, `${s.principalAngleDeg}`);
  assert.ok(s.I1 > s.I2);
  assert.ok(Math.abs(s.I1 + s.I2 - (s.Ix + s.Iy)) < 1e-6);
  rel(Math.abs(s.Ixy), (s.I1 - s.I2) / 2, 1e-6);
});

const E = 69000;
const I = (20 * 5 ** 3) / 12;

test('beam: the strength pack worked example (6061 cantilever, 50 N tip load) comes out the same', () => {
  const r = beamCheck({
    support: 'cantilever',
    load: 'point',
    value: 50,
    length: 100,
    E,
    I,
    c: 2.5,
    yield: 276,
  });
  rel(r.deflection, 1.158, 2e-3);
  rel(r.moment, 5000, 1e-12);
  rel(r.stress, 60, 1e-3);
  rel(r.safetyFactor ?? 0, 4.6, 1e-2);
  assert.match(r.where, /fixed end/);
});

test('beam: every closed-form case against its textbook formula', () => {
  const base = { length: 200, E: 200000, I: 1000, c: 5 };
  const F = 100;
  const w = 0.5;
  const EI = base.E * base.I;
  const L = base.length;
  const cases: [Parameters<typeof beamCheck>[0], number, number][] = [
    [{ ...base, support: 'cantilever', load: 'point', value: F }, (F * L ** 3) / (3 * EI), F * L],
    [
      { ...base, support: 'cantilever', load: 'uniform', value: w },
      (w * L ** 4) / (8 * EI),
      (w * L * L) / 2,
    ],
    [
      { ...base, support: 'simply-supported', load: 'point', value: F },
      (F * L ** 3) / (48 * EI),
      (F * L) / 4,
    ],
    [
      { ...base, support: 'simply-supported', load: 'uniform', value: w },
      (5 * w * L ** 4) / (384 * EI),
      (w * L * L) / 8,
    ],
    [
      { ...base, support: 'fixed-fixed', load: 'point', value: F },
      (F * L ** 3) / (192 * EI),
      (F * L) / 8,
    ],
    [
      { ...base, support: 'fixed-fixed', load: 'uniform', value: w },
      (w * L ** 4) / (384 * EI),
      (w * L * L) / 12,
    ],
    [
      { ...base, support: 'fixed-pinned', load: 'point', value: F },
      (F * L ** 3) / (48 * Math.sqrt(5) * EI),
      (3 * F * L) / 16,
    ],
    [
      { ...base, support: 'fixed-pinned', load: 'uniform', value: w },
      (w * L ** 4) / (185 * EI),
      (w * L * L) / 8,
    ],
  ];
  for (const [input, d, M] of cases) {
    const r = beamCheck(input);
    rel(r.deflection, d, 2e-3);
    rel(r.moment, M, 1e-12);
    rel(r.stress, (M * 5) / 1000, 1e-12);
  }
});

test('beam: halving the span cuts tip deflection 8x, and 8x the inertia cuts it 8x', () => {
  const a = beamCheck({
    support: 'cantilever',
    load: 'point',
    value: 10,
    length: 100,
    E,
    I,
    c: 2.5,
  });
  const b = beamCheck({
    support: 'cantilever',
    load: 'point',
    value: 10,
    length: 50,
    E,
    I,
    c: 2.5,
  });
  rel(a.deflection / b.deflection, 8, 1e-6);
  const c = beamCheck({
    support: 'cantilever',
    load: 'point',
    value: 10,
    length: 100,
    E,
    I: I * 8,
    c: 5,
  });
  rel(a.deflection / c.deflection, 8, 1e-6);
});

test('beam: bad inputs are rejected; column buckling picks the right regime', () => {
  assert.throws(
    () => beamCheck({ support: 'cantilever', load: 'point', value: 1, length: 0, E, I, c: 1 }),
    /positive/,
  );
  const I10 = (Math.PI * 10 ** 4) / 64;
  const A10 = Math.PI * 25;
  const slender = eulerBuckling({
    E,
    I: I10,
    length: 500,
    ends: 'pinned-pinned',
    area: A10,
    yield: 276,
  });
  rel(slender.criticalLoad, (Math.PI ** 2 * E * I10) / 500 ** 2, 1e-12);
  assert.equal(slender.governs, 'buckling');
  const stocky = eulerBuckling({
    E,
    I: I10,
    length: 20,
    ends: 'pinned-pinned',
    area: A10,
    yield: 276,
  });
  assert.equal(stocky.governs, 'crushing');
  rel(
    eulerBuckling({ E, I: I10, length: 500, ends: 'fixed-fixed', area: A10 }).criticalLoad /
      slender.criticalLoad,
    4,
    1e-12,
  );
});
