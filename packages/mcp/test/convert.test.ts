// convert_file: runs an external converter safely. A stand-in "converter" script plays the role of cadmpeg so
// these tests need no Rust and never run third-party code.
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  buildModel,
  exportStep,
  initKernel,
  ModelBuilder,
  makeInventorLikeFixture,
} from '@contrapt/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server.ts';
import { Session } from '../src/session.ts';

type Reply = { isError?: boolean; content: { type: string; text: string }[] };
let dir: string;
let importsDir: string;
let configured: Client;
let unconfigured: Client;

const call = async (c: Client, name: string, args: Record<string, unknown> = {}) =>
  (await c.callTool({ name, arguments: args })) as Reply;
const text = (r: Reply) => r.content[0]?.text ?? '';
const json = (r: Reply) => JSON.parse(text(r));

// The stand-in converter: `node fake.mjs convert <in> -o <out>`
const FAKE = `
import { readFileSync, writeFileSync } from 'node:fs';
const [cmd, input, flag, output] = process.argv.slice(2);
if (cmd !== 'convert' || flag !== '-o') { console.error('unexpected arguments: ' + process.argv.slice(2).join(' ')); process.exit(9); }
const src = readFileSync(input, 'latin1');
if (src.includes('BADFILE')) { console.error('error: unsupported container version'); process.exit(3); }
if (src.includes('GARBAGE')) { writeFileSync(output, 'this is not a step file at all, just some text that is long enough to pass a size check .......................................................'); process.exit(0); }
writeFileSync(output, readFileSync(new URL('./payload.step', import.meta.url)));
console.log('converted ok');
`;

async function connect(converters?: { cadmpeg?: { command: string; prefixArgs?: string[] } }) {
  const session = new Session('conv', { importsDir });
  const server = createMcpServer({ session, outDir: dir, viewerUrl: () => undefined, converters });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

before(async () => {
  await initKernel();
  dir = await mkdtemp(join(tmpdir(), 'contrapt-conv-'));
  importsDir = join(dir, 'imports');
  await mkdir(importsDir, { recursive: true });

  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'b', w: 20, d: 10, h: 5 });
  await writeFile(join(dir, 'payload.step'), await exportStep(await buildModel(b.toJSON()), 'b'));
  await writeFile(join(dir, 'fake-converter.mjs'), FAKE);

  await writeFile(join(importsDir, 'Good Part.ipt'), makeInventorLikeFixture());
  await writeFile(join(importsDir, 'Bad.ipt'), `BADFILE${'x'.repeat(200)}`);
  await writeFile(join(importsDir, 'Garbage.ipt'), `GARBAGE${'x'.repeat(200)}`);
  await writeFile(join(importsDir, 'notes.txt'), 'hello');

  configured = await connect({
    cadmpeg: { command: process.execPath, prefixArgs: [join(dir, 'fake-converter.mjs')] },
  });
  unconfigured = await connect();
});

after(async () => {
  await configured.close();
  await unconfigured.close();
  await rm(dir, { recursive: true, force: true });
});

test('without a configured converter the tool explains how to enable it', async () => {
  const r = await call(unconfigured, 'convert_file', { file: 'Good Part.ipt' });
  assert.equal(r.isError, true);
  assert.match(text(r), /No converter is configured/);
  assert.match(text(r), /--cadmpeg/);
  assert.match(text(r), /export STEP/i);
});

test('convert then import: the whole route works and the result is exact', async () => {
  const c = await call(configured, 'convert_file', { file: 'Good Part.ipt' });
  assert.ok(!c.isError, text(c));
  const data = json(c);
  assert.equal(data.converted, 'Good Part.ipt.converted.step');
  assert.match(data.next, /import_file/);
  assert.equal(data.converterReport, 'converted ok');

  const imp = json(await call(configured, 'import_file', { file: data.converted, id: 'part' }));
  assert.equal(imp.ok, true, JSON.stringify(imp));
  assert.ok(Math.abs(imp.bodies.part.volume_mm3 - 1000) < 1e-3);
  assert.deepEqual(imp.bodies.part.bbox_size_mm, [20, 10, 5]);
});

test('a converter failure is reported with its message and a fallback', async () => {
  const r = await call(configured, 'convert_file', { file: 'Bad.ipt' });
  assert.equal(r.isError, true);
  assert.match(text(r), /could not convert "Bad\.ipt" \(exit 3\)/);
  assert.match(text(r), /unsupported container version/);
  assert.match(text(r), /Export STEP from the original program/);
});

test('output that is not a real STEP file is rejected, not trusted', async () => {
  const r = await call(configured, 'convert_file', { file: 'Garbage.ipt' });
  assert.equal(r.isError, true);
  assert.match(text(r), /not a usable STEP file/);
});

test('only convertible extensions, plain names, and existing files', async () => {
  assert.match(
    text(await call(configured, 'convert_file', { file: 'notes.txt' })),
    /does not handle \.txt/,
  );
  assert.match(
    text(await call(configured, 'convert_file', { file: 'Missing.ipt' })),
    /No file "Missing\.ipt"/,
  );
  // an AI cannot smuggle flags or paths through the file name
  for (const evil of [
    '--help',
    '-o',
    '../x.ipt',
    '..\\x.ipt',
    'a/b.ipt',
    'x.ipt; calc',
    '/etc/passwd',
  ]) {
    const r = await call(configured, 'convert_file', { file: evil });
    assert.equal(r.isError, true, `accepted "${evil}"`);
    assert.doesNotMatch(text(r), /converted ok/);
  }
});

// Optional regression harness for the real thing. Never runs in CI and needs no private files in the repo:
//   CONTRAPT_SAMPLE_IPT=/path/to/part.ipt CONTRAPT_CADMPEG=/path/to/cadmpeg npm test -w @contrapt/mcp
const sample = process.env.CONTRAPT_SAMPLE_IPT;
const realConverter = process.env.CONTRAPT_CADMPEG;
test('REAL: cadmpeg converts a real Inventor part and Contrapt imports it as an exact solid', {
  skip: !(sample && realConverter),
}, async () => {
  const real = await mkdtemp(join(tmpdir(), 'contrapt-real-'));
  try {
    await mkdir(join(real, 'imports'), { recursive: true });
    await copyFile(sample as string, join(real, 'imports', 'real part.ipt'));
    const session = new Session('real', { importsDir: join(real, 'imports') });
    const server = createMcpServer({
      session,
      outDir: real,
      viewerUrl: () => undefined,
      converters: { cadmpeg: { command: realConverter as string } },
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'real', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);

    const c = await call(client, 'convert_file', { file: 'real part.ipt' });
    assert.ok(!c.isError, text(c));
    const imp = json(await call(client, 'import_file', { file: json(c).converted, id: 'part' }));
    assert.equal(imp.ok, true, JSON.stringify(imp));
    assert.ok(imp.bodies.part.volume_mm3 > 0, 'imported body should have volume');
    assert.ok(imp.bodies.part.bbox_size_mm.every((n: number) => n > 0));
    await client.close();
  } finally {
    await rm(real, { recursive: true, force: true });
  }
});
