// Every tool, in presentation order. The MCP server registers exactly this list.

import { TOOLS as coreTools, type ToolDef } from './tools.ts';
import { analysisTools } from './tools-analysis.ts';
import { assemblyTools } from './tools-assembly.ts';
import { convertTools } from './tools-convert.ts';
import { feaTools } from './tools-fea.ts';
import { importTools } from './tools-import.ts';
import { knowledgeTools } from './tools-knowledge.ts';
import { manufacturingTools } from './tools-manufacturing.ts';
import { mechanismTools } from './tools-mechanism.ts';
import { proofTools } from './tools-proof.ts';
import { renderTools } from './tools-render.ts';

export const ALL_TOOLS: readonly ToolDef[] = [
  ...coreTools,
  ...analysisTools,
  ...assemblyTools,
  ...feaTools,
  ...manufacturingTools,
  ...mechanismTools,
  ...proofTools,
  ...importTools,
  ...convertTools,
  ...renderTools,
  ...knowledgeTools,
];
