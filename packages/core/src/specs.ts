// The Proof Loop's requirements-as-code: specs are saved WITH the model and re-checked after every change, so a design
// is only "done" when every requirement passes against the real, rebuilt geometry. Beam specs are hand-calculation
// estimates (closed-form), and say so; frame_analysis (FEA) is not wired into specs yet.
import { z } from 'zod';
import { type BeamSupport, beamWithSelfWeight } from './beam.ts';
import type { Model } from './engine.ts';
import { analyzeFrame, frameBuckling, frameModes } from './fea.ts';
import {
  buildFrameInput,
  FrameDefSchema,
  RegionSchema,
  SolidLoadSchema,
  SolidSupportSchema,
} from './framebuild.ts';
import { checkInterference } from './interference.ts';
import { getMaterial, MATERIAL_NAMES } from './materials.ts';
import { sectionProperties } from './section.ts';
import { defaultSolidElementSize, solidFea } from './solidfea.ts';
import { solveThermal } from './thermal.ts';

const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'ids start with a letter; letters, digits, _ and - only');
const common = {
  id: Id,
  description: z
    .string()
    .max(300)
    .optional()
    .describe('why this requirement exists, in plain words'),
};

export const SpecSchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('dimension'),
    body: z.string(),
    axis: z.enum(['x', 'y', 'z']).describe('which bounding-box size (mm) to limit'),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.object({
    ...common,
    kind: z.literal('mass'),
    body: z.string(),
    minG: z.number().optional(),
    maxG: z.number().optional(),
  }),
  z.object({
    ...common,
    kind: z.literal('volume'),
    body: z.string(),
    minMm3: z.number().optional(),
    maxMm3: z.number().optional(),
  }),
  z.object({
    ...common,
    kind: z.literal('no_interference'),
    a: z.string(),
    b: z.string(),
    allowTouching: z.boolean().optional().describe('default true: touching faces are fine'),
  }),
  z.object({
    ...common,
    kind: z.literal('min_gap'),
    a: z.string(),
    b: z.string(),
    minMm: z.number(),
  }),
  z.object({
    ...common,
    kind: z.literal('beam'),
    sketch: z.string().describe('cross-section sketch id'),
    support: z.enum(['cantilever', 'simply-supported', 'fixed-fixed', 'fixed-pinned']),
    load: z.enum(['point', 'uniform']),
    value: z.number().describe('N (point) or N/mm (uniform)'),
    lengthMm: z.number().positive(),
    material: z.enum(MATERIAL_NAMES),
    bend: z.enum(['x', 'y']).optional(),
    selfWeight: z.boolean().optional(),
    minSafetyFactor: z.number().optional().describe('against yield'),
    maxDeflectionMm: z.number().optional(),
    minSpanOverDeflection: z.number().optional().describe('e.g. 360'),
  }),
  z.object({
    ...common,
    kind: z.literal('frame'),
    frame: FrameDefSchema.describe(
      'a 3D beam-element frame (same definition as the frame_analysis tool): real FEA, run when you call check_specs',
    ),
    maxDisplacementMm: z.number().optional(),
    minSafetyFactor: z.number().optional().describe('worst member, against yield'),
    minBucklingFactor: z.number().optional().describe('lowest Euler load factor, e.g. 3'),
    minFrequencyHz: z.number().optional().describe('lowest natural frequency'),
  }),
  z.object({
    ...common,
    kind: z.literal('solid_fea'),
    body: z.string().describe('a body with a material'),
    supports: z.array(SolidSupportSchema).min(1),
    loads: z.array(SolidLoadSchema).optional(),
    gravity: z.boolean().optional(),
    elementSizeMm: z.number().positive().optional().describe('default: about 12k elements'),
    maxDisplacementMm: z.number().optional(),
    minSafetyFactor: z
      .number()
      .optional()
      .describe('against yield, on the 99th-percentile von Mises stress'),
  }),
  z.object({
    ...common,
    kind: z.literal('thermal'),
    body: z.string().describe('a body with a material that has a thermal conductivity'),
    fixedTemperatures: z
      .array(z.object({ region: RegionSchema, temperatureC: z.number() }))
      .optional(),
    heatInputs: z.array(z.object({ region: RegionSchema, powerW: z.number() })).optional(),
    convections: z
      .array(z.object({ region: RegionSchema, hWm2K: z.number().positive(), ambientC: z.number() }))
      .optional(),
    generationW: z.number().optional(),
    elementSizeMm: z.number().positive().optional(),
    maxTemperatureC: z.number().optional().describe('the hottest point must stay below this'),
    minTemperatureC: z.number().optional().describe('the coldest point must stay above this'),
  }),
]);
export type Spec = z.infer<typeof SpecSchema>;

export const JournalEntrySchema = z.object({
  at: z.string().describe('ISO timestamp'),
  kind: z.enum(['decision', 'note', 'test', 'change', 'idea', 'risk']),
  text: z.string().min(1).max(2000),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

export interface SpecResult {
  id: string;
  kind: Spec['kind'];
  description?: string;
  ok: boolean;
  /** One plain sentence with the numbers. */
  summary: string;
  /** Smallest margin among this spec's limits, in percent of the limit (negative = failing). */
  marginPct?: number;
  /** True when the number is a hand-calculation estimate rather than measured geometry. */
  estimate?: boolean;
  /** True when the number comes from a finite-element analysis. */
  fea?: boolean;
  /** A heavy analysis that was not run (live status): call check_specs to run it. Counts as not passing. */
  pending?: boolean;
}

/** Spec kinds that run a finite-element analysis: seconds, not milliseconds. */
export const HEAVY_KINDS: readonly Spec['kind'][] = ['frame', 'solid_fea', 'thermal'];
export interface EvaluateOptions {
  /** skip heavy analyses and report them as pending (used for the live verdict after every change) */
  live?: boolean;
}

const r = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const EPS = 1e-9;

interface Limit {
  label: string;
  actual: number;
  min?: number;
  max?: number;
  unit: string;
}

/** Evaluate numeric limits: pass when every given bound holds. Margin is relative to the bound. */
function judge(limits: Limit[]): { ok: boolean; summary: string; marginPct?: number } {
  let ok = true;
  let margin: number | undefined;
  const parts: string[] = [];
  for (const l of limits) {
    const bits: string[] = [];
    if (l.max !== undefined) {
      const pass = l.actual <= l.max + EPS;
      ok &&= pass;
      const m = l.max === 0 ? (pass ? 100 : -100) : ((l.max - l.actual) / Math.abs(l.max)) * 100;
      margin = margin === undefined ? m : Math.min(margin, m);
      bits.push(`${pass ? '<=' : 'EXCEEDS'} max ${l.max}`);
    }
    if (l.min !== undefined) {
      const pass = l.actual >= l.min - EPS;
      ok &&= pass;
      const m = l.min === 0 ? (pass ? 100 : -100) : ((l.actual - l.min) / Math.abs(l.min)) * 100;
      margin = margin === undefined ? m : Math.min(margin, m);
      bits.push(`${pass ? '>=' : 'BELOW'} min ${l.min}`);
    }
    parts.push(`${l.label} ${r(l.actual)} ${l.unit} (${bits.join(', ') || 'no limit given'})`);
  }
  return {
    ok,
    summary: parts.join('; '),
    marginPct: margin === undefined ? undefined : r(margin, 1),
  };
}

function body(model: Model, id: string) {
  const b = model.report.bodies[id];
  if (!b) {
    const have = Object.keys(model.report.bodies).join(', ') || '(no bodies)';
    throw new Error(`no body "${id}" (bodies: ${have})`);
  }
  return b;
}

export function evaluateSpec(model: Model, spec: Spec, opts: EvaluateOptions = {}): SpecResult {
  const base = { id: spec.id, kind: spec.kind, description: spec.description };
  if (opts.live && HEAVY_KINDS.includes(spec.kind))
    return {
      ...base,
      ok: false,
      pending: true,
      fea: true,
      summary: 'finite-element analysis not run yet (it takes seconds): call check_specs',
    };
  try {
    switch (spec.kind) {
      case 'frame': {
        const input = buildFrameInput(spec.frame, model.sketches);
        const st = analyzeFrame(input);
        const limits: Limit[] = [];
        if (spec.maxDisplacementMm !== undefined)
          limits.push({
            label: `max displacement (${st.maxDisplacement.node})`,
            actual: st.maxDisplacement.value,
            max: spec.maxDisplacementMm,
            unit: 'mm',
          });
        if (spec.minSafetyFactor !== undefined) {
          const sf = st.worstMember?.safetyFactor;
          if (sf === undefined)
            throw new Error('no yield strength for the members: cannot compute a safety factor');
          limits.push({
            label: `worst member ${st.worstMember?.id} safety factor`,
            actual: sf,
            min: spec.minSafetyFactor,
            unit: '(vs yield)',
          });
        }
        let note = '';
        if (spec.minBucklingFactor !== undefined) {
          const bk = frameBuckling(input, 1);
          if (bk.tensionOnly) note = '; no member in compression, nothing to buckle';
          else
            limits.push({
              label: 'lowest buckling load factor',
              actual: bk.loadFactors[0] ?? Number.POSITIVE_INFINITY,
              min: spec.minBucklingFactor,
              unit: 'x load',
            });
        }
        if (spec.minFrequencyHz !== undefined) {
          const f = frameModes(input, 1).frequencies[0];
          if (f === undefined) throw new Error('no natural frequency found');
          limits.push({
            label: 'lowest natural frequency',
            actual: f,
            min: spec.minFrequencyHz,
            unit: 'Hz',
          });
        }
        if (limits.length === 0 && !note)
          throw new Error(
            'a frame spec needs at least one of maxDisplacementMm, minSafetyFactor, minBucklingFactor, minFrequencyHz',
          );
        const j = limits.length ? judge(limits) : { ok: true, summary: 'no checks apply' };
        return { ...base, ...j, summary: j.summary + note, fea: true };
      }
      case 'thermal': {
        const shape = model.bodies.get(spec.body);
        const info = model.report.bodies[spec.body];
        if (!shape || !info) body(model, spec.body);
        const matName = model.materials.get(spec.body);
        if (!matName) throw new Error(`${spec.body} has no material: add a material step`);
        const mat = getMaterial(matName);
        if (mat.conductivityWmK === undefined)
          throw new Error(`${matName} has no thermal conductivity in the library`);
        if (spec.maxTemperatureC === undefined && spec.minTemperatureC === undefined)
          throw new Error('a thermal spec needs maxTemperatureC and/or minTemperatureC');
        const th = solveThermal({
          shape: shape as NonNullable<typeof shape>,
          conductivity: mat.conductivityWmK,
          elementSize:
            spec.elementSizeMm ??
            defaultSolidElementSize(
              (info as NonNullable<typeof info>).volume,
              (info as NonNullable<typeof info>).bbox.size,
            ),
          fixedTemperatures: spec.fixedTemperatures?.map((x) => ({
            region: x.region as never,
            temperature: x.temperatureC,
          })),
          heatInputs: spec.heatInputs?.map((x) => ({ region: x.region as never, power: x.powerW })),
          convections: spec.convections?.map((x) => ({
            region: x.region as never,
            h: x.hWm2K,
            ambient: x.ambientC,
          })),
          generation: spec.generationW,
        });
        const limits: Limit[] = [];
        if (spec.maxTemperatureC !== undefined)
          limits.push({
            label: 'hottest point',
            actual: th.temperature.max,
            max: spec.maxTemperatureC,
            unit: 'C',
          });
        if (spec.minTemperatureC !== undefined)
          limits.push({
            label: 'coldest point',
            actual: th.temperature.min,
            min: spec.minTemperatureC,
            unit: 'C',
          });
        const j = judge(limits);
        const warn = th.converged
          ? ''
          : '; WARNING: the solver did not converge, result unreliable';
        return {
          ...base,
          ...j,
          summary: `${j.summary} [${th.elements} elements${warn}]`,
          ok: j.ok && th.converged,
          fea: true,
        };
      }
      case 'solid_fea': {
        const shape = model.bodies.get(spec.body);
        const info = model.report.bodies[spec.body];
        if (!shape || !info) body(model, spec.body);
        const matName = model.materials.get(spec.body);
        if (!matName) throw new Error(`${spec.body} has no material: add a material step`);
        const mat = getMaterial(matName);
        if (!mat.youngsModulusGPa) throw new Error(`${matName} has no modulus in the library`);
        const r0 = solidFea({
          shape: shape as NonNullable<typeof shape>,
          E: mat.youngsModulusGPa * 1000,
          yield: mat.yieldMPa,
          density: mat.density,
          elementSize:
            spec.elementSizeMm ??
            defaultSolidElementSize(
              (info as NonNullable<typeof info>).volume,
              (info as NonNullable<typeof info>).bbox.size,
            ),
          supports: spec.supports as never,
          loads: spec.loads as never,
          gravity: spec.gravity,
        });
        const limits: Limit[] = [];
        if (spec.maxDisplacementMm !== undefined)
          limits.push({
            label: 'max displacement',
            actual: r0.maxDisplacement.value,
            max: spec.maxDisplacementMm,
            unit: 'mm',
          });
        if (spec.minSafetyFactor !== undefined) {
          if (r0.safetyFactorP99 === undefined)
            throw new Error('no yield strength: cannot compute a safety factor');
          limits.push({
            label: 'safety factor (p99 stress)',
            actual: r0.safetyFactorP99,
            min: spec.minSafetyFactor,
            unit: '(vs yield)',
          });
        }
        if (limits.length === 0)
          throw new Error('a solid_fea spec needs maxDisplacementMm and/or minSafetyFactor');
        const j = judge(limits);
        const warn = r0.converged
          ? ''
          : '; WARNING: the solver did not converge, result unreliable';
        return {
          ...base,
          ...j,
          summary: `${j.summary} [${r0.elements} elements${warn}]`,
          ok: j.ok && r0.converged,
          fea: true,
        };
      }
      case 'dimension': {
        const b = body(model, spec.body);
        const i = { x: 0, y: 1, z: 2 }[spec.axis];
        const j = judge([
          {
            label: `${spec.body} size ${spec.axis.toUpperCase()}`,
            actual: b.bbox.size[i] ?? 0,
            min: spec.min,
            max: spec.max,
            unit: 'mm',
          },
        ]);
        return { ...base, ...j };
      }
      case 'mass': {
        const b = body(model, spec.body);
        if (b.massG === undefined)
          return {
            ...base,
            ok: false,
            summary: `${spec.body} has no material, so its mass is unknown: add a material step`,
          };
        return {
          ...base,
          ...judge([
            {
              label: `${spec.body} mass`,
              actual: b.massG,
              min: spec.minG,
              max: spec.maxG,
              unit: 'g',
            },
          ]),
        };
      }
      case 'volume': {
        const b = body(model, spec.body);
        return {
          ...base,
          ...judge([
            {
              label: `${spec.body} volume`,
              actual: b.volume,
              min: spec.minMm3,
              max: spec.maxMm3,
              unit: 'mm3',
            },
          ]),
        };
      }
      case 'no_interference':
      case 'min_gap': {
        const sa = model.bodies.get(spec.a);
        const sb = model.bodies.get(spec.b);
        if (!sa) throw new Error(`no body "${spec.a}"`);
        if (!sb) throw new Error(`no body "${spec.b}"`);
        const c = checkInterference(sa, sb, [spec.a, spec.b]);
        if (spec.kind === 'min_gap') {
          const gap = c.status === 'clear' ? c.minDistance : 0;
          return {
            ...base,
            ...judge([
              { label: `gap ${spec.a}-${spec.b}`, actual: gap, min: spec.minMm, unit: 'mm' },
            ]),
          };
        }
        const allow = spec.allowTouching ?? true;
        const ok = c.status === 'clear' || (allow && c.status === 'touching');
        return { ...base, ok, summary: c.summary, marginPct: ok ? undefined : -100 };
      }
      case 'beam': {
        const sk = model.sketches.get(spec.sketch);
        if (!sk) throw new Error(`no sketch "${spec.sketch}"`);
        const s = sectionProperties(sk.drawing);
        const mat = getMaterial(spec.material);
        if (!mat.youngsModulusGPa)
          throw new Error(`${spec.material} has no modulus in the library`);
        const bendX = (spec.bend ?? 'x') === 'x';
        const res = beamWithSelfWeight({
          support: spec.support as BeamSupport,
          load: spec.load,
          value: spec.value,
          length: spec.lengthMm,
          E: mat.youngsModulusGPa * 1000,
          I: bendX ? s.Ix : s.Iy,
          c: bendX
            ? Math.max(s.extent.yMax, s.extent.yMin)
            : Math.max(s.extent.xMax, s.extent.xMin),
          yield: mat.yieldMPa,
          area: s.area,
          density: mat.density,
          selfWeight: spec.selfWeight,
        });
        const limits: Limit[] = [];
        if (spec.minSafetyFactor !== undefined)
          limits.push({
            label: 'safety factor',
            actual: res.safetyFactor ?? 0,
            min: spec.minSafetyFactor,
            unit: '(vs yield)',
          });
        if (spec.maxDeflectionMm !== undefined)
          limits.push({
            label: 'deflection',
            actual: res.deflection,
            max: spec.maxDeflectionMm,
            unit: 'mm',
          });
        if (spec.minSpanOverDeflection !== undefined)
          limits.push({
            label: 'span/deflection',
            actual: res.spanOverDeflection,
            min: spec.minSpanOverDeflection,
            unit: '',
          });
        if (limits.length === 0)
          throw new Error(
            'a beam spec needs at least one of minSafetyFactor, maxDeflectionMm, minSpanOverDeflection',
          );
        return { ...base, ...judge(limits), estimate: true };
      }
    }
  } catch (e) {
    return {
      ...base,
      ok: false,
      summary: `cannot evaluate: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export interface SpecReport {
  /** true only when there is at least one spec and all pass */
  allPass: boolean;
  total: number;
  passing: number;
  /** heavy analyses skipped because this was a live evaluation */
  pending: number;
  results: SpecResult[];
}

export function evaluateSpecs(
  model: Model,
  specs: readonly Spec[],
  opts: EvaluateOptions = {},
): SpecReport {
  const results = specs.map((s) => evaluateSpec(model, s, opts));
  const passing = results.filter((x) => x.ok).length;
  return {
    allPass: results.length > 0 && passing === results.length,
    total: results.length,
    passing,
    pending: results.filter((x) => x.pending).length,
    results,
  };
}

/** A scalar for optimisation: mass (g), volume (mm3) or a bounding-box size (mm) of one body. */
export const METRICS = ['mass', 'volume', 'size_x', 'size_y', 'size_z'] as const;
export type Metric = (typeof METRICS)[number];
export function measureMetric(model: Model, metric: Metric, bodyId: string): number {
  const b = body(model, bodyId);
  switch (metric) {
    case 'mass': {
      if (b.massG !== undefined) return b.massG;
      throw new Error(`${bodyId} has no material, so mass is unknown`);
    }
    case 'volume':
      return b.volume;
    case 'size_x':
      return b.bbox.size[0] ?? 0;
    case 'size_y':
      return b.bbox.size[1] ?? 0;
    case 'size_z':
      return b.bbox.size[2] ?? 0;
  }
}
