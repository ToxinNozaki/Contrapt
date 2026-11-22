// Steady-state conduction validated against closed forms: slab, internal generation, a convecting fin and a curved tube wall.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel, initKernel, ModelBuilder, selectNodes, solveThermal } from '../src/index.ts';

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

const K_AL = 200; // W/(m K)
const bar = (L: number, w: number): Step[] => [
  { op: 'box', id: 'p', w: L, d: w, h: w, at: [L / 2, 0, 0] },
];

test('slab: a linear profile, Q = k A dT / L, mid-length temperature is the mean, flux = k dT / L', async () => {
  const shape = await body(bar(100, 10));
  const r = solveThermal({
    shape,
    conductivity: K_AL,
    elementSize: 2.5,
    fixedTemperatures: [
      { region: { face: { normal: '-X' } }, temperature: 100 },
      { region: { face: { normal: '+X' } }, temperature: 0 },
    ],
  });
  assert.ok(r.converged, `${r.relativeResidual}`);
  rel(
    r.heat.fixedOutW,
    0.2 * 100 * (100 / 100),
    1e-6,
    'heat flow (negative: it enters at the hot end and leaves at the cold one)',
  );
  assert.ok(Math.abs(r.heat.imbalanceW) < 1e-6);
  rel(r.maxHeatFlux.value, 0.2 * (100 / 100), 1e-6, 'flux');
  for (let a = 0; a < r.nodes; a++) {
    const x = r.nodeCoords[a * 3] as number;
    assert.ok(Math.abs((r.temperatures[a] as number) - (100 - x)) < 1e-6, `T at x = ${x}`);
  }
  assert.ok(Math.abs(r.temperature.mean - 50) < 1e-6);
});

test('internal generation between two cold ends: T_max = q L^2 / (8 k) at mid-length', async () => {
  const shape = await body(bar(100, 10));
  const G = 10; // W in a 10000 mm3 bar
  const r = solveThermal({
    shape,
    conductivity: K_AL,
    elementSize: 2.5,
    generation: G,
    fixedTemperatures: [
      { region: { face: { normal: '-X' } }, temperature: 0 },
      { region: { face: { normal: '+X' } }, temperature: 0 },
    ],
  });
  const q = G / 10000; // W/mm3
  rel(r.temperature.max, (q * 100 * 100) / (8 * 0.2), 1e-6, 'peak temperature');
  assert.ok(Math.abs((r.temperature.maxAt[0] as number) - 50) < 2.6);
  rel(r.heat.fixedOutW, G, 1e-6, 'all generated heat leaves through the cold ends');
  assert.ok(Math.abs(r.heat.imbalanceW) < 1e-6);
});

test('a fin: tip temperature T_inf + dT / cosh(mL) and heat flow k A m dT tanh(mL), and the heat balance closes', async () => {
  const shape = await body(bar(50, 5));
  const h = 100; // W/(m2 K)
  const Tinf = 20;
  const T0 = 100;
  const m = Math.sqrt((h * 1e-6 * 20) / (0.2 * 25)); // 0.02 per mm
  const sides = (['+Y', '-Y', '+Z', '-Z'] as const).map((n) => ({
    region: { face: { normal: n } },
    h,
    ambient: Tinf,
  }));
  const r = solveThermal({
    shape,
    conductivity: K_AL,
    elementSize: 1,
    fixedTemperatures: [{ region: { face: { normal: '-X' } }, temperature: T0 }],
    convections: sides,
  });
  assert.ok(r.converged);
  const tip = Tinf + (T0 - Tinf) / Math.cosh(m * 50);
  const tipNodes = [...Array(r.nodes).keys()].filter(
    (a) => Math.abs((r.nodeCoords[a * 3] as number) - 50) < 1e-6,
  );
  const tipT = tipNodes.reduce((s, a) => s + (r.temperatures[a] as number), 0) / tipNodes.length;
  rel(tipT, tip, 0.012, 'tip temperature');
  const Q = 0.2 * 25 * m * (T0 - Tinf) * Math.tanh(m * 50);
  rel(r.heat.fixedInW, Q, 0.02, 'heat supplied by the hot root');
  assert.ok(Math.abs(r.heat.imbalanceW) < 1e-7, `imbalance ${r.heat.imbalanceW}`);
  rel(
    r.heat.convectionOutW,
    r.heat.fixedInW,
    1e-6,
    'convection carries away exactly what the root supplies',
  );
});

test('heat input balances convection: a plate heated on one face settles where h A (T - T_inf) = P', async () => {
  const shape = await body([{ op: 'box', id: 'p', w: 40, d: 40, h: 4 }]);
  const P = 5;
  const h = 10; // W/(m2 K)
  const r = solveThermal({
    shape,
    conductivity: K_AL,
    elementSize: 2,
    heatInputs: [{ region: { face: { normal: '+Z' } }, power: P }],
    convections: [{ region: { face: { normal: '-Z' } }, h, ambient: 25 }],
  });
  // the plate is nearly isothermal: A = 1600 mm2 => T = 25 + P / (h x 1.6e-3 m2)
  rel(r.temperature.mean, 25 + P / (h * 1.6e-3), 0.01, 'mean temperature');
  rel(r.heat.convectionOutW, P, 1e-6);
  assert.ok(Math.abs(r.heat.imbalanceW) < 1e-9);
});

test('curved geometry: radial conduction through a tube wall follows ln(r), and the fitted mesh beats the staircase', async () => {
  const shape = await body([
    { op: 'cylinder', id: 'outer', r: 10, h: 10 },
    { op: 'cylinder', id: 'bore', r: 5, h: 12 },
    { op: 'boolean', id: 'p', kind: 'cut', a: 'outer', b: 'bore' },
  ]);
  const run = (fit: boolean) =>
    solveThermal({
      shape,
      conductivity: K_AL,
      elementSize: 1,
      fit,
      fixedTemperatures: [
        { region: { cylinder: { axis: 'Z', center: [0, 0, 0], radius: 5 } }, temperature: 100 },
        { region: { cylinder: { axis: 'Z', center: [0, 0, 0], radius: 10 } }, temperature: 0 },
      ],
    });
  const fitted = run(true);
  const Qexact = (2 * Math.PI * 0.2 * 10 * 100) / Math.log(2); // 1811 W
  rel(fitted.heat.fixedOutW, Qexact, 0.03, 'radial heat flow');
  assert.ok(Math.abs(fitted.heat.imbalanceW) < 1e-6 * Qexact);
  // temperature at mid radius from the nodes found near r = 7.5
  const mid = [...Array(fitted.nodes).keys()].filter((a) => {
    const x = fitted.nodeCoords[a * 3] as number;
    const y = fitted.nodeCoords[a * 3 + 1] as number;
    return Math.abs(Math.hypot(x, y) - 7.5) < 0.15;
  });
  assert.ok(mid.length > 10);
  for (const a of mid) {
    const rr = Math.hypot(
      fitted.nodeCoords[a * 3] as number,
      fitted.nodeCoords[a * 3 + 1] as number,
    );
    rel(
      fitted.temperatures[a] as number,
      (100 * Math.log(10 / rr)) / Math.log(2),
      0.05,
      `T at r = ${rr.toFixed(2)}`,
    );
  }
  const stair = run(false);
  const eFit = Math.abs(fitted.heat.fixedOutW - Qexact) / Qexact;
  const eStair = Math.abs(stair.heat.fixedOutW - Qexact) / Qexact;
  assert.ok(eFit < eStair, `fitted ${eFit}, staircase ${eStair}`);
});

test('cylinder regions select the nodes on a bore at its radius, and say so when nothing matches', async () => {
  const shape = await body([
    { op: 'cylinder', id: 'outer', r: 10, h: 10 },
    { op: 'cylinder', id: 'bore', r: 5, h: 12 },
    { op: 'boolean', id: 'p', kind: 'cut', a: 'outer', b: 'bore' },
  ]);
  const r = solveThermal({
    shape,
    conductivity: K_AL,
    elementSize: 1,
    fixedTemperatures: [
      { region: { cylinder: { axis: 'Z', center: [0, 0, 0], radius: 5 } }, temperature: 50 },
      { region: { box: { min: [-20, -20, -1], max: [20, 20, 11] } }, temperature: 50 },
    ],
    generation: 0.001,
  });
  assert.ok(r.temperature.max >= 50 - 1e-9);
  const nodeCoords = (a: number): [number, number, number] => [0, 0, 0 * a];
  assert.throws(
    () =>
      selectNodes(
        { cylinder: { axis: 'Z', center: [0, 0, 0], radius: 7.5, range: [100, 200] } },
        shape,
        nodeCoords,
        5,
        1,
        'support',
      ),
    /no solid nodes lie on that cylinder/,
  );
});

test('errors: an undetermined temperature level, no driver, regions that expose no faces, bad inputs', async () => {
  const shape = await body(bar(50, 5));
  const base = { shape, conductivity: K_AL, elementSize: 2.5 };
  assert.throws(
    () => solveThermal({ ...base, fixedTemperatures: [] }),
    /at least one fixed-temperature surface or a convection surface/,
  );
  assert.throws(
    () =>
      solveThermal({
        ...base,
        fixedTemperatures: [{ region: { face: { normal: '-X' } }, temperature: 20 }],
      }),
    /Nothing drives heat flow/,
  );
  assert.throws(
    () =>
      solveThermal({
        ...base,
        fixedTemperatures: [{ region: { face: { normal: '-X' } }, temperature: 20 }],
        convections: [
          { region: { box: { min: [20, -1, -1], max: [30, 1, 1] } }, h: 10, ambient: 50 },
        ],
      }),
    /no exposed surface faces lie in that region/,
  );
  assert.throws(
    () =>
      solveThermal({
        ...base,
        conductivity: 0,
        fixedTemperatures: [{ region: { face: { normal: '-X' } }, temperature: 1 }],
      }),
    /conductivity must be positive/,
  );
});
