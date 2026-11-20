// Frame FEA validated against closed-form beam theory. Every number below can be checked by hand.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFrame, type FrameInput, type FrameMember, frameModes } from '../src/index.ts';

const rel = (a: number, b: number, tol: number, what = '') =>
  assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${what} ${a} vs ${b}`);

// steel, round bar d = 10 mm: A = 78.54, I = pi d^4 / 64 = 490.87, J = 981.7, c = 5
const E = 200000;
const I = (Math.PI * 10 ** 4) / 64;
const sect = {
  E,
  A: Math.PI * 25,
  Iy: I,
  Iz: I,
  J: 2 * I,
  cy: 5,
  cz: 5,
  density: 7.85,
  yield: 250,
};

/** A straight chain of n members from p to q with nodes n0..nN. */
function chain(
  p: [number, number, number],
  q: [number, number, number],
  n: number,
  extra: Partial<FrameMember> = {},
) {
  const nodes: FrameInput['nodes'] = {};
  const members: FrameMember[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    nodes[`n${i}`] = [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
  }
  for (let i = 0; i < n; i++)
    members.push({ id: `m${i}`, a: `n${i}`, b: `n${i + 1}`, ...sect, ...extra });
  return { nodes, members, last: `n${n}` };
}
const FIXED = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const;

test('cantilever along X, tip load along -Z: deflection F L^3 / 3 E I, root moment F L, reaction F, stress M c / I', () => {
  const L = 200;
  const F = 50;
  const c = chain([0, 0, 0], [L, 0, 0], 4);
  const r = analyzeFrame({
    nodes: c.nodes,
    members: c.members,
    supports: [{ node: 'n0', fix: [...FIXED] }],
    loads: [{ node: c.last, force: [0, 0, -F] }],
  });
  rel(r.displacements[c.last]?.[2] ?? 0, -(F * L ** 3) / (3 * E * I), 1e-9, 'tip deflection');
  rel(r.reactions.n0?.[2] ?? 0, F, 1e-9, 'reaction');
  rel(Math.abs(r.reactions.n0?.[4] ?? 0), F * L, 1e-9, 'root moment');
  rel(r.worstMember?.maxStress ?? 0, (F * L * 5) / I, 1e-9, 'root stress');
  assert.equal(r.worstMember?.id, 'm0');
  rel(r.worstMember?.safetyFactor ?? 0, 250 / ((F * L * 5) / I), 1e-9);
  assert.ok(r.equilibriumErrorN < 1e-6, `${r.equilibriumErrorN}`);
});

test('the other bending plane uses Iz: a weak-axis load deflects more by the inertia ratio', () => {
  const L = 150;
  const F = 20;
  const Iweak = I / 4;
  const c = chain([0, 0, 0], [L, 0, 0], 2, { Iz: Iweak, J: I + Iweak });
  const r = analyzeFrame({
    nodes: c.nodes,
    members: c.members,
    supports: [{ node: 'n0', fix: [...FIXED] }],
    loads: [{ node: c.last, force: [0, F, 0] }],
  });
  rel(r.displacements[c.last]?.[1] ?? 0, (F * L ** 3) / (3 * E * Iweak), 1e-9);
  // the strong axis is unaffected by Iz
  const s = analyzeFrame({
    nodes: c.nodes,
    members: c.members,
    supports: [{ node: 'n0', fix: [...FIXED] }],
    loads: [{ node: c.last, force: [0, 0, F] }],
  });
  rel(s.displacements[c.last]?.[2] ?? 0, (F * L ** 3) / (3 * E * I), 1e-9);
});

test('orientation does not matter: the same round cantilever along Y, vertical Z and a diagonal gives the same tip deflection', () => {
  const L = 180;
  const F = 30;
  const expected = (F * L ** 3) / (3 * E * I);
  const dirs: [number, number, number][] = [
    [0, 1, 0],
    [0, 0, 1],
    [1, 2, 3],
    [-2, 1, -1],
  ];
  for (const d of dirs) {
    const n = Math.hypot(...d);
    const end: [number, number, number] = [(d[0] * L) / n, (d[1] * L) / n, (d[2] * L) / n];
    const c = chain([0, 0, 0], end, 3);
    // a force perpendicular to the member: cross product with an arbitrary axis, normalised
    const arb: [number, number, number] = Math.abs(d[0] / n) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const perp: [number, number, number] = [
      d[1] * arb[2] - d[2] * arb[1],
      d[2] * arb[0] - d[0] * arb[2],
      d[0] * arb[1] - d[1] * arb[0],
    ];
    const pn = Math.hypot(...perp);
    const force: [number, number, number] = [
      (perp[0] * F) / pn,
      (perp[1] * F) / pn,
      (perp[2] * F) / pn,
    ];
    const r = analyzeFrame({
      nodes: c.nodes,
      members: c.members,
      supports: [{ node: 'n0', fix: [...FIXED] }],
      loads: [{ node: c.last, force }],
    });
    const u = r.displacements[c.last] as number[];
    rel(
      Math.hypot(u[0] as number, u[1] as number, u[2] as number),
      expected,
      1e-8,
      `direction ${d}`,
    );
    assert.ok(r.equilibriumErrorN < 1e-6);
  }
});

test('simply supported beam with a uniform load: reactions w L / 2, mid moment w L^2 / 8, mid deflection 5 w L^4 / 384 E I', () => {
  const L = 400;
  const w = 0.2; // N/mm
  const c = chain([0, 0, 0], [L, 0, 0], 2, { w: [0, 0, -w] });
  const r = analyzeFrame({
    nodes: c.nodes,
    members: c.members,
    supports: [
      { node: 'n0', fix: ['ux', 'uy', 'uz', 'rx'] },
      { node: 'n2', fix: ['uy', 'uz'] },
    ],
  });
  rel(r.reactions.n0?.[2] ?? 0, (w * L) / 2, 1e-9);
  rel(r.reactions.n2?.[2] ?? 0, (w * L) / 2, 1e-9);
  rel(r.displacements.n1?.[2] ?? 0, -(5 * w * L ** 4) / (384 * E * I), 1e-9, 'mid deflection');
  const maxM = Math.max(...r.members.map((m) => m.maxMomentY));
  rel(maxM, (w * L * L) / 8, 1e-9, 'mid moment');
  assert.ok(r.equilibriumErrorN < 1e-9);
});

test('a single long member with a distributed load still finds the mid-span moment between its nodes', () => {
  const L = 300;
  const w = 0.5;
  const c = chain([0, 0, 0], [L, 0, 0], 1, { w: [0, 0, -w] });
  const r = analyzeFrame({
    nodes: c.nodes,
    members: c.members,
    supports: [
      { node: 'n0', fix: ['ux', 'uy', 'uz', 'rx'] },
      { node: 'n1', fix: ['uy', 'uz'] },
    ],
  });
  rel(r.members[0]?.maxMomentY ?? 0, (w * L * L) / 8, 1e-9);
  rel(r.members[0]?.maxStress ?? 0, (((w * L * L) / 8) * 5) / I, 1e-9);
});

test('fixed-fixed beam with a centre load: delta F L^3 / 192 E I and wall moment F L / 8', () => {
  const L = 300;
  const F = 100;
  const c = chain([0, 0, 0], [L, 0, 0], 2);
  const r = analyzeFrame({
    nodes: c.nodes,
    members: c.members,
    supports: [
      { node: 'n0', fix: [...FIXED] },
      { node: 'n2', fix: [...FIXED] },
    ],
    loads: [{ node: 'n1', force: [0, 0, -F] }],
  });
  rel(r.displacements.n1?.[2] ?? 0, -(F * L ** 3) / (192 * E * I), 1e-9);
  rel(Math.abs(r.reactions.n0?.[4] ?? 0), (F * L) / 8, 1e-9);
});

test('torsion: a tip torque twists a cantilever by T L / G J', () => {
  const L = 250;
  const T = 4000;
  const c = chain([0, 0, 0], [L, 0, 0], 3);
  const r = analyzeFrame({
    nodes: c.nodes,
    members: c.members,
    supports: [{ node: 'n0', fix: [...FIXED] }],
    loads: [{ node: c.last, moment: [T, 0, 0] }],
  });
  rel(r.displacements[c.last]?.[3] ?? 0, (T * L) / ((E / 2.6) * 2 * I), 1e-9);
});

test('axial load: elongation F L / E A', () => {
  const L = 100;
  const c = chain([0, 0, 0], [L, 0, 0], 2);
  const r = analyzeFrame({
    nodes: c.nodes,
    members: c.members,
    supports: [{ node: 'n0', fix: [...FIXED] }],
    loads: [{ node: c.last, force: [1000, 0, 0] }],
  });
  rel(r.displacements[c.last]?.[0] ?? 0, (1000 * L) / (E * Math.PI * 25), 1e-9);
  rel(r.members[0]?.maxStress ?? 0, 1000 / (Math.PI * 25), 1e-9);
});

test('gravity: a steel cantilever bar sags by w L^4 / 8 E I with w = rho A g', () => {
  const L = 300;
  const c = chain([0, 0, 0], [L, 0, 0], 3);
  const r = analyzeFrame({
    nodes: c.nodes,
    members: c.members,
    supports: [{ node: 'n0', fix: [...FIXED] }],
    gravity: true,
  });
  const w = 7.85e-6 * Math.PI * 25 * 9.81;
  rel(r.displacements[c.last]?.[2] ?? 0, -(w * L ** 4) / (8 * E * I), 1e-9);
  rel(r.reactions.n0?.[2] ?? 0, w * L, 1e-9);
  rel((r.totalMassTonne ?? 0) * 1e6, 7.85e-3 * Math.PI * 25 * L, 1e-9, 'mass in grams');
});

test('rollDeg turns the section: rolled 90 degrees a weak-axis member bends about the strong plane instead', () => {
  const L = 150;
  const F = 20;
  const Iweak = I / 4;
  const base = { Iz: Iweak, J: I + Iweak };
  const run = (rollDeg: number) => {
    const c = chain([0, 0, 0], [L, 0, 0], 2, { ...base, rollDeg });
    return analyzeFrame({
      nodes: c.nodes,
      members: c.members,
      supports: [{ node: 'n0', fix: [...FIXED] }],
      loads: [{ node: c.last, force: [0, 0, -F] }],
    }).displacements[c.last]?.[2] as number;
  };
  rel(run(0), -(F * L ** 3) / (3 * E * I), 1e-9);
  rel(run(90), -(F * L ** 3) / (3 * E * Iweak), 1e-9);
});

test('a portal frame is in equilibrium and antisymmetric under a sideways load', () => {
  const H = 3000;
  const W = 800;
  const nodes = {
    a: [0, 0, 0],
    b: [0, 0, 400],
    c: [W, 0, 400],
    d: [W, 0, 0],
  } as FrameInput['nodes'];
  const members: FrameMember[] = [
    { id: 'colL', a: 'a', b: 'b', ...sect },
    { id: 'beam', a: 'b', b: 'c', ...sect },
    { id: 'colR', a: 'd', b: 'c', ...sect },
  ];
  const r = analyzeFrame({
    nodes,
    members,
    supports: [
      { node: 'a', fix: [...FIXED] },
      { node: 'd', fix: [...FIXED] },
    ],
    loads: [{ node: 'b', force: [H, 0, 0] }],
  });
  assert.ok(r.equilibriumErrorN < 1e-6, `${r.equilibriumErrorN}`);
  rel((r.reactions.a?.[0] ?? 0) + (r.reactions.d?.[0] ?? 0), -H, 1e-9);
  // equal and opposite vertical reactions (overturning couple), equal horizontal shares by symmetry of the columns
  rel(r.reactions.a?.[2] ?? 0, -(r.reactions.d?.[2] ?? 0), 1e-6);
  // column shears are close but not identical: the beam stretches axially, so the two columns do not share the load exactly
  rel(r.reactions.a?.[0] ?? 0, r.reactions.d?.[0] ?? 0, 5e-3);
  // moment equilibrium about the left base: H x 400 = Rz_d x W - sum of base moments... checked via the solver's own balance
  assert.ok((r.maxDisplacement.value ?? 0) > 0);
});

test('errors: unstable structures, missing supports, unknown nodes and bad members explain themselves', () => {
  const c = chain([0, 0, 0], [100, 0, 0], 1);
  assert.throws(
    () => analyzeFrame({ nodes: c.nodes, members: c.members, supports: [] }),
    /No supports/,
  );
  assert.throws(
    () =>
      analyzeFrame({
        nodes: c.nodes,
        members: c.members,
        supports: [{ node: 'n0', fix: ['ux', 'uy', 'uz'] }],
        loads: [{ node: 'n1', force: [0, 0, 1] }],
      }),
    /unstable/,
  );
  assert.throws(
    () =>
      analyzeFrame({
        nodes: c.nodes,
        members: [{ ...(c.members[0] as FrameMember), b: 'zz' }],
        supports: [{ node: 'n0', fix: [...FIXED] }],
      }),
    /unknown node "zz"/,
  );
  assert.throws(
    () =>
      analyzeFrame({
        nodes: { a: [0, 0, 0], b: [0, 0, 0] },
        members: [{ id: 'm', a: 'a', b: 'b', ...sect }],
        supports: [{ node: 'a', fix: [...FIXED] }],
      }),
    /zero length/,
  );
  assert.throws(
    () =>
      analyzeFrame({
        nodes: c.nodes,
        members: [{ ...(c.members[0] as FrameMember), A: 0 }],
        supports: [{ node: 'n0', fix: [...FIXED] }],
      }),
    /A must be positive/,
  );
  assert.throws(
    () =>
      analyzeFrame({
        nodes: c.nodes,
        members: c.members,
        supports: [{ node: 'n0', fix: [...FIXED] }],
        loads: [{ node: 'q', force: [1, 0, 0] }],
      }),
    /unknown node "q"/,
  );
  assert.throws(
    () =>
      analyzeFrame({
        nodes: c.nodes,
        members: [{ ...(c.members[0] as FrameMember), density: undefined }],
        supports: [{ node: 'n0', fix: [...FIXED] }],
        gravity: true,
      }),
    /needs a density for gravity/,
  );
});

test('modal analysis: cantilever first and second bending frequencies match Euler-Bernoulli (1.8751 and 4.6941)', () => {
  const L = 200;
  const rho = 7.85e-9;
  const Iw = (10 * 5 ** 3) / 12; // 10 wide x 5 thick: weak axis
  const A = 50;
  const c = chain([0, 0, 0], [L, 0, 0], 10, {
    A,
    Iy: (5 * 10 ** 3) / 12,
    Iz: Iw,
    J: 100,
    cy: 2.5,
    cz: 5,
  });
  const m = frameModes(
    { nodes: c.nodes, members: c.members, supports: [{ node: 'n0', fix: [...FIXED] }] },
    4,
  );
  const f = (k: number) => ((k * k) / (2 * Math.PI)) * Math.sqrt((E * Iw) / (rho * A * L ** 4));
  rel(m.frequencies[0] ?? 0, f(1.8751), 5e-3, 'f1');
  assert.ok(
    m.frequencies.some((x) => Math.abs(x - f(4.6941)) < 5e-3 * f(4.6941)),
    `weak-axis f2 missing: ${m.frequencies}`,
  );
  // the stiff-axis modes come later, in the ratio sqrt(I_strong / I_weak) = 4 (squared dimension ratio)
  const strong1 =
    (1.8751 ** 2 / (2 * Math.PI)) * Math.sqrt((E * ((5 * 10 ** 3) / 12)) / (rho * A * L ** 4));
  assert.ok(
    m.frequencies.some((x) => Math.abs(x - strong1) < 5e-3 * strong1),
    `${m.frequencies} vs ${strong1}`,
  );
});

test('modal analysis: a pinned-pinned beam has f1 = (pi / 2) sqrt(E I / rho A L^4)', () => {
  const L = 300;
  const rho = 7.85e-9;
  const c = chain([0, 0, 0], [L, 0, 0], 8);
  const m = frameModes(
    {
      nodes: c.nodes,
      members: c.members,
      supports: [
        { node: 'n0', fix: ['ux', 'uy', 'uz', 'rx'] },
        { node: 'n8', fix: ['uy', 'uz'] },
      ],
    },
    3,
  );
  const expected = (Math.PI / 2) * Math.sqrt((E * I) / (rho * sect.A * L ** 4));
  rel(m.frequencies[0] ?? 0, expected, 2e-3, 'f1');
  // the second bending mode is four times the first
  assert.ok(m.frequencies.some((x) => Math.abs(x - 4 * expected) < 1e-2 * 4 * expected));
});

test('modal analysis needs densities and is limited in size', () => {
  const c = chain([0, 0, 0], [100, 0, 0], 2, { density: undefined });
  assert.throws(
    () =>
      frameModes({
        nodes: c.nodes,
        members: c.members,
        supports: [{ node: 'n0', fix: [...FIXED] }],
      }),
    /needs a density for modal/,
  );
  const big = chain([0, 0, 0], [1000, 0, 0], 70);
  assert.throws(
    () =>
      frameModes({
        nodes: big.nodes,
        members: big.members,
        supports: [{ node: 'n0', fix: [...FIXED] }],
      }),
    /too many/,
  );
});
