// Solid (voxel) FEA validated against beam theory and against the independent frame solver.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeFrame,
  buildModel,
  initKernel,
  ModelBuilder,
  type SolidFeaResult,
  solidFea,
} from '../src/index.ts';

type Step = Parameters<ModelBuilder['add']>[0];
const body = async (steps: Step[], id = 'p') => {
  await initKernel();
  const b = new ModelBuilder();
  for (const s of steps) b.add(s);
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  const shape = m.bodies.get(id);
  assert.ok(shape);
  return shape;
};
const rel = (a: number, b: number, tol: number, what = '') =>
  assert.ok(
    Math.abs(a - b) <= tol * Math.abs(b),
    `${what} ${a} vs ${b} (${(((a - b) / b) * 100).toFixed(2)}%)`,
  );

const E = 70000;
// 60 x 6 x 6 mm bar with its root face at x = 0 (x 0..60), centred on y and z
const bar = (L = 60, b = 6): Step[] => [
  { op: 'box', id: 'p', w: L, d: b, h: b, at: [L / 2, 0, 0] },
];

test('axial bar: elongation F L / E A and uniform stress F / A away from the root', async () => {
  const shape = await body(bar(40, 5));
  const r = solidFea({
    shape,
    E,
    elementSize: 1.25,
    supports: [{ region: { face: { normal: '-X' } } }],
    loads: [{ region: { face: { normal: '+X' } }, force: [500, 0, 0] }],
  });
  assert.ok(r.converged, `${r.relativeResidual}`);
  assert.ok(r.equilibriumErrorN < 1e-3 * 500, `${r.equilibriumErrorN}`);
  rel(r.maxDisplacement.value, (500 * 40) / (E * 25), 0.03, 'elongation');
  // away from the clamped root the field is uniaxial 20 MPa
  rel(r.medianVonMises, 20, 0.03, 'median stress');
  assert.ok(Math.abs(r.reaction[0] + 500) < 0.5, `${r.reaction}`);
});

test('cantilever 120 x 6 x 6 with a tip load: tip deflection within 5% of beam theory + shear, mid-span stress, root band', async () => {
  const shape = await body(bar(120));
  const F = 60;
  const r = solidFea({
    shape,
    E,
    nu: 0.3,
    yield: 250,
    elementSize: 1, // six elements through the thickness
    supports: [{ region: { face: { normal: '-X' } } }],
    loads: [{ region: { face: { normal: '+X' } }, force: [0, 0, -F] }],
  });
  assert.ok(r.converged, `${r.relativeResidual} after ${r.iterations}`);
  const I = (6 * 6 ** 3) / 12;
  const bending = (F * 120 ** 3) / (3 * E * I); // 4.571
  const shear = (F * 120) / ((5 / 6) * (E / 2.6) * 36); // Timoshenko correction, 0.2%
  // a clamped root face also holds the Poisson contraction, so the solid is slightly stiffer than the beam: 3-4% here
  rel(r.maxDisplacement.value, bending + shear, 0.05, 'tip deflection');
  assert.ok(r.maxDisplacement.at[0] > 118, `max displacement at ${r.maxDisplacement.at}`);
  // stress in the top layer of elements near mid-span: sigma = M c / I with M = F (L - x), element centre 0.75 mm below the top
  let near: number | undefined;
  for (let e = 0; e < r.elements; e++) {
    const x = r.elementCenters[e * 3] as number;
    const z = r.elementCenters[e * 3 + 2] as number;
    const y = r.elementCenters[e * 3 + 1] as number;
    if (Math.abs(x - 60.5) < 0.1 && z > 2.2 && Math.abs(y) < 0.6) near = r.elementVonMises[e];
  }
  assert.ok(near !== undefined, 'no element found near mid-span top');
  rel(near as number, (F * (120 - 60.5) * 2.5) / I, 0.1, 'mid-span top-layer stress');
  // the root peak is elevated by the clamped-face singularity but stays in a sane band around M c / I = 100 MPa
  assert.ok(r.maxVonMises.value > 140 && r.maxVonMises.value < 400, `${r.maxVonMises.value}`);
  assert.ok(r.safetyFactorP99 !== undefined && r.safetyFactorP99 > 0);
  assert.ok(r.equilibriumErrorN < 1e-3 * F, `${r.equilibriumErrorN}`);
  rel(Math.abs(r.reaction[2]), F, 1e-3, 'reaction');
});

test('refinement converges: the finer grid is closer to beam theory than the coarser one', async () => {
  const shape = await body(bar());
  const target =
    (60 * 60 ** 3) / (3 * E * ((6 * 6 ** 3) / 12)) + (60 * 60) / ((5 / 6) * (E / 2.6) * 36);
  const run = (h: number) =>
    solidFea({
      shape,
      E,
      elementSize: h,
      supports: [{ region: { face: { normal: '-X' } } }],
      loads: [{ region: { face: { normal: '+X' } }, force: [0, 0, -60] }],
    });
  const coarse = run(3);
  const fine = run(1.5);
  const errC = Math.abs(coarse.maxDisplacement.value - target) / target;
  const errF = Math.abs(fine.maxDisplacement.value - target) / target;
  assert.ok(errF < errC, `coarse ${errC}, fine ${errF}`);
  assert.ok(
    errC < 0.2,
    `even 2 elements through the thickness is within 20% (no locking): ${errC}`,
  );
});

test('solid FEA agrees with the independent frame solver on self-weight sag of a steel bar', async () => {
  const shape = await body(bar(160, 8));
  const r = solidFea({
    shape,
    E: 200000,
    density: 7.85,
    gravity: true,
    elementSize: 2,
    supports: [{ region: { face: { normal: '-X' } } }],
  });
  const A = 64;
  const I = (8 * 8 ** 3) / 12;
  const frame = analyzeFrame({
    nodes: { a: [0, 0, 0], b: [40, 0, 0], c: [80, 0, 0], d: [120, 0, 0], e: [160, 0, 0] },
    members: ['ab', 'bc', 'cd', 'de'].map((id) => ({
      id,
      a: id[0] as string,
      b: id[1] as string,
      E: 200000,
      A,
      Iy: I,
      Iz: I,
      J: 2 * I,
      cy: 4,
      cz: 4,
      density: 7.85,
    })),
    supports: [{ node: 'a', fix: ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] }],
    gravity: true,
  });
  const sag = Math.abs(frame.displacements.e?.[2] ?? 0);
  rel(r.maxDisplacement.value, sag, 0.08, 'sag vs frame FEA');
  const weight = 7.85e-6 * 9.81 * 64 * 160;
  rel(Math.abs(r.reaction[2]), weight, 1e-3, 'reaction = weight');
});

test('a plate with a hole concentrates stress: peak is well above the nominal stress, and the grid reports its volume error', async () => {
  const shape = await body([
    { op: 'box', id: 'p', w: 40, d: 40, h: 4 },
    { op: 'hole', target: 'p', face: { normal: '+Z' }, uv: [0, 0], diameter: 10 },
  ]);
  const F = 10 * 40 * 4; // 10 MPa nominal over the gross section
  const r = solidFea({
    shape,
    E,
    elementSize: 1,
    supports: [{ region: { face: { normal: '-X' } } }],
    loads: [{ region: { face: { normal: '+X' } }, force: [F, 0, 0] }],
  });
  assert.ok(r.converged);
  const net = F / ((40 - 10) * 4); // 13.3 MPa nominal at the hole section
  const kt = r.maxVonMises.value / net;
  // classic finite-width result Kt ~ 2.4 on the net section; a stair-stepped hole is rougher, so only a broad band is asserted
  assert.ok(kt > 1.8 && kt < 6, `Kt ${kt}`);
  assert.ok(Math.abs(r.volumeRatio - 1) < 0.03, `volume ratio ${r.volumeRatio}`);
  // the peak sits near the hole edge across the narrowest section
  assert.ok(
    Math.abs(r.maxVonMises.at[0]) < 8 && Math.abs(r.maxVonMises.at[1]) > 3,
    `${r.maxVonMises.at}`,
  );
});

test('errors and warnings: no supports, no loads, empty regions, too many elements, unsupported rotation', async () => {
  const shape = await body(bar());
  const base = { shape, E, elementSize: 1.5 };
  assert.throws(
    () =>
      solidFea({
        ...base,
        supports: [],
        loads: [{ region: { face: { normal: '+X' } }, force: [0, 0, 1] }],
      }),
    /at least one support/,
  );
  assert.throws(
    () => solidFea({ ...base, supports: [{ region: { face: { normal: '-X' } } }] }),
    /No loads/,
  );
  assert.throws(
    () =>
      solidFea({
        ...base,
        supports: [{ region: { box: { min: [500, 500, 500], max: [510, 510, 510] } } }],
        loads: [{ region: { face: { normal: '+X' } }, force: [0, 0, 1] }],
      }),
    /support: the region contains no solid nodes/,
  );
  assert.throws(
    () =>
      solidFea({
        ...base,
        elementSize: 0.05,
        supports: [{ region: { face: { normal: '-X' } } }],
        loads: [{ region: { face: { normal: '+X' } }, force: [0, 0, 1] }],
      }),
    /too many|larger elementSize/,
  );
  assert.throws(
    () => solidFea({ ...base, elementSize: 0, supports: [{ region: { face: { normal: '-X' } } }] }),
    /positive/,
  );
  assert.throws(
    () =>
      solidFea({
        ...base,
        gravity: true,
        supports: [{ region: { face: { normal: '-X' } } }],
      }),
    /density/,
  );
  // a single node held in one direction cannot stop rigid-body motion: the solver must say so, not return garbage silently
  const r: SolidFeaResult = solidFea({
    ...base,
    elementSize: 3,
    supports: [{ region: { box: { min: [0, -3, -3], max: [0, 3, 3] } }, dofs: ['x'] }],
    loads: [{ region: { face: { normal: '+X' } }, force: [0, 0, 5] }],
    maxIterations: 300,
  });
  assert.ok(r.warnings.length > 0, 'expected a warning about the unconstrained motion');
});

test('the grid spans the bounding box exactly even when the element size does not divide the dimensions', async () => {
  const shape = await body(bar(40, 5));
  const r = solidFea({
    shape,
    E,
    elementSize: 1.7, // 40 / 1.7 and 5 / 1.7 are not whole numbers
    supports: [{ region: { face: { normal: '-X' } } }],
    loads: [{ region: { face: { normal: '+X' } }, force: [500, 0, 0] }],
  });
  assert.ok(Math.abs(r.volumeRatio - 1) < 1e-9, `volume ratio ${r.volumeRatio}`);
  // a section that is exactly 5 x 5 gives the exact axial stiffness (a shrunken section would be off by tens of percent)
  rel(
    r.maxDisplacement.value,
    (500 * 40) / (E * 25),
    0.03,
    'elongation with a non-dividing element size',
  );
});
