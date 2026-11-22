// Natural frequencies of solids on the fitted mesh, validated against beam theory.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel, initKernel, ModelBuilder, solidModes } from '../src/index.ts';

type Step = Parameters<ModelBuilder['add']>[0];
const body = async (steps: Step[], id = 'p') => {
  await initKernel();
  const b = new ModelBuilder();
  for (const s of steps) b.add(s);
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  return m.bodies.get(id) as NonNullable<ReturnType<typeof m.bodies.get>>;
};
const rel = (a: number, b: number, tol: number, what = '') =>
  assert.ok(
    Math.abs(a - b) <= tol * Math.abs(b),
    `${what} ${a} vs ${b} (${(((a - b) / b) * 100).toFixed(2)}%)`,
  );

const E = 70000;
const RHO = 2.7; // g/cm3
const root = [{ region: { face: { normal: '-X' as const } } }];
// Euler-Bernoulli cantilever: f_n = (k_n^2 / 2 pi) sqrt(E I / (rho A L^4)), k = 1.8751, 4.6941, 7.8548
const fBeam = (k: number, I: number, A: number, L: number) =>
  ((k * k) / (2 * Math.PI)) * Math.sqrt((E * I) / (RHO * 1e-9 * A * L ** 4));

test('cantilever 100 x 10 x 5 aluminium: the first bending modes match beam theory within 1.5%, mass is exact', async () => {
  const shape = await body([{ op: 'box', id: 'p', w: 100, d: 10, h: 5, at: [50, 0, 0] }]);
  const r = solidModes({ shape, E, density: RHO, elementSize: 2.5, supports: root, count: 4 });
  assert.ok(r.converged, `${r.iterations} iterations, residual ${Math.max(...r.residuals)}`);
  const thin = (10 * 5 ** 3) / 12; // bends in z
  const wide = (5 * 10 ** 3) / 12; // bends in y
  rel(r.frequencies[0] as number, fBeam(1.8751, thin, 50, 100), 0.015, 'first thin-axis bending');
  rel(r.frequencies[1] as number, fBeam(1.8751, wide, 50, 100), 0.015, 'first wide-axis bending');
  rel(r.frequencies[2] as number, fBeam(4.6941, thin, 50, 100), 0.02, 'second thin-axis bending');
  rel(r.massG, 100 * 10 * 5 * RHO * 1e-3, 1e-9, 'mass');
  // ascending, positive
  for (let i = 1; i < r.frequencies.length; i++)
    assert.ok((r.frequencies[i] as number) > (r.frequencies[i - 1] as number));
});

test('frequencies barely move with refinement: the coarse mesh is already close, the finer one closer to beam theory', async () => {
  const shape = await body([{ op: 'box', id: 'p', w: 60, d: 6, h: 6, at: [30, 0, 0] }]);
  const coarse = solidModes({ shape, E, density: RHO, elementSize: 3, supports: root, count: 2 });
  const fine = solidModes({ shape, E, density: RHO, elementSize: 1.5, supports: root, count: 2 });
  const exact = fBeam(1.8751, (6 * 6 ** 3) / 12, 36, 60);
  const eC = Math.abs((coarse.frequencies[0] as number) - exact) / exact;
  const eF = Math.abs((fine.frequencies[0] as number) - exact) / exact;
  assert.ok(eC < 0.03 && eF < 0.03, `coarse ${eC}, fine ${eF}`);
  rel(
    fine.frequencies[0] as number,
    coarse.frequencies[0] as number,
    0.02,
    'refinement changes the answer by under 2%',
  );
  // a square section bends equally both ways: modes 1 and 2 are a degenerate pair
  rel(fine.frequencies[1] as number, fine.frequencies[0] as number, 0.01, 'degenerate pair');
});

test('a round cantilever (fitted curved section): the degenerate bending pair sits at the beam-theory frequency', async () => {
  const shape = await body([{ op: 'cylinder', id: 'p', r: 5, h: 100, axis: 'X', at: [50, 0, 0] }]);
  const r = solidModes({ shape, E, density: RHO, elementSize: 2, supports: root, count: 2 });
  const f = fBeam(1.8751, (Math.PI * 10 ** 4) / 64, Math.PI * 25, 100);
  rel(r.frequencies[0] as number, f, 0.03, 'first bending');
  rel(
    r.frequencies[1] as number,
    r.frequencies[0] as number,
    0.01,
    'the two bending directions are equal for a round bar',
  );
  assert.ok(r.fitted);
  rel(r.massG, Math.PI * 25 * 100 * RHO * 1e-3, 0.02, 'fitted mass is close to the exact mass');
});

test('mode shapes: scaled to unit maximum, zero where supported, and a bending mode moves the free end most', async () => {
  const shape = await body([{ op: 'box', id: 'p', w: 100, d: 10, h: 5, at: [50, 0, 0] }]);
  const r = solidModes({ shape, E, density: RHO, elementSize: 2.5, supports: root, count: 2 });
  const shapeVec = r.modeShapes[0] as Float64Array;
  let mx = 0;
  let tipMove = 0;
  let rootMove = 0;
  for (let a = 0; a < r.nodes; a++) {
    const x = r.nodeCoords[a * 3] as number;
    const mag = Math.hypot(
      shapeVec[a * 3] as number,
      shapeVec[a * 3 + 1] as number,
      shapeVec[a * 3 + 2] as number,
    );
    mx = Math.max(
      mx,
      Math.abs(shapeVec[a * 3] as number),
      Math.abs(shapeVec[a * 3 + 1] as number),
      Math.abs(shapeVec[a * 3 + 2] as number),
    );
    if (x > 99.9) tipMove = Math.max(tipMove, mag);
    if (x < 0.1) rootMove = Math.max(rootMove, mag);
  }
  assert.ok(Math.abs(mx - 1) < 1e-9);
  assert.equal(rootMove, 0);
  assert.ok(tipMove > 0.9, `${tipMove}`);
  // the first mode of this section bends in z (the thin direction): the tip moves almost entirely in z
  let uz = 0;
  for (let a = 0; a < r.nodes; a++)
    if ((r.nodeCoords[a * 3] as number) > 99.9)
      uz = Math.max(uz, Math.abs(shapeVec[a * 3 + 2] as number));
  assert.ok(uz > 0.95, `tip z-motion ${uz}`);
});

test('input checks: supports are required, positive properties, clear messages', async () => {
  const shape = await body([{ op: 'box', id: 'p', w: 20, d: 5, h: 5, at: [10, 0, 0] }]);
  assert.throws(
    () => solidModes({ shape, E, density: RHO, elementSize: 2, supports: [] }),
    /at least one support/,
  );
  assert.throws(
    () => solidModes({ shape, E, density: 0, elementSize: 2, supports: root }),
    /density must be positive/,
  );
  assert.throws(
    () => solidModes({ shape, E: 0, density: RHO, elementSize: 2, supports: root }),
    /E must be positive/,
  );
  assert.throws(
    () => solidModes({ shape, E, density: RHO, elementSize: 0, supports: root }),
    /elementSize must be positive/,
  );
  assert.throws(
    () =>
      solidModes({
        shape,
        E,
        density: RHO,
        elementSize: 2,
        supports: [{ region: { box: { min: [500, 500, 500], max: [501, 501, 501] } } }],
      }),
    /no solid nodes/,
  );
});
