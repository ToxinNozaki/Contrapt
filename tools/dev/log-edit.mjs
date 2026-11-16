#!/usr/bin/env node
// PostToolUse hook: append one line per file edit/write to docs/edits.auto.log.
// Reads the hook JSON from stdin. Writes repo-relative paths only (repo is public),
// and never throws — a logging failure must not block the editing session.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

// Git Bash hands Node POSIX-style drive paths (/c/foo); Node on Windows needs C:/foo.
const norm = (p) =>
  process.platform === 'win32' ? p.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:') : p;

const root = resolve(norm(process.env.CLAUDE_PROJECT_DIR || process.cwd()));
const logFile = resolve(root, 'docs', 'edits.auto.log');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const evt = JSON.parse(raw || '{}');
    const tool = evt.tool_name || 'unknown';
    const input = evt.tool_input || {};
    const target = input.file_path || input.notebook_path || '';
    if (!target) return;

    const t = norm(target);
    const abs = isAbsolute(t) ? resolve(t) : resolve(root, t);
    let rel = relative(root, abs).split(sep).join('/');
    // Outside the repo: don't record a path that could reveal a local layout.
    if (rel.startsWith('..')) rel = '(outside repo)';

    const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${stamp}\t${tool}\t${rel}\n`);
  } catch {
    /* never block the session */
  }
});
