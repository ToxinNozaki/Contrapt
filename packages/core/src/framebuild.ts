// Shared definitions for analysis models that the MCP tools AND the Proof Loop specs both use: a frame described with
// library materials and section presets (or a sketch), and the regions that pick supports and loads on a solid.

import type { Drawing } from 'replicad';
import { z } from 'zod';
import { DOFS, type FrameInput, type FrameMember } from './fea.ts';
import { getMaterial, MATERIAL_NAMES } from './materials.ts';
import { type SectionProps, sectionProperties } from './section.ts';

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const SectionSchema = z.union([
  z.object({ shape: z.literal('round'), d: z.number().positive() }),
  z.object({
    shape: z.literal('rect'),
    w: z
      .number()
      .positive()
      .describe('width along the member local y (sideways for a horizontal member)'),
    h: z
      .number()
      .positive()
      .describe(
        'depth along local z (up for a horizontal member): the stiff direction when larger',
      ),
  }),
  z.object({ shape: z.literal('round_tube'), d: z.number().positive(), t: z.number().positive() }),
  z.object({
    shape: z.literal('rect_tube'),
    w: z.number().positive(),
    h: z.number().positive(),
    t: z.number().positive(),
  }),
  z.object({
    sketch: z.string().describe('id of a sketch: its x is the local y axis, its y is local z (up)'),
  }),
]);
export type FrameSection = z.infer<typeof SectionSchema>;

export const SupportFixSchema = z.union([
  z.enum(['fixed', 'pinned']),
  z.array(z.enum(DOFS)).min(1),
]);

/** The shape (not the object) so tools can spread it into their own input. */
export const FrameDefShape = {
  nodes: z.record(z.string(), Vec3).describe('named nodes with [x, y, z] in mm; Z is up'),
  members: z
    .array(
      z.object({
        id: z.string(),
        a: z.string(),
        b: z.string(),
        material: z.enum(MATERIAL_NAMES),
        section: SectionSchema,
        rollDeg: z.number().optional().describe('rotate the section about the member axis'),
        load: Vec3.optional().describe(
          'uniform load on the member in GLOBAL axes, N/mm (e.g. [0, 0, -0.5])',
        ),
      }),
    )
    .min(1),
  supports: z
    .array(
      z.object({
        node: z.string(),
        fix: SupportFixSchema.describe(
          '"fixed" = all six, "pinned" = translations only (add rx somewhere to stop spinning), or a list of ux uy uz rx ry rz',
        ),
      }),
    )
    .min(1),
  loads: z
    .array(
      z.object({
        node: z.string(),
        force: Vec3.optional().describe('N'),
        moment: Vec3.optional().describe('N*mm'),
      }),
    )
    .optional(),
  gravity: z.boolean().optional().describe('add every member own weight (down, -Z)'),
};
export const FrameDefSchema = z.object(FrameDefShape);
export type FrameDef = z.infer<typeof FrameDefSchema>;

export const RegionSchema = z
  .union([
    z.object({
      face: z.object({
        normal: z.enum(['+X', '-X', '+Y', '-Y', '+Z', '-Z']),
        near: Vec3.optional().describe('pick the matching flat face closest to this point'),
      }),
    }),
    z.object({ box: z.object({ min: Vec3, max: Vec3 }) }),
  ])
  .describe(
    'where: a flat face of the body picked by outward normal, or a world box (mm) that selects the nodes inside it',
  );

export const SolidSupportSchema = z.object({
  region: RegionSchema,
  dofs: z.array(z.enum(['x', 'y', 'z'])).optional(),
});
export const SolidLoadSchema = z.object({
  region: RegionSchema,
  force: Vec3.describe('total force on the region, N'),
});

type Sketches = Map<string, { drawing: Drawing }> | undefined;

export function frameSectionProps(s: FrameSection, sketches: Sketches) {
  if ('sketch' in s) {
    const sk = sketches?.get(s.sketch);
    if (!sk)
      throw new Error(
        `No sketch "${s.sketch}". Sketches: ${sketches ? [...sketches.keys()].join(', ') : '(none)'}`,
      );
    const p: SectionProps = sectionProperties(sk.drawing);
    return {
      A: p.area,
      Iy: p.Ix,
      Iz: p.Iy,
      J: p.Jpolar,
      cz: Math.max(p.extent.yMax, p.extent.yMin),
      cy: Math.max(p.extent.xMax, p.extent.xMin),
    };
  }
  switch (s.shape) {
    case 'round': {
      const I = (Math.PI * s.d ** 4) / 64;
      return { A: (Math.PI * s.d ** 2) / 4, Iy: I, Iz: I, J: 2 * I, cz: s.d / 2, cy: s.d / 2 };
    }
    case 'rect': {
      const a = Math.max(s.w, s.h);
      const b = Math.min(s.w, s.h);
      // standard torsion constant of a solid rectangle
      const J = a * b ** 3 * (1 / 3 - 0.21 * (b / a) * (1 - b ** 4 / (12 * a ** 4)));
      return {
        A: s.w * s.h,
        Iy: (s.w * s.h ** 3) / 12,
        Iz: (s.h * s.w ** 3) / 12,
        J,
        cz: s.h / 2,
        cy: s.w / 2,
      };
    }
    case 'round_tube': {
      const di = s.d - 2 * s.t;
      if (!(di > 0)) throw new Error('tube wall is too thick for its diameter');
      const I = (Math.PI * (s.d ** 4 - di ** 4)) / 64;
      return {
        A: (Math.PI * (s.d ** 2 - di ** 2)) / 4,
        Iy: I,
        Iz: I,
        J: 2 * I,
        cz: s.d / 2,
        cy: s.d / 2,
      };
    }
    case 'rect_tube': {
      const wi = s.w - 2 * s.t;
      const hi = s.h - 2 * s.t;
      if (!(wi > 0 && hi > 0)) throw new Error('tube wall is too thick for its size');
      // thin-wall closed section (Bredt): J = 4 Am^2 t / perimeter of the mid-line
      const Am = (s.w - s.t) * (s.h - s.t);
      const per = 2 * (s.w - s.t + (s.h - s.t));
      return {
        A: s.w * s.h - wi * hi,
        Iy: (s.w * s.h ** 3 - wi * hi ** 3) / 12,
        Iz: (s.h * s.w ** 3 - hi * wi ** 3) / 12,
        J: (4 * Am * Am * s.t) / per,
        cz: s.h / 2,
        cy: s.w / 2,
      };
    }
  }
}

/** Resolve a frame definition (library materials, section presets or sketches) into the solver input. */
export function buildFrameInput(def: FrameDef, sketches: Sketches): FrameInput {
  const members: FrameMember[] = def.members.map((m) => {
    const mat = getMaterial(m.material);
    if (!mat.youngsModulusGPa) throw new Error(`${m.material} has no modulus in the library`);
    const p = frameSectionProps(m.section, sketches);
    return {
      id: m.id,
      a: m.a,
      b: m.b,
      E: mat.youngsModulusGPa * 1000,
      A: p.A,
      Iy: p.Iy,
      Iz: p.Iz,
      J: p.J,
      cy: p.cy,
      cz: p.cz,
      density: mat.density,
      yield: mat.yieldMPa,
      rollDeg: m.rollDeg,
      w: m.load,
    };
  });
  return {
    nodes: def.nodes as FrameInput['nodes'],
    members,
    supports: def.supports.map((s) => ({
      node: s.node,
      fix: s.fix === 'fixed' ? [...DOFS] : s.fix === 'pinned' ? ['ux', 'uy', 'uz'] : s.fix,
    })),
    loads: def.loads as FrameInput['loads'],
    gravity: def.gravity,
  };
}
