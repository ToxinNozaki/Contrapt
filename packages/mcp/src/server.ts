// MCP server: registers every tool from tools.ts plus a docs resource.
// NEVER write to stdout in this process: stdout carries the JSON-RPC stream over stdio.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDocs } from './docs.ts';
import { TOOLS, type ToolContext } from './tools.ts';

export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: 'contrapt', version: '0.0.0' },
    {
      instructions:
        'Contrapt is an exact parametric CAD workbench. Call get_docs first. Build with add_step or run_script; after every change read the returned build report (per-step status + measured volume/bbox/centre of mass) and fix the first error before continuing. Use view to give the user the live viewer link.',
    },
  );

  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.input,
        annotations: { readOnlyHint: !!t.readOnly, destructiveHint: false },
      },
      async (args: Record<string, unknown>) => {
        try {
          return { content: [{ type: 'text' as const, text: await t.run(args, ctx) }] };
        } catch (e) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }],
          };
        }
      },
    );
  }

  server.registerResource(
    'docs',
    'contrapt://docs',
    {
      description: 'Contrapt reference: conventions, steps, selectors, workflow, examples',
      mimeType: 'text/markdown',
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: getDocs() }] }),
  );

  return server;
}
