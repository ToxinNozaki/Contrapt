// The tool surface. Defined once as plain data so the same tools can back the MCP server today and
// an OpenAI-style function adapter / REST endpoint later.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileScript, describeBody, exportStep, exportStl, StepInput } from '@contrapt/core';
import { z } from 'zod';
import { DOC_TOPICS, type DocTopic, getDocs } from './docs.ts';
import type { Session } from './session.ts';

export interface ToolContext {
  session: Session;
  /** Directory for exports and saved models. Tools never accept paths, only plain names. */
  outDir: string;
  viewerUrl: () => string | undefined;
  /** Optional external converters, chosen by the USER at startup (never by the AI). */
  converters?: { cadmpeg?: { command: string; prefixArgs?: string[] } };
}

/** A tool result with images (base64) that capable AI clients can actually look at. */
export interface ToolResult {
  text: string;
  images?: { mimeType: string; data: string }[];
}

export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodRawShape;
  readOnly?: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string | ToolResult>;
}

export const SafeName = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'letters, digits, _ and - only (no paths or dots)');

export const j = (o: unknown) => JSON.stringify(o);

/** Compact feedback after every change: the AI's eyes. */
export function feedback(ctx: ToolContext, headline: string): string {
  const snap = ctx.session.snapshot();
  const { report } = snap;
  const steps = report.steps;
  const bad = steps.filter((s) => s.status === 'error');
  const bodies = Object.fromEntries(
    Object.entries(report.bodies).map(([id, b]) => [
      id,
      {
        volume_mm3: b.volume,
        area_mm2: b.area,
        bbox_size_mm: b.bbox.size,
        bbox_min_mm: b.bbox.min,
        center_of_mass_mm: b.centerOfMass,
      },
    ]),
  );
  return j({
    result: headline,
    ok: report.ok,
    version: snap.version,
    ...(bad.length ? { error: { step: bad[0]?.id, message: bad[0]?.error } } : {}),
    steps:
      steps.length <= 14
        ? steps.map((s, i) => {
            // Notes and solver data are shown for the newest step and for anything needing attention, so a long
            // session does not repeat every old note on every reply (get_model has the full report).
            const latest = i === steps.length - 1;
            const attention =
              !!s.note && /WARNING|under-constrained|over-constrained|redundant/.test(s.note);
            return {
              id: s.id,
              op: s.op,
              status: s.status,
              ...(s.error ? { error: s.error } : {}),
              ...(s.note && (latest || attention) ? { note: s.note } : {}),
              ...(s.data && latest ? { data: s.data } : {}),
            };
          })
        : `${steps.filter((s) => s.status === 'ok').length}/${steps.length} ok (use get_model for details)`,
    params: report.params,
    bodies,
  });
}

const tools: ToolDef[] = [
  {
    name: 'get_docs',
    description:
      'Read the Contrapt reference: conventions (axes, planes, units), step types, selectors, workflow, examples. Call this first if unsure.',
    input: { topic: z.enum(DOC_TOPICS).optional().describe('omit for everything') },
    readOnly: true,
    run: async (a) => getDocs(a.topic as DocTopic | undefined),
  },
  {
    name: 'new_model',
    description:
      'Start a fresh, empty model (discards the current timeline; save_model first if needed).',
    input: { name: z.string().optional() },
    run: async (a, ctx) => {
      await ctx.session.reset((a.name as string | undefined) ?? 'untitled');
      return feedback(ctx, 'New empty model.');
    },
  },
  {
    name: 'set_param',
    description:
      'Create or change a named parameter (number or expression over other parameters). Everything depending on it rebuilds.',
    input: { name: z.string(), value: z.union([z.number(), z.string()]) },
    run: async (a, ctx) => {
      ctx.session.builder.param(a.name as string, a.value as number | string);
      await ctx.session.rebuild();
      return feedback(ctx, `Parameter ${a.name} = ${a.value}.`);
    },
  },
  {
    name: 'add_step',
    description:
      'Append one step to the timeline (box, cylinder, sphere, sketch, constrained_sketch, extrude, revolve, loft, fillet, chamfer, shell, boolean, transform, import). Returns the new id and the rebuilt, measured result. See get_docs topic "steps".',
    input: { step: StepInput },
    run: async (a, ctx) => {
      const id = ctx.session.builder.add(a.step);
      await ctx.session.rebuild();
      return feedback(ctx, `Added step "${id}".`);
    },
  },
  {
    name: 'run_script',
    description:
      'Replace the whole model with the result of a script. In the script, param(name, value) and one function per step type (box, sketch, extrude, fillet, ...) take the same arguments as add_step and return the step id. Good for building a whole part in one call.',
    input: { script: z.string().max(100_000), name: z.string().optional() },
    run: async (a, ctx) => {
      const timeline = compileScript(a.script as string, {
        name: (a.name as string | undefined) ?? 'script',
      });
      await ctx.session.replaceTimeline(timeline);
      return feedback(ctx, `Script compiled to ${timeline.steps.length} steps.`);
    },
  },
  {
    name: 'suppress_step',
    description: 'Suppress (or unsuppress) a step without deleting it.',
    input: { id: z.string(), suppressed: z.boolean().optional().describe('default true') },
    run: async (a, ctx) => {
      ctx.session.builder.suppress(a.id as string, (a.suppressed as boolean | undefined) ?? true);
      await ctx.session.rebuild();
      return feedback(ctx, `Step ${a.id} ${(a.suppressed ?? true) ? 'suppressed' : 'restored'}.`);
    },
  },
  {
    name: 'remove_step',
    description: 'Delete a step. Later steps that depended on it will report errors.',
    input: { id: z.string() },
    run: async (a, ctx) => {
      ctx.session.builder.remove(a.id as string);
      await ctx.session.rebuild();
      return feedback(ctx, `Removed step ${a.id}.`);
    },
  },
  {
    name: 'get_model',
    description: 'Return the full timeline JSON (the saved format) and the latest build report.',
    input: {},
    readOnly: true,
    run: async (_a, ctx) => {
      const snap = ctx.session.snapshot();
      return j({ timeline: snap.timeline, report: snap.report, version: snap.version });
    },
  },
  {
    name: 'measure',
    description:
      'Measure a body: volume (mm^3), surface area (mm^2), centre of mass, bounding box. Omit body to measure all bodies.',
    input: { body: z.string().optional() },
    readOnly: true,
    run: async (a, ctx) => {
      const model = ctx.session.model;
      if (!model || model.bodies.size === 0) throw new Error('The model has no bodies yet');
      const ids = a.body ? [a.body as string] : [...model.bodies.keys()];
      const out: Record<string, unknown> = {};
      for (const id of ids) {
        const shape = model.bodies.get(id);
        if (!shape)
          throw new Error(`No body "${id}". Bodies: ${[...model.bodies.keys()].join(', ')}`);
        out[id] = describeBody(shape);
      }
      return j(out);
    },
  },
  {
    name: 'export_model',
    description:
      'Export a body (or all bodies fused) to a file in the output folder. step = exact CAD for fabrication; stl = mesh for 3D printing. Returns the file name (relative) and size.',
    input: {
      format: z.enum(['step', 'stl']),
      body: z.string().optional(),
      filename: SafeName.optional().describe('without extension; defaults to the model name'),
    },
    run: async (a, ctx) => {
      const model = ctx.session.model;
      if (!model) throw new Error('Nothing to export yet');
      const dir = join(ctx.outDir, 'exports');
      await mkdir(dir, { recursive: true });
      const base = SafeName.parse(
        (a.filename as string | undefined) ??
          ctx.session.builder.toJSON().name.replace(/[^A-Za-z0-9_-]/g, '_'),
      );
      const fmt = a.format as 'step' | 'stl';
      const file = `${base}.${fmt === 'step' ? 'step' : 'stl'}`;
      const data =
        fmt === 'step'
          ? await exportStep(model, a.body as string | undefined)
          : await exportStl(model, a.body as string | undefined);
      await writeFile(join(dir, file), data);
      return j({
        file: `exports/${file}`,
        bytes: typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength,
      });
    },
  },
  {
    name: 'save_model',
    description:
      'Save the timeline to the output folder so it can be loaded later (persists across sessions).',
    input: { name: SafeName },
    run: async (a, ctx) => {
      const dir = join(ctx.outDir, 'models');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, `${a.name}.contrapt.json`),
        `${JSON.stringify(ctx.session.builder.toJSON(), null, 2)}\n`,
      );
      return j({ saved: `models/${a.name}.contrapt.json` });
    },
  },
  {
    name: 'load_model',
    description: 'Load a previously saved timeline by name and rebuild it.',
    input: { name: SafeName },
    run: async (a, ctx) => {
      const text = await readFile(join(ctx.outDir, 'models', `${a.name}.contrapt.json`), 'utf8');
      await ctx.session.replaceTimeline(JSON.parse(text));
      return feedback(ctx, `Loaded "${a.name}".`);
    },
  },
  {
    name: 'list_models',
    description: 'List saved models.',
    input: {},
    readOnly: true,
    run: async (_a, ctx) => {
      try {
        const files = await readdir(join(ctx.outDir, 'models'));
        return j({
          models: files
            .filter((f) => f.endsWith('.contrapt.json'))
            .map((f) => f.replace('.contrapt.json', '')),
        });
      } catch {
        return j({ models: [] });
      }
    },
  },
  {
    name: 'view',
    description:
      'Get the URL of the live 3D viewer so the user can watch the model as it is built.',
    input: {},
    readOnly: true,
    run: async (_a, ctx) => {
      const url = ctx.viewerUrl();
      return url
        ? j({ url, note: 'Open this in a browser; it updates live.' })
        : j({ url: null, note: 'The viewer is disabled.' });
    },
  },
];

export const TOOLS: readonly ToolDef[] = tools;
