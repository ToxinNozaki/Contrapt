// Streamable HTTP transport for MCP clients that cannot spawn a local process (ChatGPT, web apps, remote tools).
//
//   POST/GET/DELETE /mcp     the MCP endpoint (sessions via the mcp-session-id header)
//   GET /health              {ok:true}
//
// Security model:
//   - Binds to 127.0.0.1 only. To reach it from the internet the user must tunnel it themselves.
//   - Host header must be localhost/127.0.0.1 (DNS-rebinding defence) unless the user lists extra hosts with
//     allowedHosts (for a tunnel domain). Doing that REQUIRES a bearer token: an open public design server is refused.
//   - Browser requests carrying an Origin header are rejected unless that origin is explicitly allowed.
//   - Bodies are capped; the token is compared in constant time.
//   - Every client session shares ONE live design (the same Session), so the viewer shows what they all do.
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from './server.ts';
import type { ToolContext } from './tools.ts';

export interface HttpOptions {
  port?: number;
  /** Extra Host header values to accept (for example a tunnel domain). Requires `token`. */
  allowedHosts?: string[];
  /** Origins allowed to call from a browser. Non-browser clients send no Origin and are unaffected. */
  allowedOrigins?: string[];
  /** Bearer token clients must send as `Authorization: Bearer <token>`. */
  token?: string;
}

export interface HttpHandle {
  url: string;
  port: number;
  sessions: () => number;
  close: () => Promise<void>;
}

const MAX_BODY = 4 * 1024 * 1024;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  // Keep consuming an oversized body (discarding it) instead of destroying the socket, so a keep-alive
  // client gets a clean 400 and can reuse the connection.
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size <= MAX_BODY) chunks.push(c as Buffer);
  }
  if (size > MAX_BODY) throw new Error('Request body too large');
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

export async function startHttp(ctx: ToolContext, opts: HttpOptions = {}): Promise<HttpHandle> {
  const extraHosts = (opts.allowedHosts ?? []).map((h) => h.toLowerCase());
  if (extraHosts.length > 0 && !opts.token) {
    throw new Error(
      'Refusing to start: --allow-host exposes the server beyond this computer, which requires --token (a secret clients must send). An open design server would let anyone edit your models and write files in your output folder.',
    );
  }
  const transports = new Map<string, StreamableHTTPServerTransport>();
  let hostSet = new Set<string>();

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  };
  const rpcError = (res: ServerResponse, status: number, message: string) =>
    send(res, status, { jsonrpc: '2.0', error: { code: -32000, message }, id: null });

  const server: Server = createServer(async (req, res) => {
    try {
      const host = (req.headers.host ?? '').toLowerCase();
      if (!hostSet.has(host)) return rpcError(res, 403, 'Forbidden host');
      const origin = req.headers.origin;
      if (origin && !(opts.allowedOrigins ?? []).includes(origin))
        return rpcError(res, 403, 'Forbidden origin');
      const path = (req.url ?? '/').split('?')[0];

      if (path === '/health') return send(res, 200, { ok: true });
      if (path !== '/mcp') return send(res, 404, { error: 'Not found. The MCP endpoint is /mcp' });

      if (opts.token) {
        const given = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
        if (!safeEqual(given, opts.token)) {
          res.setHeader('WWW-Authenticate', 'Bearer');
          return rpcError(res, 401, 'Missing or wrong bearer token');
        }
      }

      const sid = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(sid) ? sid[0] : sid;

      if (req.method === 'POST') {
        let body: unknown;
        try {
          body = await readJson(req);
        } catch (e) {
          return rpcError(res, 400, (e as Error).message);
        }
        let transport = sessionId ? transports.get(sessionId) : undefined;
        if (!transport) {
          if (sessionId || !isInitializeRequest(body)) {
            return rpcError(
              res,
              sessionId ? 404 : 400,
              sessionId ? 'Unknown session' : 'Send an initialize request first',
            );
          }
          const t = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              transports.set(id, t);
            },
          });
          t.onclose = () => {
            if (t.sessionId) transports.delete(t.sessionId);
          };
          await createMcpServer(ctx).connect(t);
          transport = t;
        }
        return void (await transport.handleRequest(req, res, body));
      }

      // GET (server-sent events) and DELETE (end session) need an existing session
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport)
        return rpcError(
          res,
          sessionId ? 404 : 400,
          sessionId ? 'Unknown session' : 'Missing mcp-session-id header',
        );
      return void (await transport.handleRequest(req, res));
    } catch (e) {
      if (!res.headersSent) rpcError(res, 500, `Internal error: ${(e as Error).message}`);
      else res.end();
    }
  });

  const base = opts.port ?? 4318;
  let port = base;
  await new Promise<void>((resolve, reject) => {
    const tryListen = () => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && opts.port === undefined && port < base + 20) {
          port++;
          tryListen();
        } else reject(err);
      });
      server.listen(port, '127.0.0.1', () => resolve());
    };
    tryListen();
  });
  hostSet = new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...extraHosts]);

  return {
    url: `http://localhost:${port}/mcp`,
    port,
    sessions: () => transports.size,
    close: async () => {
      for (const t of transports.values()) await t.close().catch(() => undefined);
      transports.clear();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
