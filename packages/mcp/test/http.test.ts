import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { initKernel } from '@contrapt/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type HttpHandle, startHttp } from '../src/http.ts';
import { Session } from '../src/session.ts';

let dir: string;
let session: Session;
let open: HttpHandle;
let locked: HttpHandle;
const TOKEN = 's3cret-token-for-tests';

before(async () => {
  await initKernel();
  dir = await mkdtemp(join(tmpdir(), 'contrapt-http-'));
  session = new Session('http', {});
  const ctx = { session, outDir: dir, viewerUrl: () => undefined };
  open = await startHttp(ctx, { port: 4700 });
  locked = await startHttp(ctx, {
    port: 4720,
    token: TOKEN,
    allowedHosts: ['tunnel.example.test'],
  });
});
after(async () => {
  await open.close();
  await locked.close();
  await rm(dir, { recursive: true, force: true });
});

const connect = async (url: string, headers: Record<string, string> = {}) => {
  const client = new Client({ name: 'http-test', version: '0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  await client.connect(transport);
  return { client, transport };
};
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) =>
  JSON.parse(
    ((await c.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0]
      ?.text ?? '{}',
  );

// raw request so we control Host, Origin, and the body
function raw(
  port: number,
  path: string,
  {
    method = 'GET',
    headers = {},
    body,
  }: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method, headers: { Host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('a real MCP client connects over HTTP, lists tools, builds and measures a part', async () => {
  const { client } = await connect(open.url);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  for (const n of ['add_step', 'measure', 'render_view', 'inspect_file', 'get_playbook'])
    assert.ok(tools.includes(n), n);
  const r = await call(client, 'add_step', { step: { op: 'box', id: 'b', w: 40, d: 20, h: 10 } });
  assert.equal(r.ok, true);
  assert.equal(r.bodies.b.volume_mm3, 8000);
  assert.ok(open.sessions() >= 1);
  await client.close();
});

test('every client shares one live design (so the viewer shows all of them)', async () => {
  const a = await connect(open.url);
  const b = await connect(open.url);
  await call(a.client, 'new_model', { name: 'shared' });
  await call(a.client, 'add_step', { step: { op: 'sphere', id: 'ball', r: 5 } });
  const seenByB = await call(b.client, 'get_model');
  assert.ok(seenByB.report.bodies.ball, "client B should see client A's body");
  assert.equal(seenByB.timeline.name, 'shared');
  await a.client.close();
  await b.client.close();
});

test('health endpoint, unknown paths, and missing/unknown sessions', async () => {
  assert.equal((await raw(open.port, '/health')).status, 200);
  assert.equal((await raw(open.port, '/nope')).status, 404);
  assert.equal((await raw(open.port, '/mcp', { method: 'GET' })).status, 400);
  assert.equal(
    (
      await raw(open.port, '/mcp', {
        method: 'GET',
        headers: { 'mcp-session-id': 'does-not-exist' },
      })
    ).status,
    404,
  );
  const notInit = await raw(open.port, '/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(notInit.status, 400);
  assert.match(notInit.text, /initialize/);
  const huge = await raw(open.port, '/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pad: 'x'.repeat(5 * 1024 * 1024) }),
  });
  assert.equal(huge.status, 400);
  assert.match(huge.text, /too large/);
});

test('DNS-rebinding and cross-site protections: foreign Host and browser Origin are refused', async () => {
  assert.equal(
    (await raw(open.port, '/health', { headers: { Host: 'evil.example' } })).status,
    403,
  );
  assert.equal(
    (await raw(open.port, '/health', { headers: { Origin: 'https://evil.example' } })).status,
    403,
  );
});

test('a token is enforced when set, and exposing a non-local host without one is refused', async () => {
  await assert.rejects(connect(locked.url), /401|Unauthorized|token/i);
  await assert.rejects(
    connect(locked.url, { Authorization: 'Bearer wrong' }),
    /401|Unauthorized|token/i,
  );
  const ok = await connect(locked.url, { Authorization: `Bearer ${TOKEN}` });
  assert.ok((await ok.client.listTools()).tools.length > 10);
  await ok.client.close();

  const bare = await raw(locked.port, '/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(bare.status, 401);

  // a tunnel domain is accepted ONLY because the server was started with a token
  const viaTunnel = await raw(locked.port, '/mcp', {
    method: 'GET',
    headers: { Host: 'tunnel.example.test', Authorization: `Bearer ${TOKEN}` },
  });
  assert.notEqual(viaTunnel.status, 403); // host accepted (400: no session yet), not a host rejection
  assert.equal(
    (await raw(locked.port, '/health', { headers: { Host: 'other.example.test' } })).status,
    403,
  );

  await assert.rejects(
    startHttp(
      { session, outDir: dir, viewerUrl: () => undefined },
      { port: 4740, allowedHosts: ['x.example.test'] },
    ),
    /requires --token/,
  );
});
