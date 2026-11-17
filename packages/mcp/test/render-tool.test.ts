import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { initKernel } from '@contrapt/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server.ts';
import { Session } from '../src/session.ts';

type Block = { type: string; text?: string; mimeType?: string; data?: string };
let client: Client;
let dir: string;
const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Block[] };

before(async () => {
  await initKernel();
  dir = await mkdtemp(join(tmpdir(), 'contrapt-render-'));
  const server = createMcpServer({
    session: new Session('r'),
    outDir: dir,
    viewerUrl: () => undefined,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
});
after(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

test('render_view on an empty model says so', async () => {
  const r = await call('render_view');
  assert.equal(r.isError, true);
  assert.match(r.content[0]?.text ?? '', /no bodies/);
});

test('render_view returns real PNG images for each requested view, and saves them', async () => {
  await call('add_step', { step: { op: 'box', id: 'b', w: 40, d: 20, h: 10 } });
  const r = await call('render_view', { views: ['iso', 'top', 'front'], size: 256 });
  assert.ok(!r.isError, r.content[0]?.text ?? 'render failed');
  const images = r.content.filter((c) => c.type === 'image');
  assert.equal(images.length, 3);
  for (const im of images) {
    assert.equal(im.mimeType, 'image/png');
    assert.equal(
      Buffer.from(im.data ?? '', 'base64')
        .subarray(1, 4)
        .toString(),
      'PNG',
    );
  }
  const info = JSON.parse(r.content[0]?.text ?? '{}');
  assert.deepEqual(
    info.rendered.map((x: { view: string }) => x.view),
    ['iso', 'top', 'front'],
  );
  assert.match(info.rendered[1].camera, /top view, orthographic/);
  assert.ok(existsSync(join(dir, 'renders', 'r-iso.png')));
});

test('custom angles and validation', async () => {
  const r = await call('render_view', { azimuth: 120, elevation: 25, size: 200 });
  assert.ok(!r.isError);
  assert.match(JSON.parse(r.content[0]?.text ?? '{}').rendered[0].camera, /custom view/);
  const bad = await call('render_view', { size: 5 });
  assert.equal(bad.isError, true);
});
