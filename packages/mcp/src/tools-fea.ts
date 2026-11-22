// Frame FEA tools: a real finite-element solve (3D beam elements) for frames, trusses made of rigid-jointed bars,
// machine frames, brackets built from bars. Validated against closed-form beam theory in core tests.
import {
  analyzeFrame,
  DOFS,
  type FrameInput,
  type FrameMember,
  frameBuckling,
  frameModes,
  getMaterial,
  MATERIAL_NAMES,
  sectionProperties,
  solidFea,
} from '@contrapt/core';
import { z } from 'zod';
import { j, type ToolContext, type ToolDef } from './tools.ts';

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

const Section = z.union([
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

const SupportFix = z.union([z.enum(['fixed', 'pinned']), z.array(z.enum(DOFS)).min(1)]);

const FrameArgs = {
  nodes: z.record(z.string(), Vec3).describe('named nodes with [x, y, z] in mm; Z is up'),
  members: z
    .array(
      z.object({
        id: z.string(),
        a: z.string(),
        b: z.string(),
        material: z.enum(MATERIAL_NAMES),
        section: Section,
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
        fix: SupportFix.describe(
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

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const roundAll = (a: number[], d = 4) => a.map((x) => round(x, d));

function sectionProps(ctx: ToolContext, s: z.infer<typeof Section>) {
  if ('sketch' in s) {
    const model = ctx.session.model;
    const sk = model?.sketches.get(s.sketch);
    if (!sk)
      throw new Error(
        `No sketch "${s.sketch}". Sketches: ${model ? [...model.sketches.keys()].join(', ') : '(none)'}`,
      );
    const p = sectionProperties(sk.drawing);
    return {
      A: p.area,
      Iy: p.Ix,
      Iz: p.Iy,
      J: p.Jpolar,
      cz: Math.max(p.extent.yMax, p.extent.yMin),
      cy: Math.max(p.extent.xMax, p.extent.xMin),
      jNote:
        'torsion constant approximated by the polar second moment (exact for round sections only)',
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

function toFrame(ctx: ToolContext, a: Record<string, unknown>): FrameInput {
  const members: FrameMember[] = (a.members as z.infer<typeof FrameArgs.members>).map((m) => {
    const mat = getMaterial(m.material);
    if (!mat.youngsModulusGPa) throw new Error(`${m.material} has no modulus in the library`);
    const p = sectionProps(ctx, m.section);
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
    nodes: a.nodes as FrameInput['nodes'],
    members,
    supports: (a.supports as z.infer<typeof FrameArgs.supports>).map((s) => ({
      node: s.node,
      fix: s.fix === 'fixed' ? [...DOFS] : s.fix === 'pinned' ? ['ux', 'uy', 'uz'] : s.fix,
    })),
    loads: a.loads as FrameInput['loads'],
    gravity: a.gravity as boolean | undefined,
  };
}

const Region = z
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

const NOTE =
  'Linear-elastic rigid-jointed frame of beam elements (Euler-Bernoulli). Member stress = axial + bending only: no shear stress, no stress concentrations at joints, holes or welds, no buckling or fatigue. Mesh long members into several elements (nodes) wherever you need results between joints. An estimate for sizing, validated against textbook beam results; not a certification.';

export const feaTools: ToolDef[] = [
  {
    name: 'solid_fea',
    description:
      'Static stress and displacement analysis of a SOLID body (3D linear elasticity: a regular grid of 8-node hexahedra with incompatible modes whose boundary nodes are snapped onto the exact surface, so curved boundaries are represented as curved; nodal stress recovery; matrix-free CG solver). Give supports (a face or box held fixed; optional dofs x/y/z), loads (a face or box + total force in N), optional gravity, and a library material. Returns max displacement, max and 99th-percentile von Mises stress with locations, safety factors vs yield, reactions, equilibrium check, grid quality (volume ratio) and solver convergence. Validated against beam theory, the frame solver and the handbook stress-concentration factor of a plate with a hole (within about 1% at 5 elements per hole radius, 8% at 2.5). Peak stress at sharp re-entrant corners and under point loads or fixed faces is still mesh-dependent and singular: read the 99th percentile, refine with element_size_mm and compare. Typical runs take seconds; keep the grid under about 40k elements.',
    input: {
      body: z.string(),
      material: z.enum(MATERIAL_NAMES),
      supports: z
        .array(z.object({ region: Region, dofs: z.array(z.enum(['x', 'y', 'z'])).optional() }))
        .min(1),
      loads: z
        .array(z.object({ region: Region, force: Vec3.describe('total force on the region, N') }))
        .optional(),
      gravity: z.boolean().optional().describe('add self weight (down, -Z)'),
      fit: z
        .boolean()
        .optional()
        .describe(
          'snap boundary nodes onto the true surface (default true); false = plain voxel staircase',
        ),
      element_size_mm: z
        .number()
        .positive()
        .optional()
        .describe(
          'grid cell size; default chosen from the part size (about 12k elements, at least 4 across the thinnest direction)',
        ),
    },
    readOnly: true,
    run: async (a, ctx) => {
      const model = ctx.session.model;
      if (!model) throw new Error('Nothing built yet');
      const id = a.body as string;
      const shape = model.bodies.get(id);
      const info = model.report.bodies[id];
      if (!shape || !info)
        throw new Error(`No body "${id}". Bodies: ${[...model.bodies.keys()].join(', ')}`);
      const mat = getMaterial(a.material as string);
      if (!mat.youngsModulusGPa) throw new Error(`${a.material} has no modulus in the library`);
      const minDim = Math.min(...info.bbox.size.filter((x) => x > 1e-6));
      let h = a.element_size_mm as number | undefined;
      if (h === undefined) {
        h = Math.min(Math.cbrt(info.volume / 12000), minDim / 4);
        // never exceed ~40k elements by default
        while (info.volume / h ** 3 > 40000) h *= 1.1;
        h = Math.round(h * 1000) / 1000;
      }
      const t0 = Date.now();
      const r = solidFea({
        shape,
        E: mat.youngsModulusGPa * 1000,
        yield: mat.yieldMPa,
        density: mat.density,
        elementSize: h,
        supports: a.supports as never,
        loads: a.loads as never,
        gravity: a.gravity as boolean | undefined,
        fit: a.fit as boolean | undefined,
      });
      const warn = [...r.warnings];
      if (Math.abs(r.volumeRatio - 1) > 0.05)
        warn.push(
          `The grid volume is ${Math.round((r.volumeRatio - 1) * 1000) / 10}% off the true volume: curved or thin features are poorly represented; reduce element_size_mm`,
        );
      if (minDim / h < 3)
        warn.push(
          `The thinnest direction is only ${Math.round((minDim / h) * 10) / 10} elements across: bending results will be too stiff or noisy; reduce element_size_mm`,
        );
      const sf = r.safetyFactorP99;
      return j({
        verdict:
          sf === undefined
            ? 'no yield data'
            : sf >= 2
              ? `safety factor ${round(sf, 2)} on the 99th-percentile stress (peak ${round(r.safetyFactorPeak ?? 0, 2)}): ok for static loads, if the mesh is good`
              : `safety factor ${round(sf, 2)} on the 99th-percentile stress (peak ${round(r.safetyFactorPeak ?? 0, 2)}): BELOW 2, marginal or failing`,
        max_displacement: {
          mm: round(r.maxDisplacement.value, 5),
          at_mm: roundAll(r.maxDisplacement.at, 2),
        },
        von_mises_MPa: {
          peak: round(r.maxVonMises.value, 3),
          peak_at_mm: roundAll(r.maxVonMises.at, 2),
          peak_element_average: round(r.peakElementVonMises, 3),
          p99: round(r.p99VonMises, 3),
          median: round(r.medianVonMises, 3),
          yield: mat.yieldMPa,
        },
        safety_factor: {
          p99: sf === undefined ? undefined : round(sf, 2),
          peak: r.safetyFactorPeak === undefined ? undefined : round(r.safetyFactorPeak, 2),
        },
        reaction_N: roundAll(r.reaction, 3),
        equilibrium_error_N: Number(r.equilibriumErrorN.toExponential(2)),
        strain_energy_J: Number(r.strainEnergyJ.toPrecision(4)),
        mesh: {
          element_size_mm: r.elementSizeMm,
          elements: r.elements,
          nodes: r.nodes,
          grid: r.grid,
          volume_ratio: round(r.volumeRatio, 4),
          fitted: r.fitted,
          snapped_nodes: r.snappedNodes,
          relaxed_nodes: r.relaxedNodes,
          min_jacobian_ratio: round(r.minJacobianRatio, 3),
        },
        solver: {
          converged: r.converged,
          iterations: r.iterations,
          relative_residual: Number(r.relativeResidual.toExponential(2)),
          seconds: round((Date.now() - t0) / 1000, 2),
        },
        ...(warn.length ? { warnings: warn } : {}),
        notes: [
          'Linear elastic, small deflection, perfect bonding, supports and loads as chosen. The mesh is a fitted structured hex grid: curved boundaries are well represented from about 4 elements per radius, sharp corners and thin features (under 2 elements) are not. Fixed faces and point loads create artificial stress spikes (the 99th percentile ignores single-element spikes). Halve element_size_mm and compare before trusting a peak. No fatigue, buckling, contact or plasticity. An estimate for sizing, not a certification.',
        ],
      });
    },
  },
  {
    name: 'frame_analysis',
    description:
      'Static finite-element analysis of a 3D frame made of straight members (beam elements): displacements at every node, support reactions, member forces, worst combined stress and safety factor against yield, plus an equilibrium check. Give nodes (mm, Z up), members (library material + a round/rect/round_tube/rect_tube section or a sketch id), supports, and nodal loads and/or member distributed loads and gravity. Put nodes where members meet, at supports, loads, and mid-span where you want deflection. Use it for machine frames, brackets made of bars, shelves, rigs. Not for solid parts with holes or fillets.',
    input: FrameArgs,
    readOnly: true,
    run: async (a, ctx) => {
      const input = toFrame(ctx, a);
      const r = analyzeFrame(input);
      return j({
        verdict:
          r.worstMember?.safetyFactor === undefined
            ? 'no yield data'
            : r.worstMember.safetyFactor >= 2
              ? `worst member ${r.worstMember.id}: safety factor ${round(r.worstMember.safetyFactor, 2)} (ok for static loads)`
              : `worst member ${r.worstMember.id}: safety factor ${round(r.worstMember.safetyFactor, 2)} (BELOW 2: marginal or failing)`,
        max_displacement: { node: r.maxDisplacement.node, mm: round(r.maxDisplacement.value) },
        displacements_mm_rad: Object.fromEntries(
          Object.entries(r.displacements).map(([k, v]) => [k, roundAll(v, 5)]),
        ),
        reactions_N_Nmm: Object.fromEntries(
          Object.entries(r.reactions).map(([k, v]) => [k, roundAll(v, 3)]),
        ),
        members: r.members.map((m) => ({
          id: m.id,
          length_mm: round(m.length, 3),
          max_axial_N: round(m.maxAxial, 3),
          max_shear_N: round(m.maxShear, 3),
          max_moment_y_Nmm: round(m.maxMomentY, 2),
          max_moment_z_Nmm: round(m.maxMomentZ, 2),
          max_torque_Nmm: round(m.maxTorque, 2),
          max_stress_MPa: round(m.maxStress, 3),
          ...(m.safetyFactor !== undefined ? { safety_factor: round(m.safetyFactor, 2) } : {}),
        })),
        equilibrium_error_N: Number(r.equilibriumErrorN.toExponential(2)),
        ...(r.totalMassTonne !== undefined
          ? { total_mass_g: round(r.totalMassTonne * 1e6, 3) }
          : {}),
        notes: [...r.notes, NOTE],
      });
    },
  },
  {
    name: 'frame_buckling',
    description:
      'Linear (Euler) buckling of the same kind of frame model: the load factors (multipliers on ALL the applied loads, and gravity if on) at which the frame buckles, lowest first, plus every member axial force under the given loads. Factor 1.0 means the loads you applied are exactly the buckling load; apply a design margin of at least 3 (imperfections and inelastic effects only lower it). Put at least 4 nodes (elements) along every member that can buckle. Tension-only frames report nothing to buckle. Elastic only, no imperfections or post-buckling.',
    input: {
      ...FrameArgs,
      count: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('how many buckling modes, default 3'),
    },
    readOnly: true,
    run: async (a, ctx) => {
      const r = frameBuckling(
        toFrame(ctx, a as Record<string, unknown>),
        (a.count as number | undefined) ?? 3,
      );
      const first = r.loadFactors[0];
      return j({
        verdict: r.tensionOnly
          ? 'no member is in compression: nothing to buckle'
          : first === undefined
            ? 'no buckling mode found'
            : first >= 3
              ? `lowest buckling load factor ${round(first, 3)}: at least 3, an acceptable margin for a perfect elastic estimate`
              : `lowest buckling load factor ${round(first, 3)}: BELOW 3. The applied loads are within ${round(first, 2)}x of buckling${first < 1 ? ' (it buckles under the loads as given)' : ''}`,
        load_factors: r.loadFactors.map((x) => round(x, 4)),
        member_axial_forces_N: Object.fromEntries(
          Object.entries(r.axialForces).map(([k, v]) => [k, round(v, 3)]),
        ),
        notes: r.notes,
      });
    },
  },
  {
    name: 'frame_modes',
    description:
      'Natural frequencies (Hz) of the same kind of frame model (consistent mass, no added masses, no damping): how stiff and light the frame is, and what to keep motors and fans away from. Same inputs as frame_analysis (loads are ignored). Accuracy needs at least 4 elements per bending member: compare with a finer mesh.',
    input: {
      ...FrameArgs,
      count: z.number().int().min(1).max(20).optional().describe('how many modes, default 5'),
    },
    readOnly: true,
    run: async (a, ctx) => {
      const r = frameModes(
        toFrame(ctx, { ...a, loads: undefined }),
        (a.count as number | undefined) ?? 5,
      );
      return j({
        frequencies_hz: r.frequencies.map((f) => round(f, 3)),
        notes: [
          ...r.notes,
          'Frame alone: attached masses (motors, payload) lower these frequencies. Estimate, not a measurement.',
        ],
      });
    },
  },
];
