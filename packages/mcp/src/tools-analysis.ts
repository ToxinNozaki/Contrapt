// Hand-calculation analysis tools: cross-section properties, beam checks, column buckling.
// These are textbook closed-form ESTIMATES. They say so in every result, and Contrapt does not run FEA yet.
import {
  BEAM_SUPPORTS,
  beamWithSelfWeight,
  COLUMN_ENDS,
  eulerBuckling,
  getMaterial,
  MATERIAL_NAMES,
  type SectionProps,
  sectionProperties,
} from '@contrapt/core';
import { z } from 'zod';
import { j, type ToolContext, type ToolDef } from './tools.ts';

const NOTE =
  'Closed-form hand-calculation estimate (linear elastic, small deflection, ideal supports). It is not a simulation: verify with a real analysis or a prototype before relying on it.';

function sectionOf(ctx: ToolContext, id: string): SectionProps {
  const model = ctx.session.model;
  const sk = model?.sketches.get(id);
  if (!sk) {
    const have = model ? [...model.sketches.keys()].join(', ') : '';
    throw new Error(`No sketch "${id}". Sketches: ${have || '(none yet)'}`);
  }
  return sectionProperties(sk.drawing);
}

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

const MaterialArg = z
  .enum(MATERIAL_NAMES)
  .describe('library material: supplies Young modulus, yield strength and density');

export const analysisTools: ToolDef[] = [
  {
    name: 'section_properties',
    description:
      'Cross-section properties of a 2D sketch (any outline, holes allowed): area, centroid, second moments Ix/Iy about the centroid (mm^4), product of inertia, principal axes, section moduli Zx/Zy (mm^3), radii of gyration, extreme-fibre distances. Ix resists bending where the depth is along the sketch Y axis. Use before beam_check.',
    input: { sketch: z.string().describe('id of a sketch step (sketch or constrained_sketch)') },
    readOnly: true,
    run: async (a, ctx) => {
      const s = sectionOf(ctx, a.sketch as string);
      return j({
        sketch: a.sketch,
        ...s,
        units: 'mm, mm^2, mm^3, mm^4',
        note: 'Ix is the stiffness against bending that deflects along sketch Y; Iy against bending along sketch X. Jpolar = Ix + Iy is NOT the torsion constant.',
      });
    },
  },
  {
    name: 'beam_check',
    description:
      'Check a straight beam with textbook formulas: max deflection, max bending moment and stress, safety factor against yield, span/deflection, reaction. Section from a sketch id (run section_properties first if unsure) or explicit I and c. Material from the library or explicit E and yield. Loads in N (point) or N/mm (uniform); self_weight adds the beam own weight. A hand estimate, not a simulation.',
    input: {
      support: z.enum(BEAM_SUPPORTS),
      load: z
        .enum(['point', 'uniform'])
        .describe('point = one load at the free end (cantilever) or mid-span (others)'),
      value: z.number().describe('N for point loads, N/mm for uniform loads'),
      length_mm: z.number().positive(),
      sketch: z.string().optional().describe('sketch id giving the cross-section'),
      bend: z
        .enum(['x', 'y'])
        .optional()
        .describe('x (default): bending where the depth is along sketch Y, uses Ix; y: uses Iy'),
      I_mm4: z
        .number()
        .positive()
        .optional()
        .describe('explicit second moment of area (instead of sketch)'),
      c_mm: z
        .number()
        .positive()
        .optional()
        .describe('explicit distance to the extreme fibre (with I_mm4)'),
      area_mm2: z
        .number()
        .positive()
        .optional()
        .describe('explicit area (only needed for self_weight with I_mm4)'),
      material: MaterialArg.optional(),
      E_MPa: z.number().positive().optional(),
      yield_MPa: z.number().positive().optional(),
      self_weight: z
        .boolean()
        .optional()
        .describe('add the beam weight as a uniform load (needs material and area)'),
    },
    readOnly: true,
    run: async (a, ctx) => {
      let I = a.I_mm4 as number | undefined;
      let c = a.c_mm as number | undefined;
      let area = a.area_mm2 as number | undefined;
      const bendAxis = (a.bend as 'x' | 'y' | undefined) ?? 'x';
      if (a.sketch) {
        const s = sectionOf(ctx, a.sketch as string);
        I = bendAxis === 'x' ? s.Ix : s.Iy;
        c =
          bendAxis === 'x'
            ? Math.max(s.extent.yMax, s.extent.yMin)
            : Math.max(s.extent.xMax, s.extent.xMin);
        area = s.area;
      }
      if (!I || !c) throw new Error('Give a "sketch" id, or both I_mm4 and c_mm');
      const mat = a.material ? getMaterial(a.material as string) : undefined;
      const E =
        (a.E_MPa as number | undefined) ??
        (mat?.youngsModulusGPa ? mat.youngsModulusGPa * 1000 : undefined);
      if (!E) throw new Error('Give a "material" with a known modulus, or E_MPa');
      const yieldMPa = (a.yield_MPa as number | undefined) ?? mat?.yieldMPa;

      const load = a.load as 'point' | 'uniform';
      const value = a.value as number;
      const r = beamWithSelfWeight({
        support: a.support as never,
        load,
        value,
        length: a.length_mm as number,
        E,
        I,
        c,
        yield: yieldMPa,
        area,
        density: mat?.density,
        selfWeight: !!a.self_weight,
      });
      const selfWeightNote =
        r.selfWeightPerMm !== undefined
          ? `self weight ${round(r.selfWeightPerMm * (a.length_mm as number), 3)} N added as a uniform load of ${round(r.selfWeightPerMm, 6)} N/mm`
          : undefined;
      return j({
        support: a.support,
        input: {
          load: a.load,
          value: a.value,
          length_mm: a.length_mm,
          E_MPa: E,
          yield_MPa: yieldMPa,
          I_mm4: round(I),
          c_mm: round(c),
        },
        formula: r.formula,
        max_deflection_mm: round(r.deflection),
        span_over_deflection: round(r.spanOverDeflection, 1),
        max_moment_Nmm: round(r.moment, 2),
        max_stress_MPa: round(r.stress, 3),
        ...(r.safetyFactor !== undefined
          ? { safety_factor_vs_yield: round(r.safetyFactor, 2) }
          : {}),
        reaction_N: round(r.reaction, 3),
        where: r.where,
        ...(selfWeightNote ? { self_weight: selfWeightNote } : {}),
        guidance: [
          r.spanOverDeflection < 360
            ? 'span/deflection is below 360: visibly floppy for most parts'
            : 'span/deflection is at least 360',
          r.safetyFactor !== undefined && r.safetyFactor < 2
            ? 'safety factor below 2: marginal for anything that matters; use 2+ for static loads, 4+ with shock or uncertainty'
            : undefined,
        ].filter(Boolean),
        note: NOTE,
      });
    },
  },
  {
    name: 'column_check',
    description:
      'Euler buckling check for a straight column under axial load: critical load, slenderness ratio, and whether buckling or crushing governs. Section from a sketch id (uses the smaller of Ix and Iy) or explicit I and area. Hand estimate; apply a safety factor of at least 3 to the critical load.',
    input: {
      ends: z.enum(Object.keys(COLUMN_ENDS) as [string, ...string[]]),
      length_mm: z.number().positive(),
      sketch: z.string().optional(),
      I_mm4: z.number().positive().optional(),
      area_mm2: z.number().positive().optional(),
      material: MaterialArg.optional(),
      E_MPa: z.number().positive().optional(),
      yield_MPa: z.number().positive().optional(),
      axial_load_N: z
        .number()
        .positive()
        .optional()
        .describe('if given, reports the buckling safety factor'),
    },
    readOnly: true,
    run: async (a, ctx) => {
      let I = a.I_mm4 as number | undefined;
      let area = a.area_mm2 as number | undefined;
      if (a.sketch) {
        const s = sectionOf(ctx, a.sketch as string);
        I = Math.min(s.Ix, s.Iy);
        area = s.area;
      }
      if (!I || !area) throw new Error('Give a "sketch" id, or both I_mm4 and area_mm2');
      const mat = a.material ? getMaterial(a.material as string) : undefined;
      const E =
        (a.E_MPa as number | undefined) ??
        (mat?.youngsModulusGPa ? mat.youngsModulusGPa * 1000 : undefined);
      if (!E) throw new Error('Give a "material" with a known modulus, or E_MPa');
      const yieldMPa = (a.yield_MPa as number | undefined) ?? mat?.yieldMPa;
      const r = eulerBuckling({
        E,
        I,
        length: a.length_mm as number,
        ends: a.ends as never,
        area,
        yield: yieldMPa,
      });
      const load = a.axial_load_N as number | undefined;
      return j({
        ends: a.ends,
        effective_length_factor_K: r.K,
        critical_load_N: round(r.criticalLoad, 2),
        slenderness_ratio: round(r.slenderness, 1),
        ...(r.crushLoad !== undefined
          ? { crush_load_N: round(r.crushLoad, 2), governs: r.governs, advice: r.note }
          : {}),
        ...(load ? { buckling_safety_factor: round(r.criticalLoad / load, 2) } : {}),
        note: NOTE,
      });
    },
  },
];
