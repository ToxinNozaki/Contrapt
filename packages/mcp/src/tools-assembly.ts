// Assembly tools: all-pairs interference, bill of materials, and motion-range sweeps.
import { billOfMaterials, interferenceReport, motionCheck } from '@contrapt/core';
import { z } from 'zod';
import { j, type ToolDef } from './tools.ts';

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const assemblyTools: ToolDef[] = [
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
