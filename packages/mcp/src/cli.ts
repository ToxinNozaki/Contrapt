#!/usr/bin/env node
// contrapt-mcp: MCP server over stdio + live viewer on localhost.
//   node packages/mcp/src/cli.ts [--no-viewer] [--port 4317] [--out ./contrapt-out]
// stdout is reserved for the MCP protocol; all human-readable output goes to stderr.
import { join, resolve } from 'node:path';
import { initKernel } from '@contrapt/core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.ts';
import { Session } from './session.ts';
import { startViewer } from './viewer.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const log = (m: string) => process.stderr.write(`[contrapt] ${m}\n`);
const debug = !!process.env.CONTRAPT_DEBUG;

await initKernel({ onLog: (line) => debug && log(`kernel: ${line}`) });

const outDir = resolve(arg('--out') ?? process.env.CONTRAPT_OUT ?? 'contrapt-out');
const session = new Session('untitled', { importsDir: join(outDir, 'imports') });
await session.rebuild();
let viewerUrl: string | undefined;
if (!process.argv.includes('--no-viewer')) {
  const port = arg('--port') ? Number(arg('--port')) : undefined;
  const viewer = await startViewer(session, { port });
  viewerUrl = viewer.url;
  log(`viewer: ${viewer.url}`);
  process.on('exit', () => void viewer.close());
}

const server = createMcpServer({ session, outDir, viewerUrl: () => viewerUrl });
await server.connect(new StdioServerTransport());
log('MCP server ready on stdio');
