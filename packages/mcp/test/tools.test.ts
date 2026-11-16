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
