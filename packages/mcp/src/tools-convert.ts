// convert_file: run an OPTIONAL external converter (the open-source cadmpeg CLI) to turn a native CAD file
// (for example an Inventor .ipt) into STEP, which import_file can then read exactly.
//
// Safety design (the AI never controls what runs):
//   - The converter program is chosen by the user (--cadmpeg <path> or CONTRAPT_CADMPEG), never by the AI.
//   - The arguments are fixed: `convert <file in imports> -o <file in imports>`. No AI-supplied flags.
//   - Run with execFile (no shell), a timeout, an output cap, and only on plain names inside the imports folder.
//   - The result is checked: the output must exist and really be a STEP file.
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { detectFormat, isSafeFileName } from '@contrapt/core';
import { z } from 'zod';
import { j, type ToolDef } from './tools.ts';

const CONVERTIBLE = new Set(['ipt', 'iam', 'f3d', 'sldprt', 'fcstd', '3dm', 'sat', 'iges', 'igs']);
const TIMEOUT_MS = 180_000;
const MAX_REPORT = 4000;

const trim = (s: string) =>
  s.length > MAX_REPORT ? `${s.slice(0, MAX_REPORT)}\n… (truncated)` : s;

export const convertTools: ToolDef[] = [
  {
    name: 'convert_file',
    description:
      'Convert a native CAD file in the imports folder (Inventor .ipt/.iam, Fusion .f3d, SolidWorks .sldprt, ...) to STEP using the optional cadmpeg converter, then use import_file on the result. Only works if the user configured a converter (--cadmpeg or CONTRAPT_CADMPEG). Conversion can be partial or fail for newer file versions: always check the imported size with measure.',
    input: { file: z.string().describe('plain file name in the imports folder') },
    run: async (a, ctx) => {
      const cfg = ctx.converters?.cadmpeg;
      if (!cfg) {
        throw new Error(
          'No converter is configured. The user can install the open-source cadmpeg CLI and start Contrapt with --cadmpeg <path to cadmpeg> (or set CONTRAPT_CADMPEG). Meanwhile, export STEP from the original program and use import_file.',
        );
      }
      const file = a.file as string;
      if (!isSafeFileName(file)) throw new Error(`"${file}" is not a plain file name`);
      const ext = (/\.([A-Za-z0-9_]+)$/.exec(file)?.[1] ?? '').toLowerCase();
      if (!CONVERTIBLE.has(ext)) {
        throw new Error(
          `convert_file does not handle .${ext || '?'} files. Convertible: ${[...CONVERTIBLE].join(', ')}`,
        );
      }
      const dir = join(ctx.outDir, 'imports');
      await mkdir(dir, { recursive: true });
      const input = join(dir, file);
      try {
        await stat(input);
      } catch {
        throw new Error(`No file "${file}" in the imports folder.`);
      }
      const outName = `${file}.converted.step`;
      const output = join(dir, outName);

      const run = await new Promise<{
        code: number | null;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      }>((resolve) => {
        execFile(
          cfg.command,
          [...(cfg.prefixArgs ?? []), 'convert', input, '-o', output],
          { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
          (err, stdout, stderr) => {
            const e = err as
              | (NodeJS.ErrnoException & { killed?: boolean; code?: number | string })
              | null;
            resolve({
              code: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
              stdout: String(stdout ?? ''),
              stderr:
                String(stderr ?? '') + (e && typeof e.code === 'string' ? ` (${e.code})` : ''),
              timedOut: !!e?.killed,
            });
          },
        );
      });

      const report = trim([run.stdout.trim(), run.stderr.trim()].filter(Boolean).join('\n'));
      if (run.timedOut)
        throw new Error(`The converter took longer than ${TIMEOUT_MS / 1000}s and was stopped.`);
      if (run.code !== 0) {
        throw new Error(
          `The converter could not convert "${file}" (exit ${run.code}). This often means the file version is newer than the converter supports. Export STEP from the original program instead.\n${report}`,
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await readFile(output));
      } catch {
        throw new Error(`The converter reported success but wrote no output file.\n${report}`);
      }
      const fmt = detectFormat(outName, bytes);
      if (bytes.byteLength < 100 || fmt.support !== 'supported') {
        throw new Error(
          `The converter's output is not a usable STEP file (${bytes.byteLength} bytes).\n${report}`,
        );
      }
      return j({
        converted: outName,
        bytes: bytes.byteLength,
        next: `Call import_file with file "${outName}", then measure and compare with known dimensions: conversions can be partial.`,
        converterReport: report || undefined,
      });
    },
  },
];
