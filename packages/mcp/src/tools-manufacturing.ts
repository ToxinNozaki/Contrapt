// Manufacturing checks on the exact geometry.
import { printCheck } from '@contrapt/core';
import { z } from 'zod';
import { j, type ToolDef } from './tools.ts';

export const manufacturingTools: ToolDef[] = [
  {
    name: 'print_check',
    description:
      'FDM 3D-printability check of one body: overhang area and a support-volume upper bound for the model orientation (+Z up) and the five other axis-aligned ones, the recommended orientation, bed contact, thinnest wall (by ray casting along the inward normal), thin-wall share, and an optional build-volume fit. Heuristic, not a slicer; read the findings list.',
    input: {
      body: z.string(),
      overhang_deg: z
        .number()
        .min(10)
        .max(89)
        .optional()
        .describe('max angle from vertical printed without support, default 45'),
      min_wall_mm: z
        .number()
        .positive()
        .optional()
        .describe('thinnest acceptable wall, default 1.2 (three 0.4 mm lines)'),
      build_volume_mm: z
        .tuple([z.number(), z.number(), z.number()])
        .optional()
        .describe('printer [x, y, z] in mm'),
    },
    readOnly: true,
    run: async (a, ctx) => {
      const model = ctx.session.model;
      if (!model || model.bodies.size === 0) throw new Error('The model has no bodies yet');
      const r = printCheck(model, {
        body: a.body as string,
        overhangDeg: a.overhang_deg as number | undefined,
        minWallMm: a.min_wall_mm as number | undefined,
        buildVolume: a.build_volume_mm as [number, number, number] | undefined,
      });
      return j({
        body: r.body,
        findings: r.findings,
        recommended_up: r.recommended.up,
        current_orientation: r.current,
        orientations: r.orientations,
        wall_mm: {
          thinnest: r.wall.minMm,
          at: r.wall.atMm,
          thin_surface_pct: r.wall.thinPct,
          limit: r.wall.limitMm,
          samples: r.wall.sampled,
        },
        surface_area_mm2: r.surfaceAreaMm2,
        note: r.note,
      });
    },
  },
];
