import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildModel,
  inertiaAboutAxis,
  initKernel,
  ModelBuilder,
  massProps,
  withDensity,
} from '../src/index.ts';

type Step = Parameters<ModelBuilder['add']>[0];
const shape = async (steps: Step[], id = 'p') => {
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

test('box 40 x 20 x 10 aluminium: inertia about the COM is m (b^2 + c^2) / 12 on each axis, principal axes aligned', async () => {
  const mp = massProps(await shape([{ op: 'box', id: 'p', w: 40, d: 20, h: 10, at: [5, -3, 2] }]));
  rel(mp.volume, 8000, 1e-9);
  assert.deepEqual(
    mp.centerOfMass.map((x) => Math.round(x * 1e6) / 1e6),
    [5, -3, 2],
  );
  const d = withDensity(mp, 2.7);
  rel(d.massG, 21.6, 1e-9);
  const m = d.massG / 1000; // kg
  const ixx = (m * ((20 * 1e-3) ** 2 + (10 * 1e-3) ** 2)) / 12;
  const iyy = (m * ((40 * 1e-3) ** 2 + (10 * 1e-3) ** 2)) / 12;
  const izz = (m * ((40 * 1e-3) ** 2 + (20 * 1e-3) ** 2)) / 12;
  rel((d.inertiaKgm2[0] as number[])[0] as number, ixx, 1e-9, 'Ixx');
  rel((d.inertiaKgm2[1] as number[])[1] as number, iyy, 1e-9, 'Iyy');
  rel((d.inertiaKgm2[2] as number[])[2] as number, izz, 1e-9, 'Izz');
  assert.ok(
    Math.abs((d.inertiaKgm2[0] as number[])[1] as number) < 1e-15,
    'products of inertia vanish',
  );
  assert.deepEqual(
    d.principal.map((q) => Math.round(q.momentKgm2 * 1e12)),
    [ixx, iyy, izz].map((x) => Math.round(x * 1e12)).sort((a, b) => a - b),
  );
});

test('solid cylinder r = 10, h = 40: I_axis = m r^2 / 2 and I_perp = m (3 r^2 + h^2) / 12 within 0.3%', async () => {
  const mp = massProps(await shape([{ op: 'cylinder', id: 'p', r: 10, h: 40 }]));
  const d = withDensity(mp, 7.85);
  const m = d.massG / 1000;
  rel(d.massG, Math.PI * 100 * 40 * 7.85e-3, 3e-3, 'mass');
  rel((d.inertiaKgm2[2] as number[])[2] as number, (m * 10e-3 ** 2) / 2, 5e-3, 'Izz');
  rel(
    (d.inertiaKgm2[0] as number[])[0] as number,
    (m * (3 * 10e-3 ** 2 + 40e-3 ** 2)) / 12,
    5e-3,
    'Ixx',
  );
  // principal moments are ascending: the smallest is about the cylinder axis (r / sqrt 2), the other two perpendicular
  rel(d.gyrationMm[0] as number, 10 / Math.SQRT2, 5e-3, 'gyration about the axis');
  rel(
    d.gyrationMm[2] as number,
    Math.sqrt((3 * 100 + 1600) / 12),
    5e-3,
    'gyration about a perpendicular axis',
  );
});

test('solid sphere r = 15: I = 2 m r^2 / 5 about any axis, COM at the centre', async () => {
  const mp = massProps(await shape([{ op: 'sphere', id: 'p', r: 15, at: [10, 0, 0] }]));
  const d = withDensity(mp, 1.24);
  const m = d.massG / 1000;
  rel(mp.centerOfMass[0], 10, 1e-4, 'COM x');
  for (const k of [0, 1, 2])
    rel((d.inertiaKgm2[k] as number[])[k] as number, (2 * m * 15e-3 ** 2) / 5, 6e-3, `I${k}`);
});

test('parallel axis: a bar swinging about its end has I = m L^2 / 3 (thin rod limit) plus its own section term', async () => {
  // 100 x 4 x 4 mm bar, pivot axis along Y through one end, bar lying along +X
  const mp = massProps(await shape([{ op: 'box', id: 'p', w: 100, d: 4, h: 4, at: [50, 0, 0] }]));
  const rho = 2.7;
  const m = (100 * 16 * rho) / 1e6; // kg
  const exact = (m * (100e-3 ** 2 + 4e-3 ** 2)) / 12 + m * 50e-3 ** 2;
  rel(inertiaAboutAxis(mp, rho, [0, 0, 0], [0, 1, 0]), exact, 1e-9, 'about the end pivot');
  // along the bar's own axis only the section matters: m (b^2 + c^2) / 12
  rel(
    inertiaAboutAxis(mp, rho, [0, 0, 0], [1, 0, 0]),
    (m * (4e-3 ** 2 + 4e-3 ** 2)) / 12,
    1e-9,
    'about its own axis',
  );
  // a non-axis-aligned axis through the COM uses the tensor: check against the explicit quadratic form
  const diag = inertiaAboutAxis(mp, rho, [50, 0, 0], [1, 0, 1]);
  const ix = (m * (4e-3 ** 2 + 4e-3 ** 2)) / 12;
  const iz = (m * (100e-3 ** 2 + 4e-3 ** 2)) / 12;
  rel(diag, (ix + iz) / 2, 1e-9, 'diagonal axis');
  assert.throws(() => inertiaAboutAxis(mp, rho, [0, 0, 0], [0, 0, 0]), /must not be zero/);
});

test('a drilled body: hole removes the right inertia (plate with a central hole equals plate minus hole disc)', async () => {
  const plate = massProps(
    await shape([
      { op: 'box', id: 'p', w: 60, d: 60, h: 6 },
      { op: 'hole', target: 'p', face: { normal: '+Z' }, uv: [0, 0], diameter: 20 },
    ]),
  );
  const rho = 2.7e-3; // g/mm3
  const mBox = 60 * 60 * 6 * rho;
  const mHole = Math.PI * 100 * 6 * rho;
  const izzBox = (mBox * (60 ** 2 + 60 ** 2)) / 12;
  const izzHole = (mHole * 10 ** 2) / 2;
  rel(
    withDensity(plate, 2.7).inertiaGmm2[2]?.[2] ?? 0,
    izzBox - izzHole,
    5e-3,
    'Izz of the drilled plate',
  );
});
