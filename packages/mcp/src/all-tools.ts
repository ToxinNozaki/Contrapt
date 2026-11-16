// Every tool, in presentation order. The MCP server registers exactly this list.

import { TOOLS as coreTools, type ToolDef } from './tools.ts';
import { convertTools } from './tools-convert.ts';
import { importTools } from './tools-import.ts';
import { knowledgeTools } from './tools-knowledge.ts';

export const ALL_TOOLS: readonly ToolDef[] = [
  ...coreTools,
  ...importTools,
  ...convertTools,
  ...knowledgeTools,
];
