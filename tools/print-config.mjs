#!/usr/bin/env node
import { resolve } from 'node:path';
// Prints ready-to-paste MCP config for THIS clone, with the real absolute path filled in,
// so nobody has to edit a placeholder. Output goes to your own terminal only.
import { fileURLToPath } from 'node:url';

const cli = resolve(fileURLToPath(new URL('../packages/mcp/src/cli.ts', import.meta.url)));
const quoted = cli.includes(' ') ? `"${cli}"` : cli;

console.log(`Contrapt MCP server for this clone:\n  node ${quoted}\n`);
console.log('Claude Code (run this exact line):');
console.log(`  claude mcp add contrapt -- node ${quoted}\n`);
console.log('Claude Desktop / LM Studio / most editors (add under "mcpServers"):');
console.log(
  JSON.stringify({ mcpServers: { contrapt: { command: 'node', args: [cli] } } }, null, 2)
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n'),
);
console.log('\nCheck it worked: `claude mcp list` should show contrapt as Connected.');
