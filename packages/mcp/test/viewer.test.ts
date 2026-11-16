import assert from 'node:assert/strict';
import { type IncomingMessage, request } from 'node:http';
import { after, before, test } from 'node:test';
import { initKernel } from '@contrapt/core';
import { Session } from '../src/session.ts';
import { startViewer, type ViewerHandle } from '../src/viewer.ts';

let session: Session;
let viewer: ViewerHandle;

before(async () => {
  await initKernel();
  session = new Session('viewer-test');
  session.builder.add({ op: 'box', id: 'b', w: 10, d: 10, h: 10 });
  await session.rebuild();
  viewer = await startViewer(session, { port: 4600 });
});
after(() => viewer.close());

// Raw request so we can control the Host header and send un-normalised paths.
function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; res: IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: viewer.port,
        path,
        headers: { Host: `127.0.0.1:${viewer.port}`, ...headers },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, res }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('serves the page, scripts and style', async () => {
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /Contrapt viewer/);
  assert.equal((await get('/main.js')).status, 200);
  assert.equal((await get('/style.css')).status, 200);
});

test('/api/state returns the snapshot with a mesh and measured body', async () => {
  const s = JSON.parse((await get('/api/state')).body);
  assert.equal(s.name, 'viewer-test');
  assert.equal(s.report.bodies.b.volume, 1000);
  assert.equal(s.meshes[0].id, 'b');
  assert.ok(s.meshes[0].triangles.length >= 36);
});

test('three.js is served from an allow-list only', async () => {
  const ok = await get('/vendor/three/build/three.module.js');
  assert.equal(ok.status, 200);
  assert.equal((await get('/vendor/three/package.json')).status, 403);
  assert.equal((await get('/vendor/three/build/..%2Fpackage.json')).status, 403);
  assert.equal((await get('/vendor/three/build/..%2F..%2F..%2Fpackage.json')).status, 403);
});

test('rejects foreign Host headers (DNS rebinding) and non-GET methods', async () => {
  assert.equal((await get('/api/state', { Host: 'evil.example' })).status, 403);
  const post = await new Promise<number>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: viewer.port,
        path: '/api/state',
        method: 'POST',
        headers: { Host: `127.0.0.1:${viewer.port}` },
      },
      (res) => resolve(res.statusCode ?? 0),
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(post, 405);
});

test('unknown paths 404 and never read the filesystem', async () => {
  assert.equal((await get('/etc/passwd')).status, 404);
  assert.equal((await get('/..%2Fpackage.json')).status, 404);
});

test('SSE pushes a new version when the model changes', async () => {
  const got = new Promise<number>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: viewer.port,
        path: '/events',
        headers: { Host: `127.0.0.1:${viewer.port}` },
      },
      (res) => {
        res.setEncoding('utf8');
        let first = true;
        res.on('data', (chunk: string) => {
          const m = /data: (\{.*\})/.exec(chunk);
          if (!m) return;
          const v = JSON.parse(m[1] as string).version as number;
          if (first) {
            first = false;
            // initial hello; now change the model
            session.builder.add({ op: 'sphere', id: 's', r: 3 });
            void session.rebuild();
          } else {
            req.destroy();
            resolve(v);
          }
        });
      },
    );
    req.on('error', (e: NodeJS.ErrnoException) =>
      e.code === 'ECONNRESET' ? undefined : reject(e),
    );
    req.end();
  });
  const v = await got;
  assert.equal(v, session.version);
});
