// Assembly tools: all-pairs interference, bill of materials, and motion-range sweeps.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { billOfMaterials, drawingSheet, interferenceReport, motionCheck } from '@contrapt/core';
import { z } from 'zod';
import { j, SafeName, type ToolDef } from './tools.ts';

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const assemblyTools: ToolDef[] = [
  {
    name: 'drawing',
    description:
      'Make a 2D drawing sheet (SVG, A4 landscape, mm) of the model or chosen bodies: third-angle front, top and right views from the exact geometry, dashed hidden lines, overall width/height/depth dimensions, an automatic standard scale, and a title block (title, number, material, mass, scale). Saved to drawings/<name>.svg in the output folder. Overall dimensions only: add tolerances and detail dimensions by hand.',
    input: {
      name: SafeName.optional().describe('file name without extension, default: model name'),
      title: z.string().max(80).optional(),
      number: z.string().max(40).optional().describe('drawing number for the title block'),
      bodies: z.array(z.string()).optional().describe('body ids to draw (default: all)'),
      hidden_lines: z.boolean().optional().describe('show dashed hidden lines (default true)'),
    },
    run: async (a, ctx) => {
      const model = ctx.session.model;
      if (!model || model.bodies.size === 0) throw new Error('The model has no bodies yet');
      const tl = ctx.session.builder.toJSON();
      const sheet = drawingSheet(model, {
        bodies: a.bodies as string[] | undefined,
        title: (a.title as string | undefined) ?? tl.name,
        number: a.number as string | undefined,
        hiddenLines: (a.hidden_lines as boolean | undefined) ?? true,
      });
      const name = SafeName.parse(
        (a.name as string | undefined) ?? tl.name.replace(/[^A-Za-z0-9_-]/g, '_'),
      );
      const dir = join(ctx.outDir, 'drawings');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${name}.svg`), sheet.svg);
      return j({
        file: `drawings/${name}.svg`,
        scale: sheet.scale,
        overall_mm: sheet.overall.map((x) => Math.round(x * 100) / 100),
        views: sheet.views,
        warnings: sheet.warnings,
        note: 'Overall dimensions only; no tolerances or detail dimensions. Open the SVG in a browser or import it into any drawing tool.',
      });
    },
  },
  {
    name: 'check_assembly',
    description:
      'Check every pair of bodies (or the listed ones) for interference: which overlap (with exact overlap volume), which only touch, and the tightest clearance among the rest. Exact geometry. Position parts with transform or mate steps first.',
    input: {
      bodies: z
        .array(z.string())
        .optional()
        .describe('limit to these body ids (default: all, max 40)'),
    },
    readOnly: true,
    run: async (a, ctx) => {
      const model = ctx.session.model;
      if (!model || model.bodies.size === 0) throw new Error('The model has no bodies yet');
      const rep = interferenceReport(model, a.bodies as string[] | undefined);
      const fmt = (p: (typeof rep.interfering)[number]) => ({
        a: p.a,
        b: p.b,
        overlap_mm3: p.overlapVolume,
        ...(p.overlapBbox ? { overlap_bbox_mm: p.overlapBbox } : {}),
      });
      return j({
        verdict: rep.interfering.length
          ? `${rep.interfering.length} INTERFERING PAIR(S)`
          : 'NO INTERFERENCE',
        pairs_checked: rep.checked,
        interfering: rep.interfering.map(fmt),
        touching: rep.touching.map((p) => ({ a: p.a, b: p.b })),
        tightest_clearance: rep.tightestClear
          ? {
              a: rep.tightestClear.a,
              b: rep.tightestClear.b,
              gap_mm: rep.tightestClear.minDistance,
            }
          : undefined,
        note: 'Touching pairs share a surface but no volume; use no_interference with allowTouching false or min_gap specs for stricter rules.',
      });
    },
  },
  {
    name: 'bom',
    description:
      'Bill of materials: identical bodies grouped with quantities, material, mass each and total, size, and the total assembly mass (bodies without a material are listed as missing).',
    input: {},
    readOnly: true,
    run: async (_a, ctx) => {
      const model = ctx.session.model;
      if (!model || model.bodies.size === 0) throw new Error('The model has no bodies yet');
      const b = billOfMaterials(model);
      return j({
        parts: b.parts,
        total_mass_g: b.totalMassG,
        lines: b.lines.map((l) => ({
          ids: l.ids,
          quantity: l.quantity,
          material: l.material ?? 'not set',
          mass_each_g: l.massEachG,
          mass_total_g: l.massTotalG,
          size_mm: l.sizeMm,
          volume_mm3: l.volumeMm3,
        })),
        ...(b.missingMaterial.length
          ? {
              missing_material: b.missingMaterial,
              hint: 'add a material step to include these in the mass',
            }
          : {}),
        note: 'Masses assume solid material at typical density. Identical = same material, volume and size (orientation ignored).',
      });
    },
  },
  {
    name: 'motion_check',
    description:
      'Sweep one body through a straight-line (translate) or rotary (rotate about X/Y/Z through an origin) motion in steps and report where it first hits any other body, the tightest gap, and every pose. Poses are sampled, so use enough steps (default 20, max 120) for thin parts. Checks geometry only: no forces, speeds or dynamics.',
    input: {
      body: z.string(),
      translate: Vec3.optional().describe('total displacement [dx, dy, dz] mm'),
      rotate: z
        .object({ axis: z.enum(['X', 'Y', 'Z']), degrees: z.number(), origin: Vec3.optional() })
        .optional(),
      steps: z.number().int().min(1).max(120).optional(),
      against: z
        .array(z.string())
        .optional()
        .describe('bodies to check against (default: all others)'),
    },
    readOnly: true,
    run: async (a, ctx) => {
      const model = ctx.session.model;
      if (!model || model.bodies.size === 0) throw new Error('The model has no bodies yet');
      const r = motionCheck(model, {
        body: a.body as string,
        translate: a.translate as [number, number, number] | undefined,
        rotate: a.rotate as never,
        steps: a.steps as number | undefined,
        against: a.against as string[] | undefined,
      });
      return j({
        verdict: r.collisionFree
          ? 'COLLISION-FREE over the sampled poses'
          : r.startsInCollision
            ? 'ALREADY COLLIDING at the start pose'
            : `COLLIDES from step ${r.firstCollision?.step} (${Math.round((r.firstCollision?.fraction ?? 0) * 1000) / 10}% of the motion)`,
        poses_checked: r.poses,
        colliding_poses: r.collidingPoses,
        first_collision: r.firstCollision,
        tightest_gap_mm: r.tightestGapMm,
        poses: r.results.map((p) => ({
          step: p.step,
          fraction: p.fraction,
          ...(p.collisions.length ? { collides_with: p.collisions } : {}),
          ...(p.minGapMm !== undefined ? { min_gap_mm: p.minGapMm } : {}),
        })),
        note: 'Sampled poses only: a thin part can pass through a thin obstacle between samples, so raise steps for thin parts. This checks geometry, not dynamics.',
      });
    },
  },
];
