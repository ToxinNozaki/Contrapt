// Importing files from other CAD systems.
// Files live in <out>/imports/. Tools accept plain file names only (never paths), so an AI cannot
// read or write anywhere else on the machine.
import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describeStep, detectFormat, isSafeFileName } from '@contrapt/core';
import { z } from 'zod';
import { feedback, j, type ToolDef } from './tools.ts';

const MAX_BYTES = 200 * 1024 * 1024;

async function readImport(importsDir: string, file: string): Promise<Uint8Array> {
  if (!isSafeFileName(file))
    throw new Error(`"${file}" is not a plain file name (no folders or ".." allowed)`);
  const path = join(importsDir, file);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    throw new Error(
      `No file "${file}" in the imports folder. Put it in <output folder>/imports and try again. Use inspect_file with no name to list what is there.`,
    );
  }
  if (size > MAX_BYTES) throw new Error(`"${file}" is larger than ${MAX_BYTES / 1024 / 1024} MB`);
  return new Uint8Array(await readFile(path));
}

export const importTools: ToolDef[] = [
  {
    name: 'inspect_file',
    description:
      'Identify a CAD file the user placed in the imports folder (STEP, Inventor .ipt/.iam/.idw, SolidWorks, DXF, STL, ...) and say whether and how it can be imported. With no file name, lists the folder. Always call this before import_file for an unfamiliar file.',
    input: {
      file: z
        .string()
        .optional()
        .describe('plain file name in the imports folder; omit to list the folder'),
    },
    readOnly: true,
    run: async (a, ctx) => {
      const dir = join(ctx.outDir, 'imports');
      if (!a.file) {
        await mkdir(dir, { recursive: true });
        const names = (await readdir(dir)).filter(isSafeFileName);
        const files = [];
        for (const name of names) {
          const st = await stat(join(dir, name));
          if (!st.isFile()) continue;
          const fh = await open(join(dir, name), 'r');
          try {
            const buf = new Uint8Array(4096);
            const { bytesRead } = await fh.read(buf, 0, 4096, 0);
            const f = detectFormat(name, buf.subarray(0, bytesRead));
            files.push({
              file: name,
              bytes: st.size,
              format: f.name,
              kind: f.kind,
              support: f.support,
            });
          } finally {
            await fh.close();
          }
        }
        return j({
          folder: 'imports',
          files,
          note: files.length
            ? undefined
            : 'The imports folder is empty. Ask the user to put a STEP file there.',
        });
      }
      const bytes = await readImport(dir, a.file as string);
      const f = detectFormat(a.file as string, bytes);
      return j({
        file: a.file,
        bytes: bytes.byteLength,
        format: f.name,
        kind: f.kind,
        support: f.support,
        howTo: f.howTo,
        ...(f.format === 'step' && f.support === 'supported' ? { step: describeStep(bytes) } : {}),
      });
    },
  },
  {
    name: 'import_file',
    description:
      'Import a STEP file from the imports folder as a new body (an exact solid you can measure, fillet, cut, transform, and export). Records a checksum so the model fails loudly if the file later changes. Use scale (e.g. 25.4) if it arrived in the wrong units, and verify with measure.',
    input: {
      file: z.string(),
      id: z.string().optional().describe('body id; defaults to import1, import2, ...'),
      scale: z.union([z.number(), z.string()]).optional(),
      at: z
        .tuple([
          z.union([z.number(), z.string()]),
          z.union([z.number(), z.string()]),
          z.union([z.number(), z.string()]),
        ])
        .optional(),
    },
    run: async (a, ctx) => {
      const bytes = await readImport(join(ctx.outDir, 'imports'), a.file as string);
      const f = detectFormat(a.file as string, bytes);
      if (f.support !== 'supported')
        throw new Error(`Cannot import "${a.file}" (${f.name}). ${f.howTo}`);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const id = ctx.session.builder.add({
        op: 'import',
        file: a.file,
        sha256,
        ...(a.id ? { id: a.id } : {}),
        ...(a.scale !== undefined ? { scale: a.scale } : {}),
        ...(a.at ? { at: a.at } : {}),
      });
      await ctx.session.rebuild();
      return feedback(
        ctx,
        `Imported "${a.file}" as "${id}". Check the size with measure; use scale if the units are wrong.`,
      );
    },
  },
];
