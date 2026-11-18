// The feature timeline: Contrapt's single source of truth for a model.
//
// A timeline is plain JSON: named parameters plus an ordered list of steps. Tool calls append steps;
// scripts compile into the same steps. Rebuilding the timeline always reproduces the geometry.
// Any numeric field may be a number or an expression string that references parameters.
import { z } from 'zod';
import { DIRECTIONS, SCREW_SIZES } from './holes.ts';
import { isSafeFileName } from './import.ts';
import { MATERIAL_NAMES } from './materials.ts';
import { CONSTRAINT_TYPES } from './sketch.ts';

export const TIMELINE_VERSION = 1;

const Num = z.union([z.number(), z.string()]);
const Vec3 = z.tuple([Num, Num, Num]);
const PlaneName = z.enum(['XY', 'YZ', 'ZX', 'XZ', 'YX', 'ZY']);
const AxisName = z.enum(['X', 'Y', 'Z']);

const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'ids start with a letter; letters, digits, _ and - only');

// ---- 2D profile items (a sketch is a list of these; `cut` items are subtracted) -------------------
const ProfileItem = z.discriminatedUnion('shape', [
  z.object({
    shape: z.literal('rect'),
    w: Num,
    h: Num,
    cx: Num.optional(),
    cy: Num.optional(),
    cornerRadius: Num.optional(),
    cut: z.boolean().optional(),
  }),
  z.object({
    shape: z.literal('circle'),
    r: Num,
    cx: Num.optional(),
    cy: Num.optional(),
    cut: z.boolean().optional(),
  }),
  z.object({
    shape: z.literal('polygon'),
    points: z.array(z.tuple([Num, Num])).min(3),
    cut: z.boolean().optional(),
  }),
  z.object({
    shape: z.literal('ngon'),
    sides: z.number().int().min(3),
    r: Num,
    cx: Num.optional(),
    cy: Num.optional(),
    cut: z.boolean().optional(),
  }),
]);
export type ProfileItem = z.infer<typeof ProfileItem>;

// ---- selectors: pick edges/faces by description, with an optional count assertion -----------------
const EdgeSelector = z.object({
  all: z.boolean().optional(),
  direction: AxisName.optional().describe('edges parallel to this axis'),
  plane: z
    .object({ name: PlaneName, offset: Num.optional() })
    .optional()
    .describe('edges lying in a plane'),
  length: Num.optional().describe('edges of exactly this length'),
  lengthAtLeast: Num.optional().describe('edges at least this long (skips short hole/seam edges)'),
  lengthAtMost: Num.optional().describe('edges at most this long'),
  curve: z
    .enum(['line', 'circle'])
    .optional()
    .describe('only straight edges, or only circular edges'),
  box: z
    .object({ min: Vec3, max: Vec3 })
    .optional()
    .describe('edges entirely inside this axis-aligned box (use to avoid hole/seam edges)'),
  expect: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('fail the step unless exactly this many match'),
});
export type EdgeSelector = z.infer<typeof EdgeSelector>;

const FaceSelector = z.object({
  plane: z
    .object({ name: PlaneName, offset: Num.optional() })
    .optional()
    .describe('faces lying in a plane'),
  parallelTo: PlaneName.optional().describe('faces parallel to this plane'),
  expect: z.number().int().min(0).optional(),
});
export type FaceSelector = z.infer<typeof FaceSelector>;

// ---- steps -----------------------------------------------------------------------------------
const base = {
  id: Id.optional(),
  label: z.string().optional(),
  suppressed: z.boolean().optional(),
};

const Mode = z.enum(['new', 'add', 'cut']).describe('new body, add to target, or cut from target');

const FileName = z
  .string()
  .refine(
    isSafeFileName,
    'plain file name only (letters, digits, space, _ . ( ) + -); no folders or ".."',
  );

const PatternSpec = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('linear'),
    count: z.number().int().min(2).max(500),
    step: Vec3.describe('offset between instances'),
  }),
  z.object({
    kind: z.literal('circular'),
    count: z.number().int().min(2).max(500),
    axis: AxisName,
    center: Vec3.optional().describe('a point on the axis (default origin)'),
    angle: Num.optional().describe('total sweep in degrees, default 360 (spread evenly)'),
  }),
]);

const EntityName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'names start with a letter; letters, digits and _ only');

const ConstraintSpec = z.object({
  type: z.enum(CONSTRAINT_TYPES),
  a: EntityName.describe('first point/line/circle the constraint is about'),
  b: EntityName.optional().describe('second one, when the constraint relates two things'),
  value: Num.optional().describe(
    'a dimension (mm, degrees for angle); may be an expression over parameters',
  ),
  at: z
    .tuple([z.number(), z.number()])
    .optional()
    .describe('fix: pin the point here instead of where it is'),
});

export const StepInput = z.discriminatedUnion('op', [
  z.object({
    ...base,
    op: z.literal('constrained_sketch'),
    plane: PlaneName,
    offset: Num.optional(),
    points: z
      .record(EntityName, z.tuple([z.number(), z.number()]))
      .describe('named points with rough starting positions [x, y]'),
    lines: z
      .record(EntityName, z.tuple([EntityName, EntityName]))
      .optional()
      .describe('named lines between two points'),
    arcs: z
      .record(EntityName, z.object({ center: EntityName, start: EntityName, end: EntityName }))
      .optional()
      .describe('named counter-clockwise arcs from start to end around center (all named points)'),
    circles: z
      .record(EntityName, z.object({ center: EntityName, r: z.number().positive() }))
      .optional()
      .describe('named circles: center point and a starting radius'),
    constraints: z.array(ConstraintSpec),
    profile: z
      .array(
        z.union([
          z.object({ loop: z.array(EntityName).min(3), cut: z.boolean().optional() }),
          z.object({ circle: EntityName, cut: z.boolean().optional() }),
        ]),
      )
      .min(1)
      .describe(
        'what becomes solid: closed loops of line names and/or circle names; cut:true subtracts',
      ),
  }),
  z.object({
    ...base,
    op: z.literal('import'),
    file: FileName.describe('a file in the imports folder (STEP only for now)'),
    scale: Num.optional().describe(
      'multiply all dimensions (e.g. 25.4 for a model that came in as inches)',
    ),
    at: Vec3.optional().describe('translate the imported body'),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional()
      .describe('checksum recorded at import time; the build fails if the file later changes'),
  }),
  z.object({ ...base, op: z.literal('box'), w: Num, d: Num, h: Num, at: Vec3.optional() }),
  z.object({
    ...base,
    op: z.literal('cylinder'),
    r: Num,
    h: Num,
    at: Vec3.optional(),
    axis: AxisName.optional(),
  }),
  z.object({ ...base, op: z.literal('sphere'), r: Num, at: Vec3.optional() }),
  z.object({
    ...base,
    op: z.literal('sketch'),
    plane: PlaneName,
    offset: Num.optional(),
    profile: z.array(ProfileItem).min(1),
  }),
  z.object({
    ...base,
    op: z.literal('extrude'),
    sketch: Id,
    distance: Num,
    symmetric: z.boolean().optional(),
    mode: Mode.optional(),
    target: Id.optional(),
  }),
  z.object({
    ...base,
    op: z.literal('revolve'),
    sketch: Id,
    axis: AxisName.describe(
      'world axis to revolve around (the sketch profile should lie on one side of it)',
    ),
    origin: Vec3.optional().describe('a point the axis passes through (default: the origin)'),
    angle: Num.optional().describe('degrees, default 360'),
    mode: Mode.optional(),
    target: Id.optional(),
  }),
  z.object({
    ...base,
    op: z.literal('loft'),
    sketches: z
      .array(Id)
      .min(2)
      .max(12)
      .describe('sketch ids in order; each sits on its own plane/offset'),
    ruled: z
      .boolean()
      .optional()
      .describe('straight transitions between sections instead of smooth'),
    mode: Mode.optional(),
    target: Id.optional(),
  }),
  z.object({
    ...base,
    op: z.literal('sweep'),
    sketch: Id.describe(
      'the profile; it is placed automatically at the start of the path, perpendicular to it',
    ),
    path: z.object({
      points: z
        .array(Vec3)
        .min(2)
        .max(200)
        .describe('3D points the path passes through, joined by straight pieces'),
      bendRadius: Num.optional().describe(
        'round every interior corner with this radius (pipe bends)',
      ),
    }),
    mode: Mode.optional(),
    target: Id.optional(),
  }),
  z.object({
    ...base,
    op: z.literal('hole'),
    target: Id,
    at: z
      .union([Vec3, z.array(Vec3).min(1).max(500)])
      .describe('where the hole starts on the surface: one [x,y,z] or a list'),
    direction: z
      .enum(DIRECTIONS)
      .optional()
      .describe('drilling direction into the material, default -Z (down from a top face)'),
    size: z
      .enum(SCREW_SIZES)
      .optional()
      .describe('metric screw size: sets the diameter from real standards'),
    fit: z
      .enum(['normal', 'close', 'tap'])
      .optional()
      .describe('clearance fit (default normal), close fit, or tap drill for a threaded hole'),
    diameter: Num.optional().describe('explicit diameter (overrides size)'),
    depth: Num.optional().describe('blind depth from the surface; omit for a through hole'),
    counterbore: z
      .union([z.literal(true), z.object({ diameter: Num.optional(), depth: Num.optional() })])
      .optional()
      .describe('true = sized for a socket-head screw of this size'),
    countersink: z
      .union([z.literal(true), z.object({ diameter: Num.optional(), angle: Num.optional() })])
      .optional()
      .describe('true = 90 degree countersink about twice the screw diameter'),
    pattern: PatternSpec.optional().describe('repeat the hole(s) in a linear or circular pattern'),
  }),
  z.object({
    ...base,
    op: z.literal('pattern'),
    target: Id,
    tool: Id.describe('the body to repeat (it is consumed); instance 1 is the tool where it is'),
    pattern: PatternSpec,
    mode: z
      .enum(['cut', 'add'])
      .describe('subtract the copies from the target, or fuse them to it'),
  }),
  z.object({
    ...base,
    op: z.literal('mirror'),
    target: Id,
    axis: AxisName.describe('mirror across the plane perpendicular to this axis'),
    offset: Num.optional().describe('where that plane sits along the axis (default 0)'),
    mode: z
      .enum(['add', 'new'])
      .optional()
      .describe('add = fuse the mirror image to the target (default), new = a separate body'),
  }),
  z.object({
    ...base,
    op: z.literal('material'),
    target: Id,
    name: z
      .enum(MATERIAL_NAMES)
      .describe(
        'a material from the library: sets density for mass (see list_knowledge: materials)',
      ),
  }),
  z.object({ ...base, op: z.literal('fillet'), target: Id, radius: Num, edges: EdgeSelector }),
  z.object({ ...base, op: z.literal('chamfer'), target: Id, distance: Num, edges: EdgeSelector }),
  z.object({ ...base, op: z.literal('shell'), target: Id, thickness: Num, faces: FaceSelector }),
  z.object({
    ...base,
    op: z.literal('boolean'),
    kind: z.enum(['union', 'cut', 'intersect']),
    a: Id,
    b: Id,
  }),
  z.object({
    ...base,
    op: z.literal('transform'),
    target: Id,
    translate: Vec3.optional(),
    rotate: z.object({ angle: Num, axis: AxisName, origin: Vec3.optional() }).optional(),
  }),
]);
export type StepInput = z.infer<typeof StepInput>;

/** A stored step always has an id. */
export type Step = StepInput & { id: string };
export type StepOp = Step['op'];

export const TimelineSchema = z.object({
  version: z.literal(TIMELINE_VERSION),
  name: z.string(),
  units: z.literal('mm'),
  params: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), Num),
  steps: z.array(StepInput.and(z.object({ id: Id }))),
});
export type Timeline = z.infer<typeof TimelineSchema>;

export function emptyTimeline(name = 'untitled'): Timeline {
  return { version: TIMELINE_VERSION, name, units: 'mm', params: {}, steps: [] };
}

/** Human/AI-readable validation message ("steps[2].radius: Invalid input"). */
export function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}
