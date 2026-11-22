// Body-fitted solid FEA: element-level checks on a distorted hexahedron, then end-to-end accuracy against closed forms.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel, initKernel, ModelBuilder, solidFea } from '../src/index.ts';
import { buildHex, HEX_SIGNS, minCornerJacobian } from '../src/solidfit.ts';

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
const nu = 0.3;
const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu));
const mu = E / (2 * (1 + nu));
const D = new Float64Array(36);
for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) D[i * 6 + j] = i === j ? lam + 2 * mu : lam;
D[21] = mu;
D[28] = mu;
D[35] = mu;

/** A unit cube with its corners pushed around: a clearly non-parallelepiped hexahedron. */
function distorted(): Float64Array {
  const xe = new Float64Array(24);
  const kick = [
    [0.05, -0.04, 0.02],
    [-0.06, 0.03, 0.05],
    [0.04, 0.07, -0.03],
    [-0.03, -0.05, 0.06],
    [0.02, 0.06, -0.05],
    [-0.07, -0.02, 0.04],
    [0.06, -0.06, 0.03],
    [-0.04, 0.05, -0.06],
  ];
  HEX_SIGNS.forEach(([sx, sy, sz], a) => {
    const k = kick[a] as number[];
    xe[a * 3] = 2 + sx * 0.5 + (k[0] as number);
    xe[a * 3 + 1] = -1 + sy * 0.5 + (k[1] as number);
    xe[a * 3 + 2] = 3 + sz * 0.5 + (k[2] as number);
  });
  return xe;
}

test('distorted hexahedron: symmetric, no energy for rigid translations and rotations, and it passes the patch test', () => {
  const xe = distorted();
  const hb = buildHex(xe, D);
  for (let i = 0; i < 24; i++)
    for (let j = 0; j < 24; j++)
      rel(
        (hb.Ke[i * 24 + j] as number) + 1e-12,
        (hb.Ke[j * 24 + i] as number) + 1e-12,
        1e-9,
        `K[${i}][${j}]`,
      );

  const energy = (u: Float64Array) => {
    let e = 0;
    for (let i = 0; i < 24; i++)
      for (let j = 0; j < 24; j++)
        e += (u[i] as number) * (hb.Ke[i * 24 + j] as number) * (u[j] as number);
    return e / 2;
  };
  const field = (fn: (x: number, y: number, z: number) => [number, number, number]) => {
    const u = new Float64Array(24);
    for (let a = 0; a < 8; a++) {
      const v = fn(xe[a * 3] as number, xe[a * 3 + 1] as number, xe[a * 3 + 2] as number);
      u.set(v, a * 3);
    }
    return u;
  };
  const tiny = 1e-9 * E;
  assert.ok(Math.abs(energy(field(() => [0.3, -0.2, 0.1]))) < tiny, 'translation');
  assert.ok(
    Math.abs(energy(field((x, y, z) => [-0.01 * y + 0.02 * z, 0.01 * x, -0.02 * x]))) < tiny,
    'small rotation',
  );

  // patch test: a uniform strain field must produce exactly the energy of uniform stress, 1/2 (lambda + 2 mu) eps^2 V
  const eps = 1e-3;
  const stretch = field((x) => [eps * x, 0, 0]);
  rel(energy(stretch), 0.5 * (lam + 2 * mu) * eps * eps * hb.volume, 1e-9, 'uniaxial patch energy');
  const shear = field((_x, y) => [eps * y, 0, 0]);
  rel(energy(shear), 0.5 * mu * eps * eps * hb.volume, 1e-9, 'simple-shear patch energy');
  assert.ok(minCornerJacobian(xe, 1 / 8) > 0.5, 'the test element is valid');
});

test('an inverted element is rejected instead of silently producing a wrong matrix', () => {
  const xe = distorted();
  // swap two corners: the element folds over itself
  for (let d = 0; d < 3; d++) {
    const t = xe[d] as number;
    xe[d] = xe[3 + d] as number;
    xe[3 + d] = t;
  }
  assert.throws(() => buildHex(xe, D), /inverted element/);
  assert.ok(minCornerJacobian(xe, 1 / 8) < 0);
});

const F = 10 * 40 * 4;
const net = F / (30 * 4); // 13.33 MPa on the section through the hole
const KT = 3 - 3.14 * 0.25 + 3.667 * 0.25 ** 2 - 1.527 * 0.25 ** 3; // Peterson, d/W = 0.25: 2.42

async function plateRun(h: number, fit: boolean) {
  const shape = await body([
    { op: 'box', id: 'p', w: 40, d: 40, h: 4 },
    { op: 'hole', target: 'p', face: { normal: '+Z' }, uv: [0, 0], diameter: 10 },
  ]);
  return solidFea({
    shape,
    E,
    elementSize: h,
    fit,
    supports: [{ region: { face: { normal: '-X' } } }],
    loads: [{ region: { face: { normal: '+X' } }, force: [F, 0, 0] }],
  });
}

test('plate with a hole: the fitted mesh reads the stress concentration within 5% of the handbook value, the stair-stepped one does not', async () => {
  const fitted = await plateRun(1, true);
  rel(fitted.maxVonMises.value / net, KT, 0.05, 'fitted Kt at h = 1');
  assert.ok(fitted.fitted && fitted.snappedNodes > 50);
  assert.ok(fitted.minJacobianRatio > 0.3, `${fitted.minJacobianRatio}`);
  rel(fitted.volumeRatio, 1, 5e-3, 'fitted volume');
  // the peak is on the hole edge across the narrowest section (x ~ 0, |y| ~ 5)
  assert.ok(
    Math.abs(fitted.maxVonMises.at[0]) < 2.5 &&
      Math.abs(Math.abs(fitted.maxVonMises.at[1]) - 5) < 0.5,
    `${fitted.maxVonMises.at}`,
  );

  const voxel = await plateRun(1, false);
  assert.equal(voxel.fitted, false);
  assert.equal(voxel.snappedNodes, 0);
  // coarse grids are where fitting matters most: at h = 2 the fitted answer is much closer
  const coarseFit = await plateRun(2, true);
  const coarseVox = await plateRun(2, false);
  const errFit = Math.abs(coarseFit.maxVonMises.value / net - KT) / KT;
  const errVox = Math.abs(coarseVox.maxVonMises.value / net - KT) / KT;
  assert.ok(errFit < errVox / 2, `fitted ${errFit}, voxel ${errVox}`);
  assert.ok(errFit < 0.15, `${errFit}`);
});

test('refining the fitted mesh converges toward the handbook Kt instead of wandering', async () => {
  const kts = [];
  for (const h of [2, 1]) kts.push((await plateRun(h, true)).maxVonMises.value / net);
  const errs = kts.map((k) => Math.abs(k - KT) / KT);
  assert.ok((errs[1] as number) < (errs[0] as number), `${errs}`);
});

test('a round cantilever: fitted cross-section is nearly circular, and the fitted deflection is closer to beam theory than the staircase', async () => {
  const shape = await body([{ op: 'cylinder', id: 'p', r: 5, h: 100, axis: 'X', at: [50, 0, 0] }]);
  const run = (fit: boolean) =>
    solidFea({
      shape,
      E,
      elementSize: 1.25,
      fit,
      supports: [{ region: { face: { normal: '-X' } } }],
      loads: [{ region: { face: { normal: '+X' } }, force: [0, 0, -60] }],
    });
  const fitted = run(true);
  const voxel = run(false);
  const euler = (60 * 100 ** 3) / (3 * E * ((Math.PI * 10 ** 4) / 64));
  const eFit = Math.abs(fitted.maxDisplacement.value - euler) / euler;
  const eVox = Math.abs(voxel.maxDisplacement.value - euler) / euler;
  assert.ok(eFit < eVox, `fitted ${eFit}, voxel ${eVox}`);
  assert.ok(eFit < 0.12, `${eFit}`);
  rel(fitted.volumeRatio, 1, 0.03, 'fitted cylinder volume');
  assert.ok(Math.abs(voxel.volumeRatio - 1) > Math.abs(fitted.volumeRatio - 1) * 0.5);
});

test('prismatic parts are unchanged by fitting: nothing needs to move, so the cheap brick matrix is used throughout', async () => {
  const shape = await body([{ op: 'box', id: 'p', w: 60, d: 6, h: 6, at: [30, 0, 0] }]);
  const args = {
    shape,
    E,
    elementSize: 1.5,
    supports: [{ region: { face: { normal: '-X' as const } } }],
    loads: [
      {
        region: { face: { normal: '+X' as const } },
        force: [0, 0, -60] as [number, number, number],
      },
    ],
  };
  const fitted = solidFea({ ...args, fit: true });
  const voxel = solidFea({ ...args, fit: false });
  assert.equal(fitted.snappedNodes, 0);
  rel(fitted.maxDisplacement.value, voxel.maxDisplacement.value, 1e-9, 'identical displacement');
  rel(fitted.maxVonMises.value, voxel.maxVonMises.value, 1e-9, 'identical stress');
});

test('nodal stress recovery reads the surface: a uniaxial bar shows its exact stress at the nodes, and the peak is reported at a node', async () => {
  const shape = await body([{ op: 'box', id: 'p', w: 40, d: 5, h: 5, at: [20, 0, 0] }]);
  const r = solidFea({
    shape,
    E,
    elementSize: 1.25,
    supports: [{ region: { face: { normal: '-X' } } }],
    loads: [{ region: { face: { normal: '+X' } }, force: [500, 0, 0] }],
  });
  // 500 N over 25 mm2 = 20 MPa; the clamped root raises the peak above it
  assert.ok(r.maxVonMises.value >= 19.9, `${r.maxVonMises.value}`);
  assert.ok(r.peakElementVonMises <= r.maxVonMises.value + 1e-9);
  rel(r.medianVonMises, 20, 0.03, 'median');
});
