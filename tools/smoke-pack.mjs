#!/usr/bin/env node
// Publish-readiness smoke test: packs the `contrapt` package, installs the TARBALL into a clean folder
// (exactly what `npx contrapt` would do), starts the installed CLI over stdio, and drives it as a real MCP
// client: tools, a build, a STEP export, a render, the knowledge packs, and the live viewer's files.
// Run: npm run smoke:pack
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkgDir = join(root, 'packages', 'contrapt');
const work = mkdtempSync(join(tmpdir(), 'contrapt-smoke-'));
const npm = 'npm';
const q = (x) => (/[\s"]/.test(x) ? `"${x}"` : x);
const run = (cmd, args, cwd) =>
  execSync([cmd, ...args].map(q).join(' '), {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

let failed = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!ok) failed = true;
};

try {
  console.log('packing...');
  const packOut = run(npm, ['pack', '--pack-destination', work, '--json'], pkgDir);
  const jsonStart = packOut.search(/\[\s*\{/);
  const tarball = join(work, JSON.parse(packOut.slice(jsonStart))[0].filename);
  check(
    existsSync(tarball),
    'npm pack produced a tarball',
    `${Math.round(readFileSync(tarball).length / 1024)} KB`,
  );

  const install = join(work, 'clean-install');
  run(
    npm,
    ['init', '-y'],
    (() => {
      execFileSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(install)})`]);
      return install;
    })(),
  );
  console.log('installing the tarball into a clean folder (downloads dependencies)...');
  run(npm, ['install', '--no-audit', '--no-fund', tarball], install);
  const cli = join(install, 'node_modules', 'contrapt', 'dist', 'cli.mjs');
  check(existsSync(cli), 'installed package has dist/cli.mjs');
  check(
    readdirSync(join(install, 'node_modules', 'contrapt', 'knowledge')).length >= 19,
    'knowledge packs shipped',
  );
  check(
    existsSync(join(install, 'node_modules', 'contrapt', 'viewer', 'index.html')),
    'viewer files shipped',
  );

  const out = join(work, 'out');
  const client = new Client({ name: 'smoke', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [cli, '--out', out, '--port', '4950'],
    }),
  );
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { err: !!r.isError, text: r.content[0]?.text ?? '', content: r.content };
  };

  const tools = (await client.listTools()).tools.map((t) => t.name);
  check(tools.length >= 20, 'installed CLI serves the tools over stdio', `${tools.length} tools`);

  const added = await call('add_step', { step: { op: 'box', id: 'b', w: 40, d: 20, h: 10 } });
  check(
    !added.err && JSON.parse(added.text).bodies.b.volume_mm3 === 8000,
    'builds a part with exact volume (OpenCASCADE wasm works when installed)',
  );

  const sketch = await call('add_step', {
    step: {
      op: 'constrained_sketch',
      id: 'cs',
      plane: 'XY',
      points: { A: [1, 2], B: [9, 1] },
      lines: { AB: ['A', 'B'] },
      constraints: [
        { type: 'fix', a: 'A', at: [0, 0] },
        { type: 'horizontal', a: 'AB' },
        { type: 'distance', a: 'A', b: 'B', value: 10 },
      ],
      profile: [{ loop: ['AB', 'AB', 'AB'] }],
    },
  });
  check(!sketch.err, 'constraint solver (planegcs wasm) loads when installed');

  const stepFile = await call('export_model', { format: 'step', filename: 'smoke' });
  check(!stepFile.err && existsSync(join(out, 'exports', 'smoke.step')), 'exports a STEP file');

  const render = await call('render_view', { views: ['iso'], size: 256 });
  check(
    !render.err && render.content.some((c) => c.type === 'image'),
    'render_view returns an image',
  );

  const know = await call('get_knowledge', { topic: 'strength-and-stiffness' });
  check(!know.err && /Euler/.test(know.text), 'knowledge packs are readable');

  const play = await call('get_playbook', { name: 'engineer' });
  check(!play.err && play.text.length > 2000, 'playbooks work');

  const view = JSON.parse((await call('view')).text);
  check(typeof view.url === 'string', 'viewer URL reported', view.url);
  for (const path of ['', 'main.js', 'vendor/three/build/three.module.js', 'api/state']) {
    const res = await fetch(new URL(path, view.url));
    check(res.ok, `viewer serves /${path}`, String(res.status));
  }
  await client.close();
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch {
    console.log(`(could not delete the temp folder ${work}; it is safe to remove)`);
  }
}
console.log(
  failed
    ? '\nSMOKE TEST FAILED'
    : '\nSMOKE TEST PASSED: the packed package works from a clean install',
);
process.exit(failed ? 1 : 0);
