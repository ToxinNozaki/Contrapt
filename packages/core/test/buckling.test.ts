// Linear buckling of frames validated against Euler's column formulas for every classic end condition.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Dof, type FrameInput, type FrameMember, frameBuckling } from '../src/index.ts';

const rel = (a: number, b: number, tol: number, what = '') =>
  assert.ok(
    Math.abs(a - b) <= tol * Math.abs(b),
    `${what} ${a} vs ${b} (${(((a - b) / b) * 100).toFixed(3)}%)`,
  );

const E = 200000;
const L = 300;
const P = 1000; // applied compressive load, N
const round = {
  E,
  A: Math.PI * 25,
  Iy: (Math.PI * 10 ** 4) / 64,
  Iz: (Math.PI * 10 ** 4) / 64,
  J: (Math.PI * 10 ** 4) / 32,
  cy: 5,
  cz: 5,
};
const I = round.Iy;
const FIXED: Dof[] = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];

function column(left: Dof[], right: Dof[], extra: Partial<FrameMember> = {}, n = 8): FrameInput {
  const nodes: FrameInput['nodes'] = {};
  const members: FrameMember[] = [];
  for (let i = 0; i <= n; i++) nodes[`n${i}`] = [(L * i) / n, 0, 0];
  for (let i = 0; i < n; i++)
    members.push({ id: `m${i}`, a: `n${i}`, b: `n${i + 1}`, ...round, ...extra });
  return {
    nodes,
    members,
    supports: [{ node: 'n0', fix: left }, ...(right.length ? [{ node: `n${n}`, fix: right }] : [])],
    loads: [{ node: `n${n}`, force: [-P, 0, 0] }],
  };
}

const euler = (k: number) => (Math.PI ** 2 * E * I) / (k * L) ** 2;

test('Euler columns: fixed-free, pinned-pinned, fixed-fixed and fixed-pinned buckle at pi^2 E I / (K L)^2 within 0.5%', () => {
  const cases: [string, Dof[], Dof[], number][] = [
    ['fixed-free', FIXED, [], 2.0],
    ['pinned-pinned', ['ux', 'uy', 'uz', 'rx'], ['uy', 'uz', 'rx'], 1.0],
    ['fixed-fixed', FIXED, ['uy', 'uz', 'rx', 'ry', 'rz'], 0.5],
    ['fixed-pinned', FIXED, ['uy', 'uz', 'rx'], 0.6992], // effective length factor 0.699 (P_cr = 2.0457 pi^2 E I / L^2)
  ];
  for (const [name, left, right, k] of cases) {
    const r = frameBuckling(column(left, right), 2);
    assert.equal(r.tensionOnly, false, name);
    const critical = (r.loadFactors[0] as number) * P;
    rel(critical, euler(k), 5e-3, name);
  }
});

test('the load factor is the multiplier on the applied load: halving the load doubles the factor', () => {
  const a = frameBuckling(column(['ux', 'uy', 'uz', 'rx'], ['uy', 'uz', 'rx']));
  const half = column(['ux', 'uy', 'uz', 'rx'], ['uy', 'uz', 'rx']);
  half.loads = [{ node: 'n8', force: [-P / 2, 0, 0] }];
  const b = frameBuckling(half);
  rel(b.loadFactors[0] as number, 2 * (a.loadFactors[0] as number), 1e-9);
  rel(a.axialForces.m3 as number, -P, 1e-9, 'axial force');
});

test('a rectangular bar buckles about its weak axis first; the next mode is the strong axis at I ratio, or the second weak mode at 4x', () => {
  const w = 10;
  const h = 20;
  const rect = {
    A: w * h,
    Iy: (w * h ** 3) / 12,
    Iz: (h * w ** 3) / 12,
    J: 3000,
    cy: w / 2,
    cz: h / 2,
  };
  const r = frameBuckling(column(['ux', 'uy', 'uz', 'rx'], ['uy', 'uz', 'rx'], rect), 3);
  const weak = (Math.PI ** 2 * E * rect.Iz) / L ** 2;
  const strong = (Math.PI ** 2 * E * rect.Iy) / L ** 2;
  rel((r.loadFactors[0] as number) * P, weak, 5e-3, 'weak axis');
  // strong / weak = (h / w)^2 = 4 and the second weak-axis mode is also 4x: the factors coincide
  rel((r.loadFactors[1] as number) * P, Math.min(strong, 4 * weak), 1e-2, 'second mode');
});

test('tension-only structures have nothing to buckle', () => {
  const t = column(['ux', 'uy', 'uz', 'rx'], ['uy', 'uz', 'rx']);
  t.loads = [{ node: 'n8', force: [P, 0, 0] }];
  const r = frameBuckling(t);
  assert.equal(r.tensionOnly, true);
  assert.deepEqual(r.loadFactors, []);
  assert.match(r.notes.join(' '), /nothing to buckle/);
});

test('doubling a column length cuts its buckling load to a quarter (1 / L^2)', () => {
  const short = frameBuckling(column(FIXED, []));
  rel((short.loadFactors[0] as number) * P, euler(2), 5e-3);
  const doubled = column(FIXED, []);
  for (const n of Object.keys(doubled.nodes))
    doubled.nodes[n] = [((doubled.nodes[n] as number[])[0] as number) * 2, 0, 0];
  const long = frameBuckling(doubled);
  rel(
    (short.loadFactors[0] as number) / (long.loadFactors[0] as number),
    4,
    5e-3,
    'twice the length = a quarter of the load',
  );
});

test('errors: unstable structures are reported, and meshes that are too big are refused', () => {
  const free = column(['ux', 'uy', 'uz'], []);
  free.loads = [{ node: 'n8', force: [-P, 0, 0] }];
  assert.throws(() => frameBuckling(free), /unstable/);
  assert.throws(() => frameBuckling(column(FIXED, [], {}, 70)), /too many/);
});
