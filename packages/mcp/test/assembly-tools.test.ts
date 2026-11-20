import assert from 'node:assert/strict';
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
const text = (r: Reply) => r.content[0]?.text ?? '';

before(async () => {
  await initKernel();
  outDir = await mkdtemp(join(tmpdir(), 'contrapt-asm-'));
  const server = createMcpServer({ session: new Session('t'), outDir, viewerUrl: () => undefined });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
});
after(async () => {
  await client.close();
  await rm(outDir, { recursive: true, force: true });
});

test('a two-part enclosure: mate the lid on, check the assembly, read the BOM, sweep a hinge', async () => {
  await call('new_model', { name: 'box' });
  await call('add_step', { step: { op: 'box', id: 'base', w: 40, d: 30, h: 10, at: [0, 0, 5] } });
  await call('add_step', { step: { op: 'material', target: 'base', name: 'PLA' } });
  await call('add_step', { step: { op: 'box', id: 'lid', w: 40, d: 30, h: 4, at: [200, 0, 0] } });
  await call('add_step', { step: { op: 'material', target: 'lid', name: 'PLA' } });
  const mated = json(
    await call('add_step', {
      step: {
        op: 'mate',
        id: 'm1',
        target: 'lid',
        face: { normal: '-Z' },
        to: { body: 'base', normal: '+Z' },
        center: true,
        gap: 0.2,
      },
    }),
  );
  assert.equal(mated.ok, true, JSON.stringify(mated));
  assert.deepEqual(mated.bodies.lid.bbox_min_mm, [-20, -15, 10.2]);

  const asm = json(await call('check_assembly'));
  assert.equal(asm.verdict, 'NO INTERFERENCE');
  assert.equal(asm.tightest_clearance.gap_mm, 0.2);

  // push the lid down 0.5 mm into the base: now the assembly is wrong and says by how much
  await call('add_step', { step: { op: 'transform', target: 'lid', translate: [0, 0, -0.5] } });
  const bad = json(await call('check_assembly'));
  assert.equal(bad.verdict, '1 INTERFERING PAIR(S)');
  assert.equal(bad.interfering[0].overlap_mm3, 40 * 30 * 0.3);

  const bom = json(await call('bom'));
  assert.equal(bom.parts, 2);
  assert.equal(bom.lines.length, 2); // base and lid differ in height
  const expected =
    Math.round(((40 * 30 * 10 * 1.24) / 1000) * 1e4) / 1e4 +
    Math.round(((40 * 30 * 4 * 1.24) / 1000) * 1e4) / 1e4;
  assert.ok(Math.abs(bom.total_mass_g - expected) < 1e-3, `${bom.total_mass_g} vs ${expected}`);

  // lid lifting straight up never hits the base; pressing down does
  const up = json(await call('motion_check', { body: 'lid', translate: [0, 0, 50], steps: 10 }));
  assert.match(up.verdict, /ALREADY COLLIDING/); // it starts 0.3 mm inside the base
  await call('remove_step', { id: 'transform1' });
  const lift = json(await call('motion_check', { body: 'lid', translate: [0, 0, 50], steps: 10 }));
  assert.match(lift.verdict, /COLLISION-FREE/);
  const press = json(await call('motion_check', { body: 'lid', translate: [0, 0, -5], steps: 10 }));
  assert.match(press.verdict, /COLLIDES from step/);
});

test('assembly tools fail clearly', async () => {
  assert.match(
    text(await call('motion_check', { body: 'zz', translate: [1, 0, 0] })),
    /No body "zz"/,
  );
  assert.match(text(await call('motion_check', { body: 'lid' })), /"translate" or a "rotate"/);
  assert.match(text(await call('check_assembly', { bodies: ['base'] })), /at least two/);
  await call('new_model', { name: 'empty' });
  assert.match(text(await call('bom')), /no bodies/);
});

test('drawing writes an SVG sheet with the right dimensions and rejects bad names', async () => {
  await call('new_model', { name: 'Plate' });
  await call('add_step', { step: { op: 'box', id: 'p', w: 60, d: 30, h: 8 } });
  await call('add_step', { step: { op: 'material', target: 'p', name: 'PETG' } });
  const d = json(await call('drawing', { title: 'Plate', number: 'P-1' }));
  assert.equal(d.file, 'drawings/Plate.svg');
  assert.deepEqual(d.overall_mm, [60, 30, 8]);
  const svg = await readFile(join(outDir, 'drawings', 'Plate.svg'), 'utf8');
  assert.match(svg, /data-dim="width">60</);
  assert.match(svg, /PETG/);
  assert.match(text(await call('drawing', { name: '../x' })), /letters, digits/);
});

test('print_check reports overhangs and the better orientation through the tool', async () => {
  await call('new_model', { name: 'T' });
  await call('add_step', { step: { op: 'box', id: 'flange', w: 60, d: 20, h: 4, at: [0, 0, 22] } });
  await call('add_step', { step: { op: 'box', id: 'stem', w: 6, d: 20, h: 20, at: [0, 0, 10] } });
  await call('add_step', {
    step: { op: 'boolean', id: 'p', kind: 'union', a: 'flange', b: 'stem' },
  });
  const r = json(await call('print_check', { body: 'p', build_volume_mm: [220, 220, 250] }));
  assert.ok(Math.abs(r.current_orientation.overhangAreaMm2 - 1080) < 2);
  assert.notEqual(r.recommended_up, '+Z');
  assert.ok(r.findings.some((f: { severity: string }) => f.severity === 'warn'));
  assert.equal(r.current_orientation.fitsBuildVolume, true);
  assert.match(r.note, /not a slicer/);
  assert.match(text(await call('print_check', { body: 'zz' })), /No body "zz"/);
});
