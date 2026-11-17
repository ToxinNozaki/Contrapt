// Live viewer host: a tiny read-only HTTP server on localhost.
//   /            the viewer page          /api/state   current model snapshot (JSON)
//   /events      Server-Sent Events: pushes {version} whenever the model changes
//   /vendor/three/...  three.js files straight from node_modules (no bundler, no CDN)
// Security: binds 127.0.0.1 only, rejects unexpected Host headers (DNS-rebinding defence),
// serves only a fixed allow-list of static paths, and exposes no mutating endpoints.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Session } from './session.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export interface ViewerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export interface ViewerOptions {
  port?: number;
  /** Folder with index.html, main.js, style.css. Defaults to packages/viewer/public. */
  publicDir?: string;
}

function defaultPublicDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // packaged: <package>/dist/cli.mjs with <package>/viewer; monorepo: packages/mcp/src with packages/viewer/public
  const candidates = [resolve(here, '..', 'viewer'), resolve(here, '..', '..', 'viewer', 'public')];
  return candidates.find((c) => existsSync(join(c, 'index.html'))) ?? (candidates[1] as string);
}

function threeDir(): string {
  const require = createRequire(import.meta.url);
  // three's package.json isn't exported, so resolve the main entry (<root>/build/three.cjs) instead.
  return dirname(dirname(require.resolve('three')));
}

function within(base: string, target: string): boolean {
  const b = resolve(base) + sep;
  return resolve(target).startsWith(b);
}

export async function startViewer(
  session: Session,
  opts: ViewerOptions = {},
): Promise<ViewerHandle> {
  const publicDir = opts.publicDir ?? defaultPublicDir();
  const three = threeDir();
  const clients = new Set<ServerResponse>();

  const stopListening = session.onChange(() => {
    for (const c of clients) c.write(`data: ${JSON.stringify({ version: session.version })}\n\n`);
  });

  const sendFile = (res: ServerResponse, file: string) => {
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    createReadStream(file).pipe(res);
  };

  let allowedHosts = new Set<string>();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!allowedHosts.has((req.headers.host ?? '').toLowerCase())) {
      res.writeHead(403).end('Forbidden host');
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405).end('Read-only');
      return;
    }
    const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');

    if (path === '/') return sendFile(res, join(publicDir, 'index.html'));
    if (path === '/main.js' || path === '/style.css')
      return sendFile(res, join(publicDir, path.slice(1)));

    if (path === '/api/state') {
      res.writeHead(200, { 'Content-Type': MIME['.json'] as string, 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(session.snapshot()));
      return;
    }

    if (path === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ version: session.version })}\n\n`);
      clients.add(res);
      const beat = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
      req.on('close', () => {
        clearInterval(beat);
        clients.delete(res);
      });
      return;
    }

    if (path.startsWith('/vendor/three/')) {
      const rel = normalize(path.slice('/vendor/three/'.length));
      const allowed =
        rel.startsWith(`build${sep}`) || rel.startsWith(join('examples', 'jsm') + sep);
      const file = join(three, rel);
      if (!allowed || !within(three, file)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      return sendFile(res, file);
    }

    res.writeHead(404).end('Not found');
  });

  const base = opts.port ?? 4317;
  let port = base;
  await new Promise<void>((resolveListen, reject) => {
    const tryListen = () => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port < base + 20) {
          port++;
          tryListen();
        } else {
          reject(err);
        }
      });
      server.listen(port, '127.0.0.1', () => resolveListen());
    };
    tryListen();
  });
  allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  return {
    url: `http://localhost:${port}/`,
    port,
    close: () =>
      new Promise<void>((r) => {
        stopListening();
        for (const c of clients) c.end();
        server.close(() => r());
      }),
  };
}
