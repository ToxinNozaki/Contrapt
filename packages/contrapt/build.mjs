// Builds the publishable package: one bundled CLI (dist/cli.mjs) plus the assets it reads at run time.
// Heavy or native-feeling dependencies stay external and are installed by npm from package.json.
import { copyFileSync, cpSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const external = Object.keys(require('./package.json').dependencies);

for (const p of ['dist', 'knowledge', 'viewer']) rmSync(p, { recursive: true, force: true });

await build({
  entryPoints: ['../mcp/src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/cli.mjs',
  external: [...external, ...external.map((d) => `${d}/*`)],
  logLevel: 'warning',
});

cpSync('../mcp/knowledge', 'knowledge', { recursive: true });
cpSync('../viewer/public', 'viewer', { recursive: true });
for (const f of ['LICENSE', 'NOTICE.md'])
  if (existsSync(`../../${f}`)) copyFileSync(`../../${f}`, f);
console.log('built contrapt package');
