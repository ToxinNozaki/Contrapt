// End-to-end over a real stdio subprocess. This is the test that proves the kernel's stdout chatter
// (STEP export prints "Statistics on Transfer") can no longer corrupt the JSON-RPC stream.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('stdio server: build, export STEP, and the protocol survives kernel output', async () => {
  const out = await mkdtemp(join(tmpdir(), 'contrapt-stdio-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, '--no-viewer', '--out', out],
  });
  const client = new Client({ name: 'stdio-test', version: '0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 10);

    const add = (await client.callTool({
      name: 'add_step',
      arguments: { step: { op: 'box', id: 'b', w: 20, d: 20, h: 20 } },
    })) as { content: { text: string }[] };
    assert.equal(JSON.parse(add.content[0]?.text ?? '{}').bodies.b.volume_mm3, 8000);

    // STEP export is exactly what makes OpenCASCADE print to stdout.
    const exp = (await client.callTool({
      name: 'export_model',
      arguments: { format: 'step', filename: 'cube' },
    })) as { isError?: boolean; content: { text: string }[] };
    assert.ok(!exp.isError, exp.content[0]?.text ?? 'export failed');
    assert.equal(JSON.parse(exp.content[0]?.text ?? '{}').file, 'exports/cube.step');

    // and the connection is still healthy afterwards
    const again = await client.listTools();
    assert.equal(again.tools.length, tools.length);
  } finally {
    await client.close();
    await rm(out, { recursive: true, force: true });
  }
});

test('stdio server: a conflicting constrained sketch (solver is chatty) does not corrupt the protocol', async () => {
  const out = await mkdtemp(join(tmpdir(), 'contrapt-stdio2-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, '--no-viewer', '--out', out],
  });
  const client = new Client({ name: 'stdio-test', version: '0' });
  try {
    await client.connect(transport);
    const step = (extra: object[]) => ({
      op: 'constrained_sketch',
      id: 'sk',
      plane: 'XY',
      points: { A: [1, 2], B: [35, -3], C: [38, 17], D: [-2, 22] },
      lines: { AB: ['A', 'B'], BC: ['B', 'C'], CD: ['C', 'D'], DA: ['D', 'A'] },
      constraints: [
        { type: 'fix', a: 'A', at: [0, 0] },
        { type: 'horizontal', a: 'AB' },
        { type: 'vertical', a: 'BC' },
        { type: 'horizontal', a: 'CD' },
        { type: 'vertical', a: 'DA' },
        { type: 'distance', a: 'A', b: 'B', value: 40 },
        { type: 'distance', a: 'B', b: 'C', value: 20 },
        ...extra,
      ],
      profile: [{ loop: ['AB', 'BC', 'CD', 'DA'] }],
    });
    const call = async (s: object) =>
      JSON.parse(
        (
          (await client.callTool({ name: 'add_step', arguments: { step: s } })) as {
            content: { text: string }[];
          }
        ).content[0]?.text ?? '{}',
      );
    const bad = await call(step([{ type: 'distance', a: 'A', b: 'B', value: 50 }]));
    assert.equal(bad.ok, false);
    await client.callTool({ name: 'remove_step', arguments: { id: 'sk' } });
    const red = await call(step([{ type: 'distance', a: 'A', b: 'B', value: 40 }])); // redundant: also prints
    assert.equal(red.ok, true);
    assert.equal((await client.listTools()).tools.length > 10, true); // connection still healthy
  } finally {
    await client.close();
    await rm(out, { recursive: true, force: true });
  }
});
