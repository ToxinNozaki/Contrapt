// The feature timeline: Contrapt's single source of truth for a model.
//
// A timeline is plain JSON: named parameters plus an ordered list of steps. Tool calls append steps;
// scripts compile into the same steps. Rebuilding the timeline always reproduces the geometry.
// Any numeric field may be a number or an expression string that references parameters.
import { z } from 'zod';
import { isSafeFileName } from './import.ts';

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

export const StepInput = z.discriminatedUnion('op', [
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
