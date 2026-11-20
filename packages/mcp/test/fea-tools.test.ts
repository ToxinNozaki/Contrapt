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
