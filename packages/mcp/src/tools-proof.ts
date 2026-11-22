// The Proof Loop tools: requirements-as-code (specs), a Design Journal, one-parameter optimisation against the specs,
// and the Build Pack (everything needed to make the thing, with the evidence).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  evaluateSpecs,
  exportStep,
  exportStl,
  METRICS,
  optimizeParam,
  type SpecResult,
  SpecSchema,
} from '@contrapt/core';
import { z } from 'zod';
import { feedback, j, SafeName, type ToolDef } from './tools.ts';

const HAND_ESTIMATE =
  'Beam specs are closed-form hand estimates; frame and solid_fea specs run real finite-element analysis (beam elements, and a fitted hexahedral grid whose peak stress at sharp corners is approximate). thermal specs run steady-state conduction. Contrapt does not run transient thermal, fluid, fatigue or multi-body dynamic simulation. Measured geometry (dimensions, volume, mass, interference, gaps) is exact.';

function lines(results: SpecResult[]) {
  return results.map((r) => ({
    id: r.id,
    status: r.ok ? 'PASS' : 'FAIL',
    kind: r.kind,
    ...(r.description ? { why: r.description } : {}),
    detail: r.summary,
    ...(r.marginPct !== undefined ? { margin_pct: r.marginPct } : {}),
    ...(r.estimate ? { estimate: true } : {}),
    ...(r.fea ? { fea: true } : {}),
  }));
}

export const proofTools: ToolDef[] = [
  {
    name: 'add_spec',
    description:
      'Add (or replace, same id) a requirement the design must meet. Saved with the model and re-checked after every change. kinds: dimension {body, axis x|y|z, min?, max?}; mass {body, minG?, maxG?}; volume {body, minMm3?, maxMm3?}; no_interference {a, b, allowTouching?}; min_gap {a, b, minMm}; beam {sketch, support, load, value, lengthMm, material, minSafetyFactor?, maxDeflectionMm?, minSpanOverDeflection?, bend?, selfWeight?} (hand estimate); frame {frame: same definition as frame_analysis, maxDisplacementMm?, minSafetyFactor?, minBucklingFactor?, minFrequencyHz?}, solid_fea {body, supports, loads?, gravity?, elementSizeMm?, maxDisplacementMm?, minSafetyFactor?} and thermal {body, fixedTemperatures?, heatInputs?, convections?, generationW?, maxTemperatureC?, minTemperatureC?} run real finite-element analyses (seconds): they show as PENDING in the live status after each change and are run by check_specs, optimize_param and build_pack. Write specs BEFORE modelling, from the stated needs.',
    input: { spec: SpecSchema },
    run: async (a, ctx) => {
      const id = ctx.session.builder.addSpec(a.spec);
      ctx.session.touch();
      return feedback(ctx, `Spec "${id}" saved. Call check_specs for the verdict.`);
    },
  },
  {
    name: 'remove_spec',
    description: 'Remove a requirement by id.',
    input: { id: z.string() },
    run: async (a, ctx) => {
      ctx.session.builder.removeSpec(a.id as string);
      ctx.session.touch();
      return feedback(ctx, `Spec "${a.id}" removed.`);
    },
  },
  {
    name: 'check_specs',
    description:
      'Judge the current design against every spec: PASS/FAIL per requirement with the measured numbers and margins, and an overall verdict. The design is only done when all pass. Beam specs are hand estimates (flagged).',
    input: {},
    readOnly: true,
    run: async (_a, ctx) => {
      const model = ctx.session.model;
      const specs = ctx.session.builder.specs;
      if (specs.length === 0)
        return j({ verdict: 'NO SPECS', hint: 'Use add_spec to write the requirements first.' });
      if (!model) throw new Error('Nothing built yet');
      const rep = evaluateSpecs(model, specs);
      return j({
        verdict: rep.allPass
          ? 'ALL SPECS PASS'
          : `${rep.total - rep.passing} OF ${rep.total} SPECS FAIL`,
        passing: `${rep.passing}/${rep.total}`,
        results: lines(rep.results),
        ...(rep.results.some((r) => r.estimate || r.fea) ? { caveat: HAND_ESTIMATE } : {}),
        ...(rep.allPass
          ? { next: 'Record the decision with journal_add, then build_pack when ready to make it.' }
          : {
              next: 'Fix the first failing spec (change a parameter, material or feature), or run optimize_param if one parameter trades off against the others.',
            }),
      });
    },
  },
  {
    name: 'journal_add',
    description:
      'Append to the Design Journal (saved with the model, included in the Build Pack): why you chose something, what you tested and found, risks, ideas. Keep entries short and factual; include the numbers.',
    input: {
      kind: z.enum(['decision', 'note', 'test', 'change', 'idea', 'risk']),
      text: z.string().min(1).max(2000),
    },
    run: async (a, ctx) => {
      const e = ctx.session.builder.addJournal(a.kind as 'note', a.text as string);
      ctx.session.touch();
      return j({ added: e, entries: ctx.session.builder.journal.length });
    },
  },
  {
    name: 'get_journal',
    description: 'Read the Design Journal (decisions, tests, risks) in order.',
    input: {},
    readOnly: true,
    run: async (_a, ctx) => j({ entries: ctx.session.builder.journal }),
  },
  {
    name: 'optimize_param',
    description:
      'Find the best value of ONE parameter that still passes every spec: sweeps the range, rebuilds the real geometry each time, then refines toward the boundary. e.g. thinnest wall that meets the deflection spec (minimize mass), or longest arm within the stress spec (maximize size_z). Needs at least one spec. apply:true sets the parameter to the best value. Assumes one dominant trade-off; check the trial table.',
    input: {
      param: z.string(),
      min: z.number(),
      max: z.number(),
      metric: z
        .enum(METRICS)
        .describe(
          'what to optimise: mass (needs a material), volume, or a bounding-box size of the body',
        ),
      body: z.string(),
      goal: z.enum(['minimize', 'maximize']),
      samples: z.number().int().min(3).max(60).optional().describe('sweep points, default 13'),
      apply: z.boolean().optional().describe('set the parameter to the best value (default false)'),
    },
    run: async (a, ctx) => {
      const res = await optimizeParam(
        ctx.session.builder.toJSON(),
        ctx.session.builder.specs,
        {
          param: a.param as string,
          min: a.min as number,
          max: a.max as number,
          metric: a.metric as never,
          body: a.body as string,
          goal: a.goal as 'minimize',
          samples: a.samples as number | undefined,
        },
        undefined,
      );
      let applied = false;
      if (a.apply && res.best) {
        ctx.session.builder.param(a.param as string, Math.round(res.best.value * 1e6) / 1e6);
        await ctx.session.rebuild();
        applied = true;
      }
      return j({
        message: res.message,
        best: res.best,
        applied,
        trials: res.trials.map((t) => ({
          [a.param as string]: Math.round(t.value * 1e4) / 1e4,
          feasible: t.feasible,
          ...(t.objective !== undefined
            ? { [a.metric as string]: Math.round(t.objective * 1e4) / 1e4 }
            : {}),
          ...(t.failing.length ? { failing: t.failing } : {}),
        })),
      });
    },
  },
  {
    name: 'build_pack',
    description:
      'Write the Build Pack to the output folder (buildpacks/<name>/): README.md with parameters, per-body material/mass/size, the spec verdict, the Design Journal and honest caveats; the model JSON; and STEP + STL for each body. This is the hand-off package for actually making the design.',
    input: { name: SafeName.optional().describe('folder name, defaults to the model name') },
    run: async (a, ctx) => {
      const model = ctx.session.model;
      if (!model || model.bodies.size === 0) throw new Error('The model has no bodies yet');
      if (!model.report.ok)
        throw new Error('The model has build errors: fix them before making a Build Pack');
      const tl = ctx.session.builder.toJSON();
      const name = SafeName.parse(
        (a.name as string | undefined) ?? tl.name.replace(/[^A-Za-z0-9_-]/g, '_'),
      );
      const dir = join(ctx.outDir, 'buildpacks', name);
      await mkdir(dir, { recursive: true });
      const files: string[] = [];
      for (const id of model.bodies.keys()) {
        const safe = SafeName.parse(id);
        await writeFile(join(dir, `${safe}.step`), await exportStep(model, id));
        await writeFile(join(dir, `${safe}.stl`), await exportStl(model, id));
        files.push(`${safe}.step`, `${safe}.stl`);
      }
      await writeFile(join(dir, 'model.contrapt.json'), `${JSON.stringify(tl, null, 2)}\n`);
      files.push('model.contrapt.json');

      const specs = ctx.session.builder.specs;
      const rep = specs.length ? evaluateSpecs(model, specs) : undefined;
      const bodies = Object.entries(model.report.bodies);
      const md: string[] = [
        `# Build Pack: ${tl.name}`,
        '',
        `Generated ${new Date().toISOString().slice(0, 10)} by Contrapt. Units: mm, g, N, MPa.`,
        '',
        '## Verdict',
        rep
          ? rep.allPass
            ? `**All ${rep.total} requirements pass.**`
            : `**${rep.total - rep.passing} of ${rep.total} requirements FAIL. Do not build until resolved.**`
          : '_No requirements were written for this design (add_spec). Nothing was judged._',
        '',
        '## Parts',
        '| Part | Material | Mass (g) | Size X x Y x Z (mm) | Volume (mm3) |',
        '|---|---|---|---|---|',
        ...bodies.map(
          ([id, b]) =>
            `| ${id} | ${b.material ?? 'not set'} | ${b.massG ?? 'n/a'} | ${b.bbox.size.join(' x ')} | ${b.volume} |`,
        ),
        '',
        '## Parameters',
        ...(Object.keys(tl.params).length
          ? [
              '| Name | Value |',
              '|---|---|',
              ...Object.entries(tl.params).map(([k, v]) => `| ${k} | ${v} |`),
            ]
          : ['_none_']),
        '',
        '## Requirements',
        ...(rep
          ? [
              '| Id | Result | Detail |',
              '|---|---|---|',
              ...rep.results.map(
                (r) =>
                  `| ${r.id} | ${r.ok ? 'PASS' : 'FAIL'}${r.estimate ? ' (estimate)' : ''} | ${r.summary.replace(/\|/g, '/')} |`,
              ),
            ]
          : ['_none_']),
        '',
        '## Design Journal',
        ...((tl.journal ?? []).length
          ? (tl.journal ?? []).map((e) => `- **${e.kind}** (${e.at.slice(0, 10)}): ${e.text}`)
          : ['_empty_']),
        '',
        '## Files',
        ...files.map((f) => `- \`${f}\``),
        '',
        '## Before you make it',
        `- ${HAND_ESTIMATE}`,
        '- Masses assume solid material at typical density; printed parts with infill weigh less.',
        '- Material properties are typical values: check the supplier datasheet for anything that matters.',
        '- Check tolerances, fits and the manufacturing rules for your process (Contrapt knowledge packs: tolerances-and-fits, manufacturing-*).',
        '- For anything that can hurt someone if it fails, get a qualified engineer to review and test a prototype first.',
        '',
      ];
      await writeFile(join(dir, 'README.md'), md.join('\n'));
      files.unshift('README.md');
      return j({
        folder: `buildpacks/${name}`,
        files,
        verdict: rep ? (rep.allPass ? 'ALL SPECS PASS' : 'SPECS FAIL') : 'NO SPECS',
      });
    },
  },
];
