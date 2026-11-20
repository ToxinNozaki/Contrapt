// MCP server: registers every tool, the engineering playbooks as MCP prompts, and docs/knowledge as
// MCP resources. NEVER write to stdout in this process: stdout carries the JSON-RPC stream over stdio.
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ALL_TOOLS } from './all-tools.ts';
import { getDocs } from './docs.ts';
import { getKnowledge, loadKnowledge } from './knowledge.ts';
import { PLAYBOOKS } from './prompts.ts';
import type { ToolContext } from './tools.ts';

export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: 'contrapt', version: '0.0.0' },
    {
      instructions:
        'Contrapt is an exact parametric CAD workbench with a live viewer. Start with get_playbook {name:"engineer"} (or the "engineer" prompt) to work like a senior design engineer, and call get_docs for tool conventions. Use list_knowledge / get_knowledge for engineering formulas, materials, fasteners, tolerances, and manufacturing rules before designing. Build with add_step or run_script; after every change read the returned build report (per-step status + measured volume/bbox/centre of mass) and fix the first error before continuing. To bring in a file from another CAD program, use inspect_file then import_file (STEP works now; Inventor .ipt/.iam/.idw must be exported as STEP first). Contrapt runs beam-element frame FEA (frame_analysis, frame_modes), approximate voxel solid FEA (solid_fea) and exact geometry checks, but does not yet simulate heat, fluids, fatigue, buckling, contact or motion dynamics: label every number as measured, FEA, or hand estimate, and say hand estimates are estimates. For requirements, use the proof_loop playbook (add_spec, check_specs, optimize_param, build_pack). Use view to give the user the live viewer link.',
    },
  );

  for (const t of ALL_TOOLS) {
    server.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.input,
        annotations: { readOnlyHint: !!t.readOnly, destructiveHint: false },
      },
      async (args: Record<string, unknown>) => {
        try {
          const out = await t.run(args, ctx);
          if (typeof out === 'string') return { content: [{ type: 'text' as const, text: out }] };
          return {
            content: [
              { type: 'text' as const, text: out.text },
              ...(out.images ?? []).map((im) => ({
                type: 'image' as const,
                data: im.data,
                mimeType: im.mimeType,
              })),
            ],
          };
        } catch (e) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }],
          };
        }
      },
    );
  }

  // Playbooks as MCP prompts (for clients with a prompt picker).
  for (const p of PLAYBOOKS) {
    server.registerPrompt(
      p.name,
      { title: p.title, description: p.description, argsSchema: p.args },
      (args: Record<string, unknown>) => ({
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: p.build(args as Record<string, string | undefined>),
            },
          },
        ],
      }),
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

  server.registerResource(
    'knowledge',
    new ResourceTemplate('contrapt://knowledge/{topic}', {
      list: async () => ({
        resources: loadKnowledge().map((d) => ({
          uri: `contrapt://knowledge/${d.id}`,
          name: d.title,
          description: d.summary,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    { description: 'Engineering knowledge packs', mimeType: 'text/markdown' },
    async (uri, vars) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: getKnowledge(String(vars.topic)).body,
        },
      ],
    }),
  );

  return server;
}
