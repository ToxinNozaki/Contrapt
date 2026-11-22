// Planar mechanism tools: linkage kinematics sweep and four-bar classification.
import {
  fourBarCheck,
  getMaterial,
  inertiaAboutAxis,
  MATERIAL_NAMES,
  massProps,
  simulateDynamics,
  sweepMechanism,
  withDensity,
} from '@contrapt/core';
import { z } from 'zod';
import { j, type ToolDef } from './tools.ts';

const P2 = z.tuple([z.number(), z.number()]);
const NOTE =
  'Kinematics of an ideal planar linkage (rigid links, frictionless pins, no clearance or flex). It says where parts go and how the angles change, not what forces or motor torque are needed.';

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
const round = (x: number, d = 6) => Math.round(x * 10 ** d) / 10 ** d;

export const mechanismTools: ToolDef[] = [
  {
    name: 'mass_properties',
    description:
      'Mass, centre of mass and the full inertia tensor of a body (uniform density, from the exact tessellation): inertia about the centre of mass in kg*m^2 and g*mm^2, principal moments and axes, radii of gyration, and optionally the moment of inertia about any axis (parallel-axis theorem), which is the number dynamics_sim needs. Material from the body or the material argument.',
    input: {
      body: z.string(),
      material: z.enum(MATERIAL_NAMES).optional().describe('overrides the body material'),
      axis: z
        .object({ origin: Vec3.describe('a point on the axis, mm'), direction: Vec3 })
        .optional()
        .describe('also return the moment of inertia about this axis (e.g. a hinge)'),
    },
    readOnly: true,
    run: async (a, ctx) => {
      const model = ctx.session.model;
      if (!model) throw new Error('Nothing built yet');
      const id = a.body as string;
      const shape = model.bodies.get(id);
      if (!shape)
        throw new Error(`No body "${id}". Bodies: ${[...model.bodies.keys()].join(', ')}`);
      const matName = (a.material as string | undefined) ?? model.materials.get(id);
      if (!matName) throw new Error(`${id} has no material: add a material step or pass material`);
      const mat = getMaterial(matName);
      const mp = massProps(shape);
      const d = withDensity(mp, mat.density);
      const ax = a.axis as
        | { origin: [number, number, number]; direction: [number, number, number] }
        | undefined;
      return j({
        body: id,
        material: matName,
        volume_mm3: round(mp.volume, 3),
        mass_g: round(d.massG, 4),
        center_of_mass_mm: d.centerOfMass.map((x) => round(x, 4)),
        inertia_about_com_kgm2: d.inertiaKgm2.map((r) => r.map((x) => Number(x.toPrecision(6)))),
        inertia_about_com_gmm2: d.inertiaGmm2.map((r) => r.map((x) => Number(x.toPrecision(6)))),
        principal: d.principal.map((q, i) => ({
          moment_kgm2: Number(q.momentKgm2.toPrecision(6)),
          axis: q.axis.map((x) => round(x, 5)),
          gyration_radius_mm: round(d.gyrationMm[i] as number, 4),
        })),
        ...(ax
          ? {
              inertia_about_axis_kgm2: Number(
                inertiaAboutAxis(mp, mat.density, ax.origin, ax.direction).toPrecision(6),
              ),
            }
          : {}),
        note: 'Uniform density from a fine tessellation of the exact surface: exact for flat-faced bodies, within about 0.5% for curved ones. Printed parts with infill are lighter than this.',
      });
    },
  },
  {
    name: 'dynamics_sim',
    description:
      'One-degree-of-freedom dynamics in SI units (kg, m, N, N*m, rad, s), integrated with RK4: rotary or linear inertia with viscous damping, a spring, pendulum gravity (restoring torque = mass*g*arm*sin q, or upright for an inverted pendulum), a constant slope force, Coulomb friction, a constant drive or a DC-motor torque-speed line, drive start time, and hard stops. Returns peak/final values, settling time, oscillation period, energy drift check, warnings and a decimated time series. Reflect gearing yourself (inertia / ratio^2, torque x ratio x efficiency). Get inertia from mass_properties. Validated against pendulum, spring-mass-damper, DC motor and friction closed forms.',
    input: {
      kind: z.enum(['rotary', 'linear']),
      inertia: z.number().positive().describe('kg*m^2 (rotary) or kg (linear)'),
      damping: z.number().nonnegative().optional().describe('N*m*s/rad or N*s/m'),
      spring: z.number().nonnegative().optional().describe('N*m/rad or N/m'),
      spring_zero: z.number().optional(),
      gravity: z
        .object({
          mass: z.number().positive(),
          arm_m: z.number().nonnegative(),
          upright: z.boolean().optional(),
        })
        .optional()
        .describe(
          'rotary only: centre of mass at arm_m from the pivot; q = 0 hanging (or upright)',
        ),
      constant_force: z
        .number()
        .optional()
        .describe('linear: constant force along the motion, N (e.g. m g sin slope)'),
      friction: z.number().nonnegative().optional().describe('Coulomb friction, N or N*m'),
      drive: z
        .union([
          z.object({ constant: z.number() }),
          z.object({ stall_torque: z.number().positive(), no_load_speed: z.number().positive() }),
        ])
        .optional()
        .describe(
          'constant force/torque, or a DC motor: T = stall_torque (1 - speed / no_load_speed)',
        ),
      drive_start_s: z.number().nonnegative().optional(),
      q0: z.number().optional().describe('initial position, rad or m'),
      v0: z.number().optional().describe('initial velocity'),
      duration_s: z.number().positive(),
      limits: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
      samples: z.number().int().min(2).max(2000).optional(),
    },
    readOnly: true,
    run: async (a) => {
      const drive = a.drive as
        | { constant: number }
        | { stall_torque: number; no_load_speed: number }
        | undefined;
      const g = a.gravity as { mass: number; arm_m: number; upright?: boolean } | undefined;
      const r = simulateDynamics({
        kind: a.kind as 'rotary',
        inertia: a.inertia as number,
        damping: a.damping as number | undefined,
        spring: a.spring as number | undefined,
        springZero: a.spring_zero as number | undefined,
        gravity: g ? { mass: g.mass, arm: g.arm_m, upright: g.upright } : undefined,
        constantForce: a.constant_force as number | undefined,
        friction: a.friction as number | undefined,
        drive: drive
          ? 'constant' in drive
            ? drive
            : { stall: drive.stall_torque, noLoadSpeed: drive.no_load_speed }
          : undefined,
        driveStart: a.drive_start_s as number | undefined,
        q0: a.q0 as number | undefined,
        v0: a.v0 as number | undefined,
        duration: a.duration_s as number,
        limits: a.limits as never,
        samples: Math.min(60, (a.samples as number | undefined) ?? 60),
      });
      return j({
        peak_position: { value: round(r.peakPosition.value, 6), at_s: round(r.peakPosition.t, 4) },
        peak_velocity: { value: round(r.peakVelocity.value, 6), at_s: round(r.peakVelocity.t, 4) },
        final: { position: round(r.final.q, 6), velocity: round(r.final.v, 6) },
        ...(r.settleTime !== undefined ? { settle_time_s: round(r.settleTime, 4) } : {}),
        ...(r.period !== undefined ? { oscillation_period_s: round(r.period, 6) } : {}),
        ...(r.energyDrift !== undefined
          ? { energy_drift_relative: Number(r.energyDrift.toExponential(2)) }
          : {}),
        ...(r.stoppedBy ? { stopped_by: r.stoppedBy } : {}),
        warnings: r.warnings,
        // at most 60 evenly spaced rows, always including the first and the last sample
        series: (() => {
          const cap = Math.min(60, (a.samples as number | undefined) ?? 60);
          const idx =
            r.t.length <= cap
              ? r.t.map((_, i) => i)
              : Array.from({ length: cap }, (_, k) =>
                  Math.round((k * (r.t.length - 1)) / (cap - 1)),
                );
          return idx.map((i) => ({
            t: round(r.t[i] as number, 5),
            q: round(r.q[i] as number, 6),
            v: round(r.v[i] as number, 6),
          }));
        })(),
        steps: r.steps,
        note: 'Single-coordinate rigid-body model: no flex, backlash, contact dynamics or coupling between degrees of freedom. Fine for sizing motors, swing times and damping; use mechanism_sweep for geometry.',
      });
    },
  },
  {
    name: 'mechanism_sweep',
    description:
      'Planar linkage kinematics: pins joined by rigid links, grounded pivots, optional sliders (a pin held on a horizontal or vertical line), one driven crank swept through an angle range. Solves every pose with the 2D constraint solver, keeping the same assembly branch. Returns the feasible range (where it locks), pin paths and extents, link angles and joint angles over the cycle (e.g. a transmission angle), and a branch-flip warning. Give the pin positions of one valid pose. Use it for four-bars, slider-cranks, wipers, toggles, grippers.',
    input: {
      points: z
        .record(z.string(), P2)
        .describe('every pin with [x, y] mm in a valid pose (the sweep starts from it)'),
      grounds: z.array(z.string()).min(1).describe('pins fixed to the frame'),
      links: z
        .array(z.object({ a: z.string(), b: z.string(), length: z.number().positive().optional() }))
        .describe(
          'rigid links between two pins (length defaults to their distance in the given pose)',
        ),
      sliders: z
        .array(
          z.object({
            point: z.string(),
            axis: z
              .enum(['x', 'y'])
              .describe(
                'y = the pin keeps its y (slides horizontally); x = keeps its x (slides vertically)',
              ),
          }),
        )
        .optional(),
      crank: z.object({
        pivot: z.string(),
        tip: z.string(),
        from_deg: z.number(),
        to_deg: z.number(),
      }),
      steps: z.number().int().min(1).max(720).optional().describe('poses = steps + 1, default 72'),
      track: z.array(z.string()).optional().describe('pins whose paths to record'),
      angles: z
        .array(z.object({ name: z.string(), a: z.string(), b: z.string() }))
        .optional()
        .describe('absolute angle of a -> b, degrees'),
      joints: z
        .array(z.object({ name: z.string(), p: z.string(), q: z.string(), r: z.string() }))
        .optional()
        .describe('angle at q between q->p and q->r, degrees'),
    },
    readOnly: true,
    run: async (a) => {
      const c = a.crank as { pivot: string; tip: string; from_deg: number; to_deg: number };
      const res = await sweepMechanism({
        points: a.points as never,
        grounds: a.grounds as string[],
        links: a.links as never,
        sliders: a.sliders as never,
        crank: { pivot: c.pivot, tip: c.tip, fromDeg: c.from_deg, toDeg: c.to_deg },
        steps: a.steps as number | undefined,
        track: a.track as string[] | undefined,
        angles: a.angles as never,
        joints: a.joints as never,
      });
      const total = res.poses.length;
      const keep =
        total <= 37
          ? res.poses
          : res.poses.filter((_, i) => i % Math.ceil((total - 1) / 36) === 0 || i === total - 1);
      return j({
        verdict:
          res.infeasibleFromDeg === undefined
            ? `assembles through the whole range (${res.feasible} poses)`
            : `LOCKS from crank angle ${res.infeasibleFromDeg} degrees (${res.feasible} of ${total} poses feasible)`,
        ranges_deg: res.ranges,
        extents_mm: res.extents,
        warnings: res.warnings,
        poses: keep,
        poses_shown: `${keep.length} of ${total}`,
        note: NOTE,
      });
    },
  },
  {
    name: 'fourbar_check',
    description:
      'Closed-form four-bar linkage analysis: Grashof classification (crank-rocker, drag link, double-rocker, rocker-crank, non-Grashof, change point), whether the crank turns fully, the rocker swing and the transmission-angle range with a plain-language quality verdict (keep it within 40 to 140 degrees). Lengths in mm: ground (pivot to pivot), crank (input), coupler, rocker (output).',
    input: {
      ground: z.number().positive(),
      crank: z.number().positive(),
      coupler: z.number().positive(),
      rocker: z.number().positive(),
    },
    readOnly: true,
    run: async (a) => {
      const r = fourBarCheck(
        a.ground as number,
        a.crank as number,
        a.coupler as number,
        a.rocker as number,
      );
      return j({
        type: r.type,
        grashof: r.grashof,
        crank_turns_fully: r.crankTurnsFully,
        rocker_range_deg: r.rockerRangeDeg,
        transmission_angle_deg: r.transmissionDeg,
        quality: r.quality,
        notes: r.notes,
      });
    },
  },
];
