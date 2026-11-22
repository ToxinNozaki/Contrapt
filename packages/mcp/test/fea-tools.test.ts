import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { initKernel } from '@contrapt/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server.ts';
import { Session } from '../src/session.ts';

let client: Client;
let outDir: string;
type Reply = { isError?: boolean; content: { type: string; text: string }[] };
const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as Reply;
const json = (r: Reply) => JSON.parse(r.content[0]?.text ?? '{}');
const text = (r: Reply) => r.content[0]?.text ?? '';

before(async () => {
  await initKernel();
  outDir = await mkdtemp(join(tmpdir(), 'contrapt-fea-'));
  const server = createMcpServer({ session: new Session('t'), outDir, viewerUrl: () => undefined });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
});
after(async () => {
  await client.close();
  await rm(outDir, { recursive: true, force: true });
});

// 6061 cantilever, 20 wide x 5 deep (deep = local z = up), 100 long, 50 N down at the tip.
// Hand numbers (strength pack worked example): deflection 1.158 mm, root stress 60 MPa.
const nodes = { n0: [0, 0, 0], n1: [25, 0, 0], n2: [50, 0, 0], n3: [75, 0, 0], n4: [100, 0, 0] };
const members = [0, 1, 2, 3].map((i) => ({
  id: `m${i}`,
  a: `n${i}`,
  b: `n${i + 1}`,
  material: '6061-T6',
  section: { shape: 'rect', w: 20, h: 5 },
}));

test('frame_analysis reproduces the strength-pack worked example (cantilever arm, 50 N tip load)', async () => {
  const r = json(
    await call('frame_analysis', {
      nodes,
      members,
      supports: [{ node: 'n0', fix: 'fixed' }],
      loads: [{ node: 'n4', force: [0, 0, -50] }],
    }),
  );
  assert.ok(
    Math.abs(r.displacements_mm_rad.n4[2] + 1.1594) < 2e-3,
    `${r.displacements_mm_rad.n4[2]}`,
  );
  assert.equal(r.max_displacement.node, 'n4');
  assert.ok(Math.abs(r.members[0].max_stress_MPa - 60) < 1e-6);
  assert.ok(Math.abs(r.members[0].safety_factor - 4.58) < 0.01);
  assert.match(r.verdict, /safety factor 4\.58 \(ok for static loads\)/);
  assert.ok(Math.abs(r.reactions_N_Nmm.n0[2] - 50) < 1e-6);
  assert.ok(r.equilibrium_error_N < 1e-6);
  assert.match(r.notes.join(' '), /not a certification/);
});

test('flipping the section 90 degrees (rollDeg) makes the same arm far floppier, and a 5 mm round tube is checked too', async () => {
  const base = {
    nodes,
    supports: [{ node: 'n0', fix: 'fixed' }],
    loads: [{ node: 'n4', force: [0, 0, -50] }],
  };
  const rolled = json(
    await call('frame_analysis', {
      ...base,
      members: members.map((m) => ({ ...m, rollDeg: 90 })),
    }),
  );
  // rolled: bending about the 20 mm dimension, depth 20 / width 5 would be stiffer; here depth along z becomes 20, so stiffer by 16x
  assert.ok(Math.abs(rolled.displacements_mm_rad.n4[2]) < 0.2);
  const tube = json(
    await call('frame_analysis', {
      ...base,
      members: members.map((m) => ({ ...m, section: { shape: 'round_tube', d: 20, t: 2 } })),
    }),
  );
  const I = (Math.PI * (20 ** 4 - 16 ** 4)) / 64;
  assert.ok(Math.abs(tube.displacements_mm_rad.n4[2] + (50 * 100 ** 3) / (3 * 69000 * I)) < 1e-4);
});

test('a sketch can be the section, and gravity plus a distributed load work through the tool', async () => {
  await call('new_model', { name: 'fea' });
  await call('add_step', {
    step: { op: 'sketch', id: 'sec', plane: 'XY', profile: [{ shape: 'rect', w: 20, h: 5 }] },
  });
  const r = json(
    await call('frame_analysis', {
      nodes: { a: [0, 0, 0], b: [100, 0, 0] },
      members: [
        {
          id: 'm',
          a: 'a',
          b: 'b',
          material: '6061-T6',
          section: { sketch: 'sec' },
          load: [0, 0, -0.1],
        },
      ],
      supports: [{ node: 'a', fix: 'fixed' }],
      gravity: true,
    }),
  );
  const g = 2.7e-6 * 100 * 9.81; // own weight, N/mm
  const w = 0.1 + g;
  assert.ok(Math.abs(r.reactions_N_Nmm.a[2] - w * 100) < 1e-3);
  assert.ok(Math.abs(r.total_mass_g - 2.7 * 100 * 100 * 1e-3) < 1e-6);
  assert.ok(Math.abs(r.members[0].max_moment_y_Nmm - (w * 100 * 100) / 2) < 1e-2);
});

test('frame_modes matches the Euler-Bernoulli cantilever frequency within 0.5%', async () => {
  const L = 200;
  const n = 10;
  const ns: Record<string, number[]> = {};
  const ms = [];
  for (let i = 0; i <= n; i++) ns[`n${i}`] = [(L * i) / n, 0, 0];
  for (let i = 0; i < n; i++)
    ms.push({
      id: `m${i}`,
      a: `n${i}`,
      b: `n${i + 1}`,
      material: 'mild-steel',
      section: { shape: 'rect', w: 10, h: 5 },
    });
  const r = json(
    await call('frame_modes', {
      nodes: ns,
      members: ms,
      supports: [{ node: 'n0', fix: 'fixed' }],
      count: 4,
    }),
  );
  const I = (10 * 5 ** 3) / 12; // the 5 mm direction is up (local z), so bending down uses Iy = w h^3 / 12
  const expected =
    (1.8751 ** 2 / (2 * Math.PI)) * Math.sqrt((200000 * I) / (7.85e-9 * 50 * L ** 4));
  assert.ok(
    Math.abs(r.frequencies_hz[0] - expected) < 5e-3 * expected,
    `${r.frequencies_hz} vs ${expected}`,
  );
});

test('frame tools fail clearly', async () => {
  const bad = (over: Record<string, unknown>) =>
    call('frame_analysis', {
      nodes: { a: [0, 0, 0], b: [10, 0, 0] },
      members: [{ id: 'm', a: 'a', b: 'b', material: 'PLA', section: { shape: 'round', d: 5 } }],
      supports: [{ node: 'a', fix: 'fixed' }],
      ...over,
    });
  assert.match(
    text(
      await bad({
        supports: [{ node: 'a', fix: 'pinned' }],
        loads: [{ node: 'b', force: [0, 0, 1] }],
      }),
    ),
    /unstable/,
  );
  assert.match(text(await bad({ loads: [{ node: 'zz', force: [1, 0, 0] }] })), /unknown node "zz"/);
  assert.match(
    text(
      await bad({
        members: [{ id: 'm', a: 'a', b: 'b', material: 'TPU', section: { shape: 'round', d: 5 } }],
      }),
    ),
    /no modulus/,
  );
  assert.match(
    text(
      await bad({
        members: [{ id: 'm', a: 'a', b: 'b', material: 'PLA', section: { sketch: 'nope' } }],
      }),
    ),
    /No sketch "nope"/,
  );
  assert.match(
    text(
      await bad({
        members: [
          {
            id: 'm',
            a: 'a',
            b: 'b',
            material: 'PLA',
            section: { shape: 'round_tube', d: 5, t: 3 },
          },
        ],
      }),
    ),
    /too thick/,
  );
});

test('solid_fea: a 120 x 6 x 6 aluminium cantilever through the tool matches beam theory, and warns about coarse grids', async () => {
  await call('new_model', { name: 'solid' });
  await call('add_step', { step: { op: 'box', id: 'p', w: 120, d: 6, h: 6, at: [60, 0, 0] } });
  const r = json(
    await call('solid_fea', {
      body: 'p',
      material: '6061-T6',
      element_size_mm: 1,
      supports: [{ region: { face: { normal: '-X' } } }],
      loads: [{ region: { face: { normal: '+X' } }, force: [0, 0, -60] }],
    }),
  );
  const I = (6 * 6 ** 3) / 12;
  const expected = (60 * 120 ** 3) / (3 * 69000 * I);
  assert.ok(
    Math.abs(r.max_displacement.mm - expected) < 0.06 * expected,
    `${r.max_displacement.mm} vs ${expected}`,
  );
  assert.equal(r.solver.converged, true);
  assert.ok(r.equilibrium_error_N < 0.1);
  assert.ok(r.von_mises_MPa.peak > r.von_mises_MPa.median);
  assert.ok(r.safety_factor.p99 > 0);
  assert.match(r.notes[0], /not a certification/);
  assert.ok(Math.abs(r.mesh.volume_ratio - 1) < 1e-6);

  // the default grid is chosen automatically and the same model still solves
  const auto = json(
    await call('solid_fea', {
      body: 'p',
      material: '6061-T6',
      supports: [{ region: { face: { normal: '-X' } } }],
      loads: [{ region: { face: { normal: '+X' } }, force: [0, 0, -60] }],
    }),
  );
  assert.ok(auto.mesh.elements > 500 && auto.mesh.elements < 40000, `${auto.mesh.elements}`);
  assert.ok(Math.abs(auto.max_displacement.mm - expected) < 0.2 * expected);

  // a too-coarse grid is called out
  const coarse = json(
    await call('solid_fea', {
      body: 'p',
      material: '6061-T6',
      element_size_mm: 3,
      supports: [{ region: { face: { normal: '-X' } } }],
      loads: [{ region: { face: { normal: '+X' } }, force: [0, 0, -60] }],
    }),
  );
  assert.ok((coarse.warnings ?? []).some((w: string) => /elements across/.test(w)));
  assert.match(
    text(
      await call('solid_fea', {
        body: 'zz',
        material: 'PLA',
        supports: [{ region: { face: { normal: '-X' } } }],
      }),
    ),
    /No body "zz"/,
  );
  assert.match(
    text(
      await call('solid_fea', {
        body: 'p',
        material: 'TPU',
        supports: [{ region: { face: { normal: '-X' } } }],
      }),
    ),
    /no modulus/,
  );
});

test('mechanism tools: a slider-crank stroke and a four-bar verdict through the MCP surface', async () => {
  const sc = json(
    await call('mechanism_sweep', {
      points: { O: [0, 0], A: [30, 0], B: [130, 0] },
      grounds: ['O'],
      links: [{ a: 'A', b: 'B' }],
      sliders: [{ point: 'B', axis: 'y' }],
      crank: { pivot: 'O', tip: 'A', from_deg: 0, to_deg: 360 },
      track: ['B'],
      steps: 36,
    }),
  );
  assert.match(sc.verdict, /assembles through the whole range \(37 poses\)/);
  assert.ok(Math.abs(sc.extents_mm.B.maxX - sc.extents_mm.B.minX - 60) < 0.01);
  assert.ok(sc.poses.length <= 37);
  const fb = json(await call('fourbar_check', { ground: 50, crank: 20, coupler: 55, rocker: 40 }));
  assert.equal(fb.type, 'crank-rocker');
  assert.equal(fb.crank_turns_fully, true);
  assert.ok(fb.transmission_angle_deg.min > 25 && fb.transmission_angle_deg.max < 155);
  assert.match(fb.quality, /transmission|force transfer|marginal|jam/i);
  const lock = json(
    await call('mechanism_sweep', {
      points: { O2: [0, 0], O4: [50, 0], B: [0, 40], C: [18.9, 50.4] },
      grounds: ['O2', 'O4'],
      links: [
        { a: 'B', b: 'C' },
        { a: 'C', b: 'O4' },
      ],
      crank: { pivot: 'O2', tip: 'B', from_deg: 90, to_deg: 450 },
    }),
  );
  assert.ok(typeof lock.verdict === 'string');
  assert.match(
    text(
      await call('mechanism_sweep', {
        points: { O: [0, 0] },
        grounds: ['O'],
        links: [{ a: 'O', b: 'Q' }],
        crank: { pivot: 'O', tip: 'O', from_deg: 0, to_deg: 1 },
      }),
    ),
    /unknown pin "Q"/,
  );
});

test('CAD inertia drives a physical pendulum: mass_properties of a bar feeds dynamics_sim and matches 2 pi sqrt(J / (m g d))', async () => {
  await call('new_model', { name: 'pendulum' });
  await call('add_step', { step: { op: 'box', id: 'bar', w: 200, d: 10, h: 4, at: [100, 0, 0] } });
  await call('add_step', { step: { op: 'material', target: 'bar', name: 'mild-steel' } });
  const mp = json(
    await call('mass_properties', {
      body: 'bar',
      axis: { origin: [0, 0, 0], direction: [0, 1, 0] },
    }),
  );
  const m = (200 * 10 * 4 * 7.85) / 1e6; // kg
  assert.ok(Math.abs(mp.mass_g - m * 1000) < 1e-3);
  const J = (m * (0.2 ** 2 + 0.004 ** 2)) / 12 + m * 0.1 ** 2; // about the pivot at one end
  assert.ok(
    Math.abs(mp.inertia_about_axis_kgm2 - J) < 1e-4 * J,
    `${mp.inertia_about_axis_kgm2} vs ${J}`,
  );
  const sim = json(
    await call('dynamics_sim', {
      kind: 'rotary',
      inertia: mp.inertia_about_axis_kgm2,
      gravity: { mass: m, arm_m: 0.1 },
      q0: 0.05,
      duration_s: 8,
    }),
  );
  const expected = 2 * Math.PI * Math.sqrt(J / (m * 9.80665 * 0.1));
  assert.ok(
    Math.abs(sim.oscillation_period_s - expected) < 3e-3 * expected,
    `${sim.oscillation_period_s} vs ${expected}`,
  );
  assert.ok(sim.energy_drift_relative < 1e-6);
  assert.ok(sim.series.length <= 60);
  assert.match(text(await call('mass_properties', { body: 'nope' })), /No body "nope"/);
  await call('add_step', { step: { op: 'box', id: 'raw', w: 5, d: 5, h: 5, at: [50, 0, 0] } });
  assert.match(text(await call('mass_properties', { body: 'raw' })), /no material/);
  assert.match(
    text(
      await call('dynamics_sim', {
        kind: 'rotary',
        inertia: 1,
        duration_s: 1,
        limits: { min: 2, max: 1 },
      }),
    ),
    /below limits.max/,
  );
});

test('solid_fea reads the stress concentration of a plate with a hole within 5% of the handbook value, and reports the fitted mesh', async () => {
  await call('new_model', { name: 'holeplate' });
  await call('add_step', { step: { op: 'box', id: 'p', w: 40, d: 40, h: 4 } });
  await call('add_step', {
    step: { op: 'hole', target: 'p', face: { normal: '+Z' }, uv: [0, 0], diameter: 10 },
  });
  const F = 10 * 40 * 4;
  const args = {
    body: 'p',
    material: '6061-T6',
    element_size_mm: 1,
    supports: [{ region: { face: { normal: '-X' } } }],
    loads: [{ region: { face: { normal: '+X' } }, force: [F, 0, 0] }],
  };
  const fitted = json(await call('solid_fea', args));
  const kt = 3 - 3.14 * 0.25 + 3.667 * 0.25 ** 2 - 1.527 * 0.25 ** 3; // Peterson, net section
  const net = F / (30 * 4);
  assert.ok(
    Math.abs(fitted.von_mises_MPa.peak / net - kt) < 0.05 * kt,
    `Kt ${fitted.von_mises_MPa.peak / net}`,
  );
  assert.equal(fitted.mesh.fitted, true);
  assert.ok(fitted.mesh.snapped_nodes > 50);
  assert.ok(fitted.mesh.min_jacobian_ratio > 0.3);
  assert.ok(Math.abs(fitted.mesh.volume_ratio - 1) < 5e-3);
  assert.ok(fitted.von_mises_MPa.peak_element_average <= fitted.von_mises_MPa.peak);
  const stair = json(await call('solid_fea', { ...args, fit: false }));
  assert.equal(stair.mesh.fitted, false);
  assert.equal(stair.mesh.snapped_nodes, 0);
});

test('frame_buckling: a pinned aluminium strut buckles at the Euler load, and tension-only frames report nothing to buckle', async () => {
  const L = 200;
  const n = 8;
  const ns: Record<string, number[]> = {};
  const ms = [];
  for (let i = 0; i <= n; i++) ns[`n${i}`] = [(L * i) / n, 0, 0];
  for (let i = 0; i < n; i++)
    ms.push({
      id: `m${i}`,
      a: `n${i}`,
      b: `n${i + 1}`,
      material: '6061-T6',
      section: { shape: 'round', d: 8 },
    });
  const base = {
    nodes: ns,
    members: ms,
    supports: [
      { node: 'n0', fix: ['ux', 'uy', 'uz', 'rx'] },
      { node: 'n8', fix: ['uy', 'uz', 'rx'] },
    ],
  };
  const r = json(
    await call('frame_buckling', { ...base, loads: [{ node: 'n8', force: [-100, 0, 0] }] }),
  );
  const I = (Math.PI * 8 ** 4) / 64;
  const euler = (Math.PI ** 2 * 69000 * I) / L ** 2;
  assert.ok(
    Math.abs(r.load_factors[0] * 100 - euler) < 5e-3 * euler,
    `${r.load_factors[0] * 100} vs ${euler}`,
  );
  assert.ok(Math.abs(r.member_axial_forces_N.m4 + 100) < 1e-3);
  assert.match(r.verdict, /lowest buckling load factor/);
  const t = json(
    await call('frame_buckling', { ...base, loads: [{ node: 'n8', force: [100, 0, 0] }] }),
  );
  assert.match(t.verdict, /nothing to buckle/);
  assert.deepEqual(t.load_factors, []);
});

test('thermal_analysis: an aluminium fin matches the closed-form tip temperature, the heat balance closes, and thermal stress follows', async () => {
  await call('new_model', { name: 'fin' });
  await call('add_step', { step: { op: 'box', id: 'fin', w: 50, d: 5, h: 5, at: [25, 0, 0] } });
  await call('add_step', { step: { op: 'material', target: 'fin', name: '6061-T6' } });
  const sides = ['+Y', '-Y', '+Z', '-Z'].map((n) => ({
    region: { face: { normal: n } },
    h_w_m2k: 100,
    ambient_c: 20,
  }));
  const args = {
    body: 'fin',
    element_size_mm: 1,
    fixed_temperatures: [{ region: { face: { normal: '-X' } }, temperature_c: 100 }],
    convections: sides,
  };
  const r = json(await call('thermal_analysis', args));
  const k = 167; // 6061-T6 in the library
  const m = Math.sqrt((100e-6 * 20) / ((k / 1000) * 25));
  const tip = 20 + 80 / Math.cosh(m * 50);
  assert.ok(
    Math.abs(r.temperature_c.min - tip) < 0.012 * tip,
    `tip ${r.temperature_c.min} vs ${tip}`,
  );
  assert.equal(r.temperature_c.max, 100);
  assert.ok(Math.abs(r.heat_w.imbalance) < 1e-6);
  assert.match(r.verdict, /heat balance closes/);
  const Q = (k / 1000) * 25 * m * 80 * Math.tanh(m * 50);
  assert.ok(Math.abs(r.heat_w.in_through_fixed_temperature_surfaces - Q) < 0.02 * Q);
  assert.equal(r.material.conductivity_w_mk, 167);
  assert.equal(r.thermal_stress, undefined);

  // thermal stress on the same mesh: clamp the root completely, so the swelling root is restrained
  const s = json(
    await call('thermal_analysis', {
      ...args,
      stress: { supports: [{ region: { face: { normal: '-X' } } }], reference_temperature_c: 20 },
    }),
  );
  assert.ok(s.thermal_stress.von_mises_MPa.peak > 1, 'a clamped, heated root carries stress');
  assert.ok(s.thermal_stress.safety_factor_p99 > 0);
  assert.equal(s.thermal_stress.converged, true);
  assert.ok(s.thermal_stress.max_displacement.mm > 0.01, 'the free end grows');
  assert.ok(s.thermal_stress.equilibrium_error_N < 1e-2);
});

test('thermal_analysis fails clearly: no material, no conductivity, no driver, bad regions', async () => {
  await call('new_model', { name: 'errs' });
  await call('add_step', { step: { op: 'box', id: 'p', w: 20, d: 10, h: 10, at: [10, 0, 0] } });
  const base = {
    body: 'p',
    fixed_temperatures: [{ region: { face: { normal: '-X' } }, temperature_c: 50 }],
    convections: [{ region: { face: { normal: '+X' } }, h_w_m2k: 10, ambient_c: 20 }],
  };
  assert.match(text(await call('thermal_analysis', base)), /no material/);
  assert.match(
    text(await call('thermal_analysis', { ...base, material: 'TPU' })),
    /no thermal conductivity/,
  );
  assert.match(
    text(await call('thermal_analysis', { body: 'zz', material: 'PLA' })),
    /No body "zz"/,
  );
  assert.match(
    text(await call('thermal_analysis', { body: 'p', material: 'copper' })),
    /at least one fixed-temperature surface or a convection surface/,
  );
  assert.match(
    text(
      await call('thermal_analysis', {
        ...base,
        material: 'brass',
        convections: [
          { region: { box: { min: [5, -1, -1], max: [6, 1, 1] } }, h_w_m2k: 10, ambient_c: 20 },
        ],
      }),
    ),
    /no exposed surface faces lie in that region/,
  );
  const ok = json(
    await call('thermal_analysis', { ...base, material: 'copper', element_size_mm: 2.5 }),
  );
  assert.ok(ok.temperature_c.max <= 50 + 1e-9);
  assert.ok(ok.temperature_c.min >= 20 - 1e-9);
});

test('solid_modes: an aluminium cantilever through the tool reports beam-theory frequencies and where each mode moves', async () => {
  await call('new_model', { name: 'modes' });
  await call('add_step', { step: { op: 'box', id: 'arm', w: 100, d: 10, h: 5, at: [50, 0, 0] } });
  await call('add_step', { step: { op: 'material', target: 'arm', name: '6061-T6' } });
  const r = json(
    await call('solid_modes', {
      body: 'arm',
      supports: [{ region: { face: { normal: '-X' } } }],
      count: 3,
    }),
  );
  const I = (10 * 5 ** 3) / 12;
  const f1 = (1.8751 ** 2 / (2 * Math.PI)) * Math.sqrt((69000 * I) / (2.7e-9 * 50 * 100 ** 4));
  assert.ok(Math.abs(r.frequencies_hz[0] - f1) < 0.015 * f1, `${r.frequencies_hz[0]} vs ${f1}`);
  assert.equal(r.modes[0].mainly_along, 'Z');
  assert.ok(r.modes[0].moves_most_at_mm[0] > 99, 'the free end moves most');
  assert.equal(r.solver.converged, true);
  assert.ok(Math.abs(r.mass_g - 13.5) < 1e-6);
  assert.match(r.verdict, /lowest natural frequency 4[01]\d(\.\d+)? Hz \(mainly along Z\)/);
  assert.match(r.notes[0], /at least 30% away/);
  assert.match(
    text(
      await call('solid_modes', {
        body: 'zz',
        material: 'PLA',
        supports: [{ region: { face: { normal: '-X' } } }],
      }),
    ),
    /No body "zz"/,
  );
  assert.match(
    text(
      await call('solid_modes', {
        body: 'arm',
        material: 'TPU',
        supports: [{ region: { face: { normal: '-X' } } }],
      }),
    ),
    /no modulus/,
  );
});
