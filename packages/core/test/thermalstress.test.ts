// Thermal stress: the conduction solve feeds the elasticity solve on the same mesh.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel, initKernel, ModelBuilder, solidFea, solveThermal } from '../src/index.ts';

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
    `${what} ${a} vs ${b} (${(((a - b) / b) * 100).toFixed(3)}%)`,
  );

const E = 70000;
const ALPHA = 23e-6;
const H = 1.25;
const bar = async () => body([{ op: 'box', id: 'p', w: 40, d: 5, h: 5, at: [20, 0, 0] }]);

/** Pins that stop rigid-body motion without restraining expansion: x on the root face, plus y and z at two corner points. */
const rigidPins = [
  { region: { face: { normal: '-X' as const } }, dofs: ['x' as const] },
  {
    region: {
      box: {
        min: [-0.1, -2.6, -2.6] as [number, number, number],
        max: [0.1, -2.4, -2.4] as [number, number, number],
      },
    },
    dofs: ['y' as const, 'z' as const],
  },
  {
    region: {
      box: {
        min: [-0.1, 2.4, -2.6] as [number, number, number],
        max: [0.1, 2.6, -2.4] as [number, number, number],
      },
    },
    dofs: ['z' as const],
  },
];

/** Conduction through the bar from 100 C at the root to 0 C at the tip: T = 100 - 2.5 x. */
async function gradientBar() {
  const shape = await bar();
  const t = solveThermal({
    shape,
    conductivity: 200,
    elementSize: H,
    fixedTemperatures: [
      { region: { face: { normal: '-X' } }, temperature: 100 },
      { region: { face: { normal: '+X' } }, temperature: 0 },
    ],
  });
  return { shape, t };
}

test('a linear temperature gradient in a freely expanding bar is stress-free and stretches it by alpha times the integral of T', async () => {
  const { shape, t } = await gradientBar();
  const r = solidFea({
    shape,
    E,
    elementSize: H,
    supports: rigidPins,
    thermal: { temperatures: t.temperatures, alpha: ALPHA, referenceTemperature: 0 },
  });
  assert.ok(r.converged);
  // the integral of (100 - 2.5 x) over 0..40 is 2000 K mm; the exact compatible field adds a small corner term
  // -alpha T' (y^2 + z^2) / 2 = +0.00036 mm at the section corners, so the largest displacement is 0.04636 mm
  rel(r.maxDisplacement.value, ALPHA * 2000 + 0.00036, 0.02, 'free expansion');
  // 161 MPa is what a fully restrained bar would carry. A compatible thermal strain leaves essentially none: the median
  // is zero and the 99th percentile about 1.5% of that. (The peak sits at the root-face corners, where holding x
  // against sideways swelling is a constraint singularity that grows with refinement.)
  assert.ok(r.medianVonMises < 0.01, `median ${r.medianVonMises} MPa`);
  assert.ok(r.p99VonMises < 4, `p99 ${r.p99VonMises} MPa`);
  assert.ok(r.equilibriumErrorN < 1e-3);
});

test('a uniformly heated bar held between two walls carries sigma = -E alpha dT, and the wall reactions are equal and opposite', async () => {
  const { shape, t } = await gradientBar();
  const uniform = new Float64Array(t.nodes).fill(100);
  const r = solidFea({
    shape,
    E,
    elementSize: H,
    supports: [
      { region: { face: { normal: '-X' } }, dofs: ['x'] },
      { region: { face: { normal: '+X' } }, dofs: ['x'] },
      rigidPins[1] as (typeof rigidPins)[number],
      rigidPins[2] as (typeof rigidPins)[number],
    ],
    thermal: { temperatures: uniform, alpha: ALPHA, referenceTemperature: 0 },
  });
  assert.ok(r.converged);
  const sigma = E * ALPHA * 100; // 161 MPa
  rel(r.medianVonMises, sigma, 0.01, 'compressive stress');
  // the walls hold x, but the section swells sideways freely by alpha dT (1 + nu): 5 mm x 2.99e-3 in y and in z
  rel(r.maxDisplacement.value, Math.SQRT2 * 5 * ALPHA * 100 * 1.3, 0.03, 'free lateral swelling');
  assert.ok(
    Math.abs(r.reaction[0]) < 1e-3 * sigma * 25,
    'equal and opposite wall forces cancel in the sum',
  );
  assert.ok(r.equilibriumErrorN < 1e-3 * sigma * 25);
});

test('the reference temperature matters: a field equal to it is stress-free, and cooling below it is tension', async () => {
  const { shape, t } = await gradientBar();
  const uniform = new Float64Array(t.nodes).fill(100);
  const supports = [
    { region: { face: { normal: '-X' as const } }, dofs: ['x' as const] },
    { region: { face: { normal: '+X' as const } }, dofs: ['x' as const] },
    rigidPins[1] as (typeof rigidPins)[number],
    rigidPins[2] as (typeof rigidPins)[number],
  ];
  // a field equal to the reference temperature is an unloaded body: no stress, whatever the restraints
  const none = solidFea({
    shape,
    E,
    elementSize: H,
    supports,
    thermal: { temperatures: uniform, alpha: ALPHA, referenceTemperature: 100 },
  });
  assert.ok(none.maxVonMises.value < 1e-6);
  // cooled by 50 K between rigid walls: tension of E alpha dT
  const cool = solidFea({
    shape,
    E,
    elementSize: H,
    supports,
    thermal: {
      temperatures: new Float64Array(t.nodes).fill(50),
      alpha: ALPHA,
      referenceTemperature: 100,
    },
  });
  rel(cool.medianVonMises, E * ALPHA * 50, 0.01, 'tension');
});

test('thermal and mechanical loads superpose: a heated, restrained bar under extra axial pull', async () => {
  const { shape, t } = await gradientBar();
  const uniform = new Float64Array(t.nodes).fill(100);
  const supports = [
    { region: { face: { normal: '-X' as const } }, dofs: ['x' as const] },
    rigidPins[1] as (typeof rigidPins)[number],
    rigidPins[2] as (typeof rigidPins)[number],
  ];
  // free at the tip: the bar expands freely, stress-free; then a 500 N pull adds exactly 20 MPa
  const r = solidFea({
    shape,
    E,
    elementSize: H,
    supports,
    loads: [{ region: { face: { normal: '+X' } }, force: [500, 0, 0] }],
    thermal: { temperatures: uniform, alpha: ALPHA, referenceTemperature: 0 },
  });
  rel(r.medianVonMises, 20, 0.02, 'only the mechanical pull stresses it');
  rel(
    r.maxDisplacement.value,
    ALPHA * 100 * 40 + (500 * 40) / (E * 25),
    0.015,
    'thermal growth plus elastic stretch',
  );
});

test('a temperature field from a different mesh is refused with a clear message', async () => {
  const { shape } = await gradientBar();
  assert.throws(
    () =>
      solidFea({
        shape,
        E,
        elementSize: H,
        supports: rigidPins,
        thermal: { temperatures: new Float64Array(10), alpha: ALPHA, referenceTemperature: 0 },
      }),
    /does not match this mesh/,
  );
});
