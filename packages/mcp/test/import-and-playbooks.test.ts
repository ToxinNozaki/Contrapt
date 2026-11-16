// End-to-end over the MCP protocol: knowledge tools, playbooks (as tools and as MCP prompts),
// knowledge resources, and importing files from other CAD programs.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { buildModel, exportStep, initKernel, ModelBuilder } from '@contrapt/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server.ts';
import { Session } from '../src/session.ts';

let client: Client;
let outDir: string;
let importsDir: string;

type Reply = { isError?: boolean; content: { type: string; text: string }[] };
const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as Reply;
const text = (r: Reply) => r.content[0]?.text ?? '';
const json = (r: Reply) => JSON.parse(text(r));
const close = (a: number, b: number, tol = 1e-2) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

const OLE = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);

before(async () => {
  await initKernel();
  outDir = await mkdtemp(join(tmpdir(), 'contrapt-imp-'));
  importsDir = join(outDir, 'imports');
  await mkdir(importsDir, { recursive: true });

  // a real STEP file (a 30 x 20 x 10 box) plus fake Inventor files
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'b', w: 30, d: 20, h: 10 });
  const step = await exportStep(await buildModel(b.toJSON()), 'b');
  await writeFile(join(importsDir, 'Mount Block.step'), step);
  await writeFile(join(importsDir, 'Bracket.ipt'), OLE);
  await writeFile(join(importsDir, 'Sheet1.idw'), OLE);
  await writeFile(join(importsDir, 'notes.txt'), 'hello');

  const session = new Session('imp', { importsDir });
  const server = createMcpServer({ session, outDir, viewerUrl: () => undefined });
  const [a, c] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(c)]);
});

after(async () => {
  await client.close();
  await rm(outDir, { recursive: true, force: true });
});

// ---- knowledge & playbooks -------------------------------------------------------------------
test('list_knowledge and get_knowledge', async () => {
  const { topics } = json(await call('list_knowledge'));
  assert.ok(topics.length >= 15);
  assert.ok(topics.some((t: { topic: string }) => t.topic === 'materials'));
  const doc = text(await call('get_knowledge', { topic: 'strength-and-stiffness' }));
  assert.match(doc, /Euler/);
  const bad = await call('get_knowledge', { topic: 'astrology' });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /Topics: engineering-method/);
});

test('get_playbook lists playbooks, and returns self-contained instructions', async () => {
  const list = json(await call('get_playbook'));
  const names = list.playbooks.map((p: { name: string }) => p.name);
  for (const n of [
    'engineer',
    'design_part',
    'design_review',
    'strength_check',
    'size_mechanism',
    'build_pack',
  ]) {
    assert.ok(names.includes(n), n);
  }
  const dp = list.playbooks.find((p: { name: string }) => p.name === 'design_part');
  assert.equal(dp.args.find((a: { name: string }) => a.name === 'goal').required, true);

  const t = text(
    await call('get_playbook', {
      name: 'design_part',
      args: { goal: 'a hook for a 3 kg bag', process: '3d-printing' },
    }),
  );
  assert.match(t, /a hook for a 3 kg bag/);
  assert.match(t, /Design for 3D printing/);
  const bad = await call('get_playbook', { name: 'design_part', args: { process: 'telepathy' } });
  assert.equal(bad.isError, true);
});

test('playbooks are also exposed as MCP prompts', async () => {
  const { prompts } = await client.listPrompts();
  assert.ok(prompts.length >= 9);
  assert.ok(prompts.some((p) => p.name === 'engineer'));
  const got = await client.getPrompt({
    name: 'design_review',
    arguments: { focus: 'will it print?' },
  });
  const first = got.messages[0];
  assert.ok(first, 'prompt returned no messages');
  const body = (first.content as { text: string }).text;
  assert.match(body, /will it print\?/);
  assert.match(body, /red-team checklist/i);
});

test('knowledge is exposed as MCP resources', async () => {
  const { resources } = await client.listResources();
  const k = resources.filter((r) => r.uri.startsWith('contrapt://knowledge/'));
  assert.ok(k.length >= 15);
  const r = await client.readResource({ uri: 'contrapt://knowledge/materials' });
  assert.match((r.contents[0] as { text: string }).text, /Aluminium 6061/);
});

test('server instructions point the AI at the playbook, knowledge and import tools', () => {
  const ins = client.getInstructions() ?? '';
  assert.match(ins, /get_playbook/);
  assert.match(ins, /get_knowledge/);
  assert.match(ins, /inspect_file/);
});

// ---- importing ---------------------------------------------------------------------------------
test('inspect_file lists the folder with an honest support level per file', async () => {
  const r = json(await call('inspect_file'));
  const by = Object.fromEntries(r.files.map((f: { file: string }) => [f.file, f]));
  assert.equal(by['Mount Block.step'].support, 'supported');
  assert.equal(by['Bracket.ipt'].support, 'via-step');
  assert.equal(by['Sheet1.idw'].kind, 'drawing');
  assert.equal(by['notes.txt'].support, 'unknown');
});

test('inspect_file explains an Inventor part and a drawing', async () => {
  const ipt = json(await call('inspect_file', { file: 'Bracket.ipt' }));
  assert.equal(ipt.support, 'via-step');
  assert.match(ipt.howTo, /File > Export > CAD Format > STEP/);
  const idw = json(await call('inspect_file', { file: 'Sheet1.idw' }));
  assert.match(idw.howTo, /no 3D geometry/);
  const step = json(await call('inspect_file', { file: 'Mount Block.step' }));
  assert.equal(step.step.solids, 1);
});

test('import_file brings a STEP in as an exact, measurable body', async () => {
  await call('new_model', { name: 'imported' });
  const r = json(await call('import_file', { file: 'Mount Block.step', id: 'block' }));
  assert.equal(r.ok, true, JSON.stringify(r));
  close(r.bodies.block.volume_mm3, 30 * 20 * 10);
  assert.deepEqual(r.bodies.block.bbox_size_mm, [30, 20, 10]);

  // build on it: fillet the vertical edges
  const f = json(
    await call('add_step', {
      step: { op: 'fillet', target: 'block', radius: 2, edges: { direction: 'Z', expect: 4 } },
    }),
  );
  assert.equal(f.ok, true, JSON.stringify(f));
  assert.ok(f.bodies.block.volume_mm3 < 6000);

  // the timeline records a checksum
  const tl = json(await call('get_model')).timeline;
  const imp = tl.steps.find((s: { op: string }) => s.op === 'import');
  assert.match(imp.sha256, /^[0-9a-f]{64}$/);
  assert.equal(imp.file, 'Mount Block.step');
});

test('import_file scale and position', async () => {
  await call('new_model');
  const r = json(
    await call('import_file', { file: 'Mount Block.step', id: 'inches', scale: 2, at: [50, 0, 0] }),
  );
  close(r.bodies.inches.volume_mm3, 6000 * 8);
  assert.deepEqual(r.bodies.inches.bbox_size_mm, [60, 40, 20]);
});

test('importing an Inventor part fails with instructions, and changes nothing', async () => {
  await call('new_model');
  const r = await call('import_file', { file: 'Bracket.ipt' });
  assert.equal(r.isError, true);
  assert.match(text(r), /Inventor/);
  assert.match(text(r), /STEP/);
  const steps = json(await call('get_model')).timeline.steps;
  assert.equal(steps.length, 0, 'a failed import must not leave a step behind');
});

test('only plain file names are accepted (no path traversal)', async () => {
  for (const evil of [
    '../secret.step',
    '..\\secret.step',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    'a/b.step',
    '..',
  ]) {
    for (const tool of ['inspect_file', 'import_file']) {
      const r = await call(tool, { file: evil });
      assert.equal(r.isError, true, `${tool} accepted "${evil}"`);
    }
  }
  const r = await call('inspect_file', { file: 'does-not-exist.step' });
  assert.equal(r.isError, true);
  assert.match(text(r), /No file "does-not-exist\.step" in the imports folder/);
});

test('a saved model with an import reloads, and fails loudly if the file changes', async () => {
  await call('new_model', { name: 'with-import' });
  await call('import_file', { file: 'Mount Block.step', id: 'blk' });
  await call('save_model', { name: 'with-import' });
  await call('new_model');
  const loaded = json(await call('load_model', { name: 'with-import' }));
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  close(loaded.bodies.blk.volume_mm3, 6000);

  const original = await readFile(join(importsDir, 'Mount Block.step'), 'utf8');
  await writeFile(join(importsDir, 'Mount Block.step'), `${original}\n/* modified */`);
  const again = json(await call('load_model', { name: 'with-import' }));
  assert.equal(again.ok, false);
  assert.match(again.error.message, /checksum mismatch/);
  await writeFile(join(importsDir, 'Mount Block.step'), original); // restore
});
