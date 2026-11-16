// Tools that expose the engineering knowledge packs and playbooks to ANY client, including clients
// that support tools but not MCP prompts or resources.
import { z } from 'zod';
import { getKnowledge, knowledgeIndex } from './knowledge.ts';
import { buildPlaybook, PLAYBOOKS } from './prompts.ts';
import { j, type ToolDef } from './tools.ts';

export const knowledgeTools: ToolDef[] = [
  {
    name: 'list_knowledge',
    description:
      'List the engineering knowledge packs (materials, strength formulas, fasteners, tolerances, 3D printing, CNC/laser, sheet metal, molding, mechanisms, motors, thermal, structures, robotics, safety, failure modes, importing CAD files, Contrapt modelling patterns).',
    input: {},
    readOnly: true,
    run: async () => j({ topics: knowledgeIndex() }),
  },
  {
    name: 'get_knowledge',
    description:
      'Read one engineering knowledge pack by topic id (see list_knowledge). Use it before designing: formulas, rules of thumb, typical numbers, and checklists. Values are typical and must be checked for critical designs.',
    input: {
      topic: z.string().describe('a topic id from list_knowledge, e.g. "strength-and-stiffness"'),
    },
    readOnly: true,
    run: async (a) => {
      const d = getKnowledge(a.topic as string);
      return `# ${d.title}\n\n${d.body}`;
    },
  },
  {
    name: 'get_playbook',
    description:
      'Get an expert prompt ("playbook") that sets you up for a kind of engineering task, with the right knowledge embedded. Omit name to list them. Playbooks: engineer (start here), design_part, design_review, design_for_process, strength_check, size_mechanism, brainstorm_invention, explain_design, build_pack. Then follow the returned instructions.',
    input: {
      name: z.string().optional().describe('playbook name; omit to list'),
      args: z
        .record(z.string(), z.string())
        .optional()
        .describe('playbook arguments, e.g. {"goal":"..."}'),
    },
    readOnly: true,
    run: async (a) => {
      if (!a.name) {
        return j({
          playbooks: PLAYBOOKS.map((p) => ({
            name: p.name,
            title: p.title,
            description: p.description,
            args: Object.entries(p.args).map(([k, v]) => ({
              name: k,
              description: (v as z.ZodType).description ?? '',
              required: !(v as z.ZodType).safeParse(undefined).success,
            })),
          })),
        });
      }
      return buildPlaybook(a.name as string, (a.args as Record<string, string> | undefined) ?? {});
    },
  },
];
