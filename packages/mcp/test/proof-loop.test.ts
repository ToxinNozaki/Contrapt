// The whole Proof Loop through the real MCP surface: spec -> fail -> optimise -> pass -> journal -> Build Pack.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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
  outDir = await mkdtemp(join(tmpdir(), 'contrapt-proof-'));
  const server = createMcpServer({ session: new Session('t'), outDir, viewerUrl: () => undefined });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
});
after(async () => {
  await client.close();
  await rm(outDir, { recursive: true, force: true });
});

test('the Proof Loop end to end: requirements fail, the optimiser fixes the thickness, specs pass, the pack is written', async () => {
  await call('new_model', { name: 'Test Arm' });
  await call('set_param', { name: 't', value: 3 });
  await call('add_step', {
    step: { op: 'sketch', id: 'sec', plane: 'XY', profile: [{ shape: 'rect', w: 20, h: 't' }] },
  });
  await call('add_step', { step: { op: 'extrude', id: 'arm', sketch: 'sec', distance: 100 } });
  await call('add_step', { step: { op: 'material', target: 'arm', name: '6061-T6' } });

  // requirement written first: the arm must survive 50 N at the tip with margin and not droop
  const added = json(
    await call('add_spec', {
      spec: {
        id: 'tip-load',
        kind: 'beam',
        sketch: 'sec',
        support: 'cantilever',
        load: 'point',
        value: 50,
        lengthMm: 100,
        material: '6061-T6',
        minSafetyFactor: 2,
        maxDeflectionMm: 2,
        description: 'must carry 50 N at the tip',
      },
    }),
  );
  // every change now reports the live verdict, so a failing design is impossible to miss
  assert.equal(added.specs.passing, '0/1');
  assert.match(added.specs.failing[0].detail, /deflection 5\.36/);

  const bad = json(await call('check_specs'));
  assert.match(bad.verdict, /1 OF 1 SPECS FAIL/);
  assert.equal(bad.results[0].status, 'FAIL');
  assert.equal(bad.results[0].estimate, true);
  assert.match(bad.caveat, /hand estimates/);

  // let the optimiser find the lightest arm that passes (hand value: 4.169 mm)
  await call('add_spec', { spec: { id: 'mass', kind: 'mass', body: 'arm', maxG: 60 } });
  const opt = json(
    await call('optimize_param', {
      param: 't',
      min: 2,
      max: 12,
      metric: 'mass',
      body: 'arm',
      goal: 'minimize',
      apply: true,
    }),
  );
  assert.equal(opt.applied, true);
  assert.ok(opt.best.value >= 4.169 && opt.best.value < 4.18, `${opt.best.value}`);
  assert.ok(opt.trials.some((t: { feasible: boolean }) => !t.feasible));

  const good = json(await call('check_specs'));
  assert.equal(good.verdict, 'ALL SPECS PASS');
  const pack0 = json(await call('set_param', { name: 'unused', value: 1 }));
  assert.equal(pack0.specs, 'all 2 pass');

  await call('journal_add', {
    kind: 'decision',
    text: 'Thinnest 6061 arm meeting 2 mm droop at 50 N',
  });
  assert.equal(json(await call('get_journal')).entries.length, 1);

  const pack = json(await call('build_pack', {}));
  assert.equal(pack.folder, 'buildpacks/Test_Arm');
  assert.equal(pack.verdict, 'ALL SPECS PASS');
  const files = await readdir(join(outDir, 'buildpacks', 'Test_Arm'));
  for (const f of ['README.md', 'arm.step', 'arm.stl', 'model.contrapt.json'])
    assert.ok(files.includes(f), f);
  const readme = await readFile(join(outDir, 'buildpacks', 'Test_Arm', 'README.md'), 'utf8');
  assert.match(readme, /All 2 requirements pass/);
  assert.match(readme, /\| arm \| 6061-T6 \|/);
  assert.match(readme, /decision.*Thinnest 6061 arm/);
  assert.match(readme, /hand estimates/);
  const saved = JSON.parse(
    await readFile(join(outDir, 'buildpacks', 'Test_Arm', 'model.contrapt.json'), 'utf8'),
  );
  assert.equal(saved.specs.length, 2);
  assert.equal(saved.journal.length, 1);
});

test('specs ride along in save_model / load_model', async () => {
  await call('save_model', { name: 'with-specs' });
  await call('new_model', { name: 'blank' });
  assert.equal(json(await call('get_journal')).entries.length, 0);
  await call('load_model', { name: 'with-specs' });
  assert.equal(json(await call('get_journal')).entries.length, 1);
  assert.equal(json(await call('check_specs')).verdict, 'ALL SPECS PASS');
});

test('proof tools fail clearly: no specs, bad ids, unwritable pack name, failing model', async () => {
  await call('new_model', { name: 'empty' });
  assert.equal(json(await call('check_specs')).verdict, 'NO SPECS');
  assert.match(text(await call('remove_spec', { id: 'zz' })), /No spec "zz"/);
  assert.match(text(await call('build_pack', {})), /no bodies/);
  await call('add_step', { step: { op: 'box', id: 'b', w: 1, d: 1, h: 1 } });
  assert.match(
    text(
      await call('optimize_param', {
        param: 'q',
        min: 0,
        max: 1,
        metric: 'volume',
        body: 'b',
        goal: 'minimize',
      }),
    ),
    /Add at least one spec/,
  );
  assert.match(text(await call('build_pack', { name: '../escape' })), /letters, digits/);
  const pack = json(await call('build_pack', {}));
  assert.equal(pack.verdict, 'NO SPECS');
  assert.match(
    await readFile(join(outDir, 'buildpacks', 'empty', 'README.md'), 'utf8'),
    /No requirements were written/,
  );
});

test('FEA-backed specs: pending in the live status, run by check_specs, and visible to the viewer as pending until then', async () => {
  await call('new_model', { name: 'FEA Arm' });
  await call('add_step', {
    step: { op: 'sketch', id: 'sec', plane: 'XY', profile: [{ shape: 'rect', w: 20, h: 6 }] },
  });
  await call('add_step', { step: { op: 'extrude', id: 'arm', sketch: 'sec', distance: 100 } });
  const nodes = { n0: [0, 0, 0], n1: [50, 0, 0], n2: [100, 0, 0] };
  const members = [
    { id: 'a', a: 'n0', b: 'n1', material: '6061-T6', section: { sketch: 'sec' } },
    { id: 'b', a: 'n1', b: 'n2', material: '6061-T6', section: { sketch: 'sec' } },
  ];
  const added = json(
    await call('add_spec', {
      spec: {
        id: 'tip-fea',
        kind: 'frame',
        frame: {
          nodes,
          members,
          supports: [{ node: 'n0', fix: 'fixed' }],
          loads: [{ node: 'n2', force: [0, 0, -50] }],
        },
        maxDisplacementMm: 1,
        minSafetyFactor: 4,
      },
    }),
  );
  // heavy analysis is not run on every reply: it is pending, not failing
  assert.deepEqual(added.specs.pending_run_check_specs, ['tip-fea']);
  assert.equal(added.specs.failing, undefined);
  const full = json(await call('check_specs'));
  assert.equal(full.verdict, 'ALL SPECS PASS');
  assert.equal(full.results[0].fea, true);
  assert.match(full.results[0].detail, /max displacement \(n2\) 0\.67/);
  assert.match(full.caveat, /finite-element/);
  // a tighter requirement fails with the FEA number in the reason
  await call('add_spec', {
    spec: {
      id: 'tip-fea',
      kind: 'frame',
      frame: {
        nodes,
        members,
        supports: [{ node: 'n0', fix: 'fixed' }],
        loads: [{ node: 'n2', force: [0, 0, -50] }],
      },
      maxDisplacementMm: 0.4,
    },
  });
  const bad = json(await call('check_specs'));
  assert.match(bad.verdict, /1 OF 1 SPECS FAIL/);
  assert.match(bad.results[0].detail, /EXCEEDS max 0\.4/);
});
