// MCP tool tests over an in-memory transport (real protocol, no subprocess).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

before(async () => {
  await initKernel();
  outDir = await mkdtemp(join(tmpdir(), 'contrapt-test-'));
  const session = new Session('test');
  const server = createMcpServer({ session, outDir, viewerUrl: () => 'http://localhost:0/' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
});

after(async () => {
  await client.close();
  await rm(outDir, { recursive: true, force: true });
});

test('lists the tools and the docs resource', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of [
    'get_docs',
    'add_step',
    'run_script',
    'measure',
    'export_model',
    'view',
    'save_model',
  ]) {
    assert.ok(names.includes(n), `missing tool ${n}`);
  }
  const add = tools.find((t) => t.name === 'add_step');
  assert.ok(
    JSON.stringify(add?.inputSchema).includes('fillet'),
    'add_step schema should describe ops',
  );
  const { resources } = await client.listResources();
  assert.ok(resources.some((r) => r.uri === 'contrapt://docs'));
});

test('get_docs returns verified conventions', async () => {
  const text = (await call('get_docs', { topic: 'conventions' })).content[0]?.text ?? '';
  assert.match(text, /XY: x->X, y->Y, extrudes \+Z/);
});

test('build a plate with tool calls and get verified numbers back', async () => {
  await call('new_model', { name: 'plate' });
  await call('set_param', { name: 't', value: 6 });
  const sk = json(
    await call('add_step', {
      step: {
        op: 'sketch',
        id: 'outline',
        plane: 'XY',
        profile: [{ shape: 'rect', w: 60, h: 40 }],
      },
    }),
  );
  assert.equal(sk.ok, true);
  const r = json(
    await call('add_step', {
      step: { op: 'extrude', id: 'plate', sketch: 'outline', distance: 't' },
    }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.bodies.plate.volume_mm3, 60 * 40 * 6);
  assert.deepEqual(r.bodies.plate.bbox_size_mm, [60, 40, 6]);
  assert.equal(r.params.t, 6);

  // parametric edit through the tool surface
  const r2 = json(await call('set_param', { name: 't', value: 10 }));
  assert.equal(r2.bodies.plate.volume_mm3, 60 * 40 * 10);
});

test('material step puts material and mass_g in the feedback and in measure', async () => {
  await call('new_model', { name: 'weigh' });
  await call('add_step', { step: { op: 'box', id: 'blk', w: 40, d: 20, h: 10 } });
  const r = json(
    await call('add_step', { step: { op: 'material', target: 'blk', name: '6061-T6' } }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.bodies.blk.material, '6061-T6');
  assert.equal(r.bodies.blk.mass_g, 21.6);
  const m = json(await call('measure', { body: 'blk' }));
  assert.equal(m.blk.material, '6061-T6');
  assert.equal(m.blk.massG, 21.6);
  const bad = await call('add_step', {
    step: { op: 'material', target: 'blk', name: 'unobtainium' },
  });
  assert.match(bad.content[0]?.text ?? '', /Invalid|invalid/);
});

test('invalid steps return a readable error, not a crash', async () => {
  const r = await call('add_step', { step: { op: 'box', w: 1 } });
  assert.equal(r.isError, true);
  assert.match(r.content[0]?.text ?? '', /d|h|required|Invalid/i);
  const r2 = await call('add_step', { step: { op: 'extrude', sketch: 'nope', distance: 1 } });
  assert.equal(r2.isError, true);
  assert.match(r2.content[0]?.text ?? '', /Unknown sketch "nope"/);
});

test('a failing step is reported with the model still usable', async () => {
  await call('new_model');
  await call('add_step', { step: { op: 'box', id: 'b', w: 40, d: 20, h: 10 } });
  const r = json(
    await call('add_step', {
      step: { op: 'fillet', id: 'f', target: 'b', radius: 3, edges: { direction: 'Z', expect: 7 } },
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.step, 'f');
  assert.match(r.error.message, /matched 4 but expected 7/);
  // fix it by replacing the step
  await call('remove_step', { id: 'f' });
  const fixed = json(
    await call('add_step', {
      step: { op: 'fillet', id: 'f', target: 'b', radius: 3, edges: { direction: 'Z', expect: 4 } },
    }),
  );
  assert.equal(fixed.ok, true);
});

test('run_script replaces the model; measure reports it', async () => {
  const r = json(
    await call('run_script', {
      script:
        "box({ id: 'c', w: 10, d: 10, h: 10 }); cylinder({ id: 'p', r: 2, h: 20 }); boolean({ id: 'out', kind: 'cut', a: 'c', b: 'p' });",
    }),
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  const m = json(await call('measure', { body: 'out' }));
  assert.ok(Math.abs(m.out.volume - (1000 - Math.PI * 4 * 10)) < 1e-2);
  const bad = await call('run_script', { script: 'while(true){}' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0]?.text ?? '', /Script failed/);
});

test('export_model writes STEP and STL only inside the output folder', async () => {
  const step = json(await call('export_model', { format: 'step', filename: 'part1' }));
  assert.equal(step.file, 'exports/part1.step');
  assert.ok(step.bytes > 100);
  const text = await readFile(join(outDir, 'exports', 'part1.step'), 'utf8');
  assert.match(text, /^ISO-10303-21;/);
  const stl = json(await call('export_model', { format: 'stl', filename: 'part1' }));
  assert.equal(stl.file, 'exports/part1.stl');

  for (const evil of ['../escape', '..\\escape', 'a/b', 'x.step', '']) {
    const r = await call('export_model', { format: 'step', filename: evil });
    assert.equal(r.isError, true, `filename "${evil}" should be rejected`);
  }
  assert.ok(!existsSync(join(outDir, '..', 'escape.step')));
});

test('save, list and load round-trip the timeline', async () => {
  await call('new_model', { name: 'keeper' });
  await call('add_step', { step: { op: 'sphere', id: 's', r: 5 } });
  assert.deepEqual(json(await call('save_model', { name: 'keeper' })), {
    saved: 'models/keeper.contrapt.json',
  });
  await call('new_model', { name: 'other' });
  assert.ok(json(await call('list_models')).models.includes('keeper'));
  const r = json(await call('load_model', { name: 'keeper' }));
  assert.equal(r.ok, true);
  assert.ok(r.bodies.s);
  const missing = await call('load_model', { name: 'does-not-exist' });
  assert.equal(missing.isError, true);
  const evil = await call('save_model', { name: '../../evil' });
  assert.equal(evil.isError, true);
});

test('view returns the viewer link', async () => {
  assert.equal(json(await call('view')).url, 'http://localhost:0/');
});

test('constrained sketches give the AI solver feedback: degrees of freedom, conflicts, then a verified solid', async () => {
  await call('new_model', { name: 'csk' });
  const sketch = (constraints: object[]) => ({
    op: 'constrained_sketch',
    id: 'sk',
    plane: 'XY',
    points: { A: [1, 2], B: [35, -3], C: [38, 17], D: [-2, 22] },
    lines: { AB: ['A', 'B'], BC: ['B', 'C'], CD: ['C', 'D'], DA: ['D', 'A'] },
    constraints,
    profile: [{ loop: ['AB', 'BC', 'CD', 'DA'] }],
  });
  const base = [
    { type: 'fix', a: 'A', at: [0, 0] },
    { type: 'horizontal', a: 'AB' },
    { type: 'vertical', a: 'BC' },
    { type: 'horizontal', a: 'CD' },
    { type: 'vertical', a: 'DA' },
    { type: 'distance', a: 'A', b: 'B', value: 'w' },
  ];
  await call('set_param', { name: 'w', value: 40 });

  // 1) one dimension missing: ok, but the report says what is still free
  const r1 = json(await call('add_step', { step: sketch(base) }));
  assert.equal(r1.ok, true);
  const s1 = r1.steps.find((s: { id: string }) => s.id === 'sk');
  assert.match(s1.note, /under-constrained: 1 degree\(s\) of freedom/);
  assert.equal(s1.data.dof, 1);

  // 2) a contradicting dimension: failure that names both constraints
  await call('remove_step', { id: 'sk' });
  const r2 = json(
    await call('add_step', {
      step: sketch([...base, { type: 'distance', a: 'A', b: 'B', value: 99 }]),
    }),
  );
  assert.equal(r2.ok, false);
  assert.match(
    r2.error.message,
    /Conflicting constraints.*#6 distance\(A, B, w\).*#7 distance\(A, B, 99\)/,
  );

  // 3) fully dimensioned, then extruded: a verified solid that follows the parameter
  await call('remove_step', { id: 'sk' });
  await call('add_step', {
    step: sketch([...base, { type: 'distance', a: 'B', b: 'C', value: 'w / 2' }]),
  });
  const r3 = json(
    await call('add_step', { step: { op: 'extrude', id: 'part', sketch: 'sk', distance: 10 } }),
  );
  assert.equal(r3.ok, true, JSON.stringify(r3));
  assert.equal(r3.bodies.part.volume_mm3, 40 * 20 * 10);
  const r4 = json(await call('set_param', { name: 'w', value: 60 }));
  assert.equal(r4.bodies.part.volume_mm3, 60 * 30 * 10);
});

test('check_interference reports overlap, touching and clear, and rejects bad ids', async () => {
  await call('new_model', { name: 'fit' });
  await call('add_step', { step: { op: 'box', id: 'a', w: 10, d: 10, h: 10 } });
  await call('add_step', { step: { op: 'box', id: 'b', w: 10, d: 10, h: 10, at: [5, 0, 0] } });
  await call('add_step', { step: { op: 'box', id: 'c', w: 10, d: 10, h: 10, at: [10, 0, 0] } });
  await call('add_step', { step: { op: 'box', id: 'd', w: 10, d: 10, h: 10, at: [20, 0, 0] } });
  const ab = json(await call('check_interference', { a: 'a', b: 'b' }));
  assert.equal(ab.status, 'interferes');
  assert.ok(Math.abs(ab.overlap_volume_mm3 - 500) < 1e-3);
  assert.deepEqual(ab.overlap_bbox_mm.min, [0, -5, -5]);
  assert.equal(json(await call('check_interference', { a: 'a', b: 'c' })).status, 'touching');
  const ad = json(await call('check_interference', { a: 'a', b: 'd' }));
  assert.equal(ad.status, 'clear');
  assert.ok(Math.abs(ad.min_gap_mm - 10) < 1e-6);
  assert.match(
    (await call('check_interference', { a: 'a', b: 'zz' })).content[0]?.text ?? '',
    /No body "zz"/,
  );
  assert.match(
    (await call('check_interference', { a: 'a', b: 'a' })).content[0]?.text ?? '',
    /two different/,
  );
});

test('analysis tools: section_properties, beam_check (with self weight) and column_check match hand calculations', async () => {
  await call('new_model', { name: 'beam' });
  await call('add_step', {
    step: { op: 'sketch', id: 'sec', plane: 'XY', profile: [{ shape: 'rect', w: 20, h: 5 }] },
  });
  const s = json(await call('section_properties', { sketch: 'sec' }));
  assert.ok(Math.abs(s.Ix - 208.333333) < 1e-4);
  assert.ok(Math.abs(s.Zx - 83.333333) < 1e-4);

  const b = json(
    await call('beam_check', {
      support: 'cantilever',
      load: 'point',
      value: 50,
      length_mm: 100,
      sketch: 'sec',
      material: '6061-T6',
    }),
  );
  assert.ok(Math.abs(b.max_deflection_mm - 1.1594) < 2e-3, `${b.max_deflection_mm}`);
  assert.ok(Math.abs(b.max_stress_MPa - 60) < 1e-6);
  assert.ok(Math.abs(b.safety_factor_vs_yield - 4.58) < 0.01);
  assert.match(b.note, /not a simulation/);

  // self weight adds w = rho * A * g = 2.7e-6 * 100 * 9.81 N/mm as a uniform load
  const sw = json(
    await call('beam_check', {
      support: 'cantilever',
      load: 'point',
      value: 50,
      length_mm: 100,
      sketch: 'sec',
      material: '6061-T6',
      self_weight: true,
    }),
  );
  const w = 2.7e-6 * 100 * 9.81;
  assert.ok(
    Math.abs(
      sw.max_deflection_mm - (b.max_deflection_mm + (w * 1e8) / ((8 * 69000 * (20 * 125)) / 12)),
    ) < 1e-3,
  );
  assert.ok(sw.max_stress_MPa > b.max_stress_MPa);

  const col = json(
    await call('column_check', {
      ends: 'pinned-pinned',
      length_mm: 500,
      sketch: 'sec',
      material: '6061-T6',
      axial_load_N: 10,
    }),
  );
  // smaller I = Iy-or-Ix whichever is less: 20 x 5 -> 208.33 mm^4
  assert.ok(Math.abs(col.critical_load_N - (Math.PI ** 2 * 69000 * 208.3333) / 500 ** 2) < 0.5);
  assert.equal(col.governs, 'buckling');
  assert.ok(col.buckling_safety_factor > 1);

  assert.match(
    (await call('beam_check', { support: 'cantilever', load: 'point', value: 1, length_mm: 10 }))
      .content[0]?.text ?? '',
    /sketch.*I_mm4/,
  );
  assert.match(
    (await call('section_properties', { sketch: 'nope' })).content[0]?.text ?? '',
    /No sketch "nope"/,
  );
});
