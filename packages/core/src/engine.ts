// Rebuild engine: turns a Timeline into geometry, reporting per-step success so an AI (or a human)
// can see exactly which step failed and why. Steps run in order; after the first failure the rest
// are reported as "skipped" (a feature tree can't meaningfully continue past a broken feature).

import { createHash } from 'node:crypto';
import {
  type Drawing,
  draw,
  drawCircle,
  drawPolysides,
  drawRectangle,
  drawRoundedRectangle,
  EdgeFinder,
  FaceFinder,
  genericSweep,
  importSTEP,
  makeBox,
  makeCylinder,
  makeSphere,
  measureVolume,
  Plane,
  type Shape3D,
  type Sketch,
} from 'replicad';
import { evalExpr, exprNames, type Num } from './expr.ts';
import { holeTool, SCREWS, type ScrewSize, screwDiameter } from './holes.ts';
import { detectFormat } from './import.ts';
import { initKernel } from './kernel.ts';
import { getMaterial, massGrams } from './materials.ts';
import { type BodyInfo, describeBody } from './measure.ts';
import { buildSpine, profileFrame, type V3 } from './path.ts';
import { mirrorPlane, type PatternNumeric, patternCopies, patternPositions } from './pattern.ts';
import { as3D } from './shapes.ts';
import { loopToPath, loopToPolygon, type PathSeg, solveSketch } from './sketch.ts';
import type { EdgeSelector, FaceSelector, ProfileItem, Step, Timeline } from './timeline.ts';

export interface StepReport {
  id: string;
  op: string;
  status: 'ok' | 'error' | 'skipped' | 'suppressed';
  error?: string;
  /** Plain-language remark about a successful step (for example how constrained a sketch is). */
  note?: string;
  /** Structured results (for example solved sketch points). */
  data?: unknown;
  ms: number;
}

interface StepInfo {
  note?: string;
  data?: unknown;
}

export interface BuildReport {
  ok: boolean;
  params: Record<string, number>;
  steps: StepReport[];
  bodies: Record<string, BodyInfo>;
}

export interface Model {
  timeline: Timeline;
  /** Live kernel shapes by body id (not serialisable). */
  bodies: Map<string, Shape3D>;
  /** Material name per body id (bodies without a material are absent). */
  materials: Map<string, string>;
  report: BuildReport;
}

/** Resolve parameters (numbers or expressions) in dependency order; detects cycles. */
export function resolveParams(params: Timeline['params']): Record<string, number> {
  const out: Record<string, number> = {};
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (name: string, path: string[]) => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') {
      throw new Error(`Parameter cycle: ${[...path, name].join(' -> ')}`);
    }
    const raw = params[name];
    if (raw === undefined) throw new Error(`Unknown parameter "${name}"`);
    state.set(name, 'visiting');
    if (typeof raw === 'number') {
      out[name] = raw;
    } else {
      for (const dep of exprNames(raw)) if (dep in params) visit(dep, [...path, name]);
      out[name] = evalExpr(raw, (n) => out[n]);
    }
    state.set(name, 'done');
  };
  for (const name of Object.keys(params)) visit(name, []);
  return out;
}

/** Supplies the bytes of an imported file by plain name (the host decides where files live). */
export type FileProvider = (name: string) => Promise<Uint8Array>;

export interface BuildOptions {
  files?: FileProvider;
}

type PatternSpecInput = Extract<Step, { op: 'hole' }>['pattern'] & object;

type Ctx = {
  files?: FileProvider;
  materials: Map<string, string>;
  n: (v: Num) => number;
  bodies: Map<string, Shape3D>;
  sketches: Map<string, { drawing: Drawing; plane: string; offset: number }>;
};

const get = (ctx: Ctx, id: string, what = 'body'): Shape3D => {
  const s = ctx.bodies.get(id);
  if (!s) {
    const known = [...ctx.bodies.keys()];
    throw new Error(
      `No ${what} "${id}". Existing bodies: ${known.length ? known.join(', ') : '(none yet)'}`,
    );
  }
  return s;
};

// ---- profiles -----------------------------------------------------------------------------------
/** Internal profile item: a closed path of lines and arcs (from a solved constrained sketch). */
interface PathItem {
  shape: 'path';
  start: [number, number];
  segs: PathSeg[];
  cut?: boolean;
}
type DrawItem = ProfileItem | PathItem;

function itemDrawing(item: DrawItem, n: Ctx['n']): Drawing {
  const hasCenter = item.shape !== 'polygon' && item.shape !== 'path';
  const cx = hasCenter ? n(item.cx ?? 0) : 0;
  const cy = hasCenter ? n(item.cy ?? 0) : 0;
  switch (item.shape) {
    case 'rect': {
      const w = n(item.w);
      const h = n(item.h);
      const r = item.cornerRadius === undefined ? 0 : n(item.cornerRadius);
      const d = r > 0 ? drawRoundedRectangle(w, h, r) : drawRectangle(w, h);
      return d.translate(cx, cy);
    }
    case 'circle':
      return drawCircle(n(item.r)).translate(cx, cy);
    case 'ngon':
      return drawPolysides(n(item.r), item.sides).translate(cx, cy);
    case 'path': {
      let pen = draw(item.start);
      for (const sg of item.segs)
        pen = sg.kind === 'line' ? pen.lineTo(sg.to) : pen.threePointsArcTo(sg.to, sg.via);
      return pen.close();
    }
    case 'polygon': {
      const pts = item.points.map(([x, y]) => [n(x), n(y)] as [number, number]);
      const first = pts[0] as [number, number];
      let pen = draw(first);
      for (const p of pts.slice(1)) pen = pen.lineTo(p);
      return pen.close();
    }
  }
}

function profileDrawing(items: DrawItem[], n: Ctx['n']): Drawing {
  let acc: Drawing | undefined;
  for (const it of items.filter((i) => !i.cut)) {
    const d = itemDrawing(it, n);
    acc = acc ? acc.fuse(d) : d;
  }
  if (!acc) throw new Error('A sketch needs at least one non-cut profile item');
  for (const it of items.filter((i) => i.cut)) acc = acc.cut(itemDrawing(it, n));
  return acc;
}

// Orientation-only planes: XY/YX, XZ/ZX and YZ/ZY are parallel to each other.
const STANDARD_PLANE = { XY: 'XY', YX: 'XY', XZ: 'XZ', ZX: 'XZ', YZ: 'YZ', ZY: 'YZ' } as const;

// ---- selectors ----------------------------------------------------------------------------------
function edgeFinder(sel: EdgeSelector, n: Ctx['n']) {
  if (
    !sel.all &&
    !sel.direction &&
    !sel.plane &&
    sel.length === undefined &&
    sel.lengthAtLeast === undefined &&
    sel.lengthAtMost === undefined &&
    !sel.curve &&
    !sel.box
  ) {
    throw new Error('Empty edge selector: set all:true or give direction/plane/length/box');
  }
  return (f: EdgeFinder) => {
    let r = f;
    if (sel.direction) r = r.inDirection(sel.direction);
    if (sel.plane) {
      r =
        sel.plane.offset === undefined
          ? r.inPlane(sel.plane.name)
          : r.inPlane(sel.plane.name, n(sel.plane.offset));
    }
    if (sel.length !== undefined) r = r.ofLength(n(sel.length));
    if (sel.lengthAtLeast !== undefined) {
      const min = n(sel.lengthAtLeast);
      r = r.ofLength((l) => l >= min - 1e-9);
    }
    if (sel.lengthAtMost !== undefined) {
      const max = n(sel.lengthAtMost);
      r = r.ofLength((l) => l <= max + 1e-9);
    }
    if (sel.curve) r = r.ofCurveType(sel.curve === 'line' ? 'LINE' : 'CIRCLE');
    if (sel.box) {
      const lo = sel.box.min.map((v) => n(v));
      const hi = sel.box.max.map((v) => n(v));
      const eps = 1e-6;
      // replicad's inBox() also returns edges that merely touch the box, so we require the
      // edge's whole bounding box to lie inside (predictable for an AI: "entirely inside").
      r = r.when(({ element }) => {
        const [bmin, bmax] = element.boundingBox.bounds as unknown as [number[], number[]];
        return [0, 1, 2].every(
          (k) => (bmin[k] ?? 0) >= (lo[k] ?? 0) - eps && (bmax[k] ?? 0) <= (hi[k] ?? 0) + eps,
        );
      });
    }
    return r;
  };
}

function faceFinder(sel: FaceSelector, n: Ctx['n']) {
  if (!sel.plane && !sel.parallelTo)
    throw new Error('Empty face selector: give plane or parallelTo');
  return (f: FaceFinder) => {
    let r = f;
    if (sel.plane) {
      r =
        sel.plane.offset === undefined
          ? r.inPlane(sel.plane.name)
          : r.inPlane(sel.plane.name, n(sel.plane.offset));
    }
    if (sel.parallelTo) r = r.parallelTo(STANDARD_PLANE[sel.parallelTo]);
    return r;
  };
}

function assertCount(kind: string, found: number, expect: number | undefined) {
  if (expect !== undefined && found !== expect) {
    throw new Error(`${kind} selector matched ${found} but expected ${expect}`);
  }
}

function numericPattern(p: PatternSpecInput, n: Ctx['n']): PatternNumeric {
  if (p.kind === 'linear') {
    return { kind: 'linear', count: p.count, step: [n(p.step[0]), n(p.step[1]), n(p.step[2])] };
  }
  const c = p.center ?? [0, 0, 0];
  return {
    kind: 'circular',
    count: p.count,
    axis: p.axis,
    center: [n(c[0]), n(c[1]), n(c[2])],
    angle: p.angle === undefined ? 360 : n(p.angle),
  };
}

// ---- step execution -----------------------------------------------------------------------------
async function runStep(step: Step, ctx: Ctx): Promise<StepInfo | undefined> {
  const { n } = ctx;
  const vec = (v: [Num, Num, Num] | undefined): [number, number, number] =>
    v ? [n(v[0]), n(v[1]), n(v[2])] : [0, 0, 0];

  switch (step.op) {
    case 'box': {
      const [x, y, z] = vec(step.at);
      const [w, d, h] = [n(step.w), n(step.d), n(step.h)];
      ctx.bodies.set(
        step.id,
        makeBox([x - w / 2, y - d / 2, z - h / 2], [x + w / 2, y + d / 2, z + h / 2]),
      );
      return;
    }
    case 'cylinder': {
      const [x, y, z] = vec(step.at);
      const axis = step.axis ?? 'Z';
      const h = n(step.h);
      // `at` is the centre of the cylinder; build from the base along the axis.
      const dir: [number, number, number] =
        axis === 'X' ? [1, 0, 0] : axis === 'Y' ? [0, 1, 0] : [0, 0, 1];
      const base: [number, number, number] = [
        x - (dir[0] * h) / 2,
        y - (dir[1] * h) / 2,
        z - (dir[2] * h) / 2,
      ];
      ctx.bodies.set(step.id, makeCylinder(n(step.r), h, base, dir));
      return;
    }
    case 'sphere': {
      const [x, y, z] = vec(step.at);
      ctx.bodies.set(step.id, makeSphere(n(step.r)).translate(x, y, z));
      return;
    }
    case 'sketch': {
      ctx.sketches.set(step.id, {
        drawing: profileDrawing(step.profile, n),
        plane: step.plane,
        offset: step.offset === undefined ? 0 : n(step.offset),
      });
      return;
    }
    case 'constrained_sketch': {
      const num = (v: Num | undefined) => (v === undefined ? undefined : n(v));
      const out = await solveSketch({
        points: step.points,
        lines: step.lines ?? {},
        circles: step.circles ?? {},
        arcs: step.arcs ?? {},
        constraints: step.constraints.map((c) => ({
          type: c.type,
          a: c.a,
          b: c.b,
          value: num(c.value),
          at: c.at,
        })),
      });
      const label = (i: number) => {
        const c = step.constraints[i];
        return c
          ? `#${i + 1} ${c.type}(${[c.a, c.b].filter(Boolean).join(', ')}${c.value !== undefined ? `, ${c.value}` : ''})`
          : `#${i + 1}`;
      };
      if (!out.ok) {
        const which = out.conflicting.map(label).join('; ');
        throw new Error(
          out.conflicting.length
            ? `Conflicting constraints: ${which}. They cannot all be true together; remove or change one.`
            : 'The solver could not satisfy the constraints from these starting positions. Move the starting points closer to the intended shape, or relax a constraint.',
        );
      }
      const items: DrawItem[] = step.profile.map((p) => {
        if ('loop' in p && p.loop.some((nm) => step.arcs?.[nm])) {
          const path = loopToPath(p.loop, step.lines ?? {}, step.arcs ?? {}, out.points, out.arcs);
          return { shape: 'path', start: path.start, segs: path.segs, cut: p.cut };
        }
        if ('loop' in p) {
          return {
            shape: 'polygon',
            points: loopToPolygon(p.loop, step.lines ?? {}, out.points),
            cut: p.cut,
          };
        }
        const c = out.circles[p.circle];
        if (!c) throw new Error(`profile uses "${p.circle}", which is not a circle`);
        return { shape: 'circle', r: c.r, cx: c.cx, cy: c.cy, cut: p.cut };
      });
      ctx.sketches.set(step.id, {
        drawing: profileDrawing(items, n),
        plane: step.plane,
        offset: step.offset === undefined ? 0 : n(step.offset),
      });
      const state =
        out.dof === 0
          ? 'fully constrained (0 degrees of freedom)'
          : out.dof > 0
            ? `under-constrained: ${out.dof} degree(s) of freedom left, so some dimensions can still move. Add dimensions or constraints to fix them`
            : 'over-constrained';
      const red = out.redundant.length
        ? `; redundant (already implied, harmless): ${out.redundant.map(label).join('; ')}`
        : '';
      return {
        note: `${state}${red}`,
        data: { dof: out.dof, points: out.points, circles: out.circles },
      };
    }
    case 'extrude': {
      const sk = ctx.sketches.get(step.sketch);
      if (!sk) {
        throw new Error(
          `No sketch "${step.sketch}". Existing sketches: ${[...ctx.sketches.keys()].join(', ') || '(none yet)'}`,
        );
      }
      const dist = n(step.distance);
      const offset = step.symmetric ? sk.offset - dist / 2 : sk.offset;
      const solid = as3D(
        sk.drawing.sketchOnPlane(sk.plane as 'XY', offset).extrude(step.symmetric ? dist : dist),
        'extrude',
      );
      const mode = step.mode ?? 'new';
      if (mode === 'new') {
        ctx.bodies.set(step.id, solid);
      } else {
        if (!step.target) throw new Error(`extrude mode "${mode}" needs a target body`);
        const t = get(ctx, step.target);
        ctx.bodies.set(step.target, mode === 'add' ? t.fuse(solid) : t.cut(solid));
      }
      return;
    }
    case 'revolve': {
      const sk = ctx.sketches.get(step.sketch);
      if (!sk) {
        throw new Error(
          `No sketch "${step.sketch}". Existing sketches: ${[...ctx.sketches.keys()].join(', ') || '(none yet)'}`,
        );
      }
      const angle = step.angle === undefined ? 360 : n(step.angle);
      if (!(angle > 0 && angle <= 360))
        throw new Error('revolve angle must be between 0 and 360 degrees');
      const origin = vec(step.origin);
      const solid = as3D(
        sk.drawing.sketchOnPlane(sk.plane as 'XY', sk.offset).revolve(step.axis, { origin, angle }),
        'revolve',
      );
      const mode = step.mode ?? 'new';
      if (mode === 'new') {
        ctx.bodies.set(step.id, solid);
      } else {
        if (!step.target) throw new Error(`revolve mode "${mode}" needs a target body`);
        const t = get(ctx, step.target);
        ctx.bodies.set(step.target, mode === 'add' ? t.fuse(solid) : t.cut(solid));
      }
      return;
    }
    case 'sweep': {
      const sk = ctx.sketches.get(step.sketch);
      if (!sk) {
        throw new Error(
          `No sketch "${step.sketch}". Existing sketches: ${[...ctx.sketches.keys()].join(', ') || '(none yet)'}`,
        );
      }
      const pts = step.path.points.map((p) => vec(p) as V3);
      const spine = buildSpine(
        pts,
        step.path.bendRadius === undefined ? 0 : n(step.path.bendRadius),
      );
      const cleaned = pts.filter(
        (p, i) =>
          i === 0 ||
          Math.hypot(
            p[0] - (pts[i - 1] as V3)[0],
            p[1] - (pts[i - 1] as V3)[1],
            p[2] - (pts[i - 1] as V3)[2],
          ) > 1e-9,
      );
      const { dir, xDir } = profileFrame(cleaned[0] as V3, cleaned[1] as V3);
      const placed = sk.drawing.sketchOnPlane(new Plane(cleaned[0] as V3, xDir, dir));
      if (!('wire' in placed)) {
        throw new Error(
          'A sweep profile must be a single closed outline without holes. For a hollow pipe, sweep the outer and inner profiles separately and use a boolean cut.',
        );
      }
      const solid = as3D(
        genericSweep((placed as Sketch).wire, spine, { forceProfileSpineOthogonality: true }),
        'sweep',
      );
      const mode = step.mode ?? 'new';
      if (mode === 'new') {
        ctx.bodies.set(step.id, solid);
      } else {
        if (!step.target) throw new Error(`sweep mode "${mode}" needs a target body`);
        const t = get(ctx, step.target);
        ctx.bodies.set(step.target, mode === 'add' ? t.fuse(solid) : t.cut(solid));
      }
      return;
    }
    case 'hole': {
      let t = get(ctx, step.target);
      const size = step.size as ScrewSize | undefined;
      const fit = step.fit ?? 'normal';
      const diameter =
        step.diameter !== undefined
          ? n(step.diameter)
          : size
            ? screwDiameter(size, fit)
            : undefined;
      if (diameter === undefined || !(diameter > 0)) {
        throw new Error('A hole needs a "size" (for example "M4") or an explicit "diameter"');
      }
      const bb = t.boundingBox.bounds as unknown as [number[], number[]];
      const span = Math.hypot(
        (bb[1][0] ?? 0) - (bb[0][0] ?? 0),
        (bb[1][1] ?? 0) - (bb[0][1] ?? 0),
        (bb[1][2] ?? 0) - (bb[0][2] ?? 0),
      );
      const through = step.depth === undefined;
      const depth = through ? span * 2 + 1 : n(step.depth as Num);
      if (!(depth > 0)) throw new Error('hole depth must be greater than 0');
      const major = size ? Number(size.slice(1)) : diameter;
      let counterbore: { diameter: number; depth: number } | undefined;
      if (step.counterbore) {
        const c = step.counterbore === true ? {} : step.counterbore;
        const base = size ? SCREWS[size] : undefined;
        const cd = c.diameter !== undefined ? n(c.diameter) : base ? base.headDia + 0.5 : undefined;
        const cdep = c.depth !== undefined ? n(c.depth) : base ? base.headHeight + 0.3 : undefined;
        if (cd === undefined || cdep === undefined)
          throw new Error('counterbore needs a screw "size" or explicit diameter and depth');
        counterbore = { diameter: cd, depth: cdep };
      }
      let countersink: { diameter: number; angle: number } | undefined;
      if (step.countersink) {
        const c = step.countersink === true ? {} : step.countersink;
        countersink = {
          diameter: c.diameter !== undefined ? n(c.diameter) : major * 2,
          angle: c.angle !== undefined ? n(c.angle) : 90,
        };
      }
      if (counterbore && countersink)
        throw new Error('A hole can have a counterbore or a countersink, not both');
      const raw = step.at as Num[] | Num[][];
      const list = (Array.isArray(raw[0]) ? (raw as Num[][]) : [raw as Num[]]).map(
        (p) => [n(p[0] as Num), n(p[1] as Num), n(p[2] as Num)] as V3,
      );
      const pat = step.pattern ? numericPattern(step.pattern, n) : undefined;
      const positions = pat ? list.flatMap((p) => patternPositions(p, pat)) : list;
      const spec = { diameter, depth, counterbore, countersink };
      // Sanity-check the start points with tiny probe cubes: a hole should start ON the surface.
      const dirName = step.direction ?? '-Z';
      const dv = (
        {
          '+X': [1, 0, 0],
          '-X': [-1, 0, 0],
          '+Y': [0, 1, 0],
          '-Y': [0, -1, 0],
          '+Z': [0, 0, 1],
          '-Z': [0, 0, -1],
        } as Record<string, V3>
      )[dirName] as V3;
      const solidAt = (p: V3) => {
        try {
          const e = 0.01;
          const probe = makeBox([p[0] - e, p[1] - e, p[2] - e], [p[0] + e, p[1] + e, p[2] + e]);
          return measureVolume(probe.intersect(t)) > 1e-9;
        } catch {
          return false;
        }
      };
      const fmt = (p: V3) => p.map((x) => Math.round(x * 100) / 100).join(', ');
      const warnings: string[] = [];
      const insideStart: boolean[] = [];
      positions.slice(0, 6).forEach((p, i) => {
        const ahead = solidAt([p[0] + dv[0] * 0.05, p[1] + dv[1] * 0.05, p[2] + dv[2] * 0.05]);
        const behind = solidAt([p[0] - dv[0] * 0.05, p[1] - dv[1] * 0.05, p[2] - dv[2] * 0.05]);
        insideStart[i] = ahead && behind;
        if (ahead && behind) {
          warnings.push(
            `hole ${i + 1} starts INSIDE the material at (${fmt(p)}): start it on the surface, otherwise a counterbore/countersink and anything above that point are not cut`,
          );
        } else if (!ahead && behind) {
          warnings.push(
            `hole ${i + 1} is on the surface at (${fmt(p)}) but drills away from the part (direction ${dirName} points out of the material), so it cuts nothing: flip the direction`,
          );
        } else if (!ahead && !behind) {
          warnings.push(
            `hole ${i + 1} starts in empty space at (${fmt(p)}), not on the part, so it cuts nothing there: check the position`,
          );
        }
      });
      // the small stick-out above the start point only applies to starts ON the surface
      positions.forEach((p, i) => {
        const inside = insideStart[Math.min(i, insideStart.length - 1)] ?? false;
        t = t.cut(holeTool(spec, p, step.direction ?? '-Z', inside ? 0 : 0.5));
      });
      ctx.bodies.set(step.target, t);
      const kind = counterbore
        ? `counterbore \u00d8${counterbore.diameter} x ${counterbore.depth} deep`
        : countersink
          ? `countersink \u00d8${countersink.diameter} at ${countersink.angle} degrees`
          : 'plain';
      const label = size
        ? `${size} ${fit === 'tap' ? 'tap drill (cosmetic thread)' : fit + ' clearance'}`
        : 'custom diameter';
      return {
        note: `${warnings.length ? `WARNING: ${warnings.join('; ')}. ` : ''}${positions.length} hole(s) \u00d8${diameter} (${label}), ${kind}, ${through ? 'through' : `${depth} deep`}`,
      };
    }
    case 'pattern': {
      const t = get(ctx, step.target);
      const tool = get(ctx, step.tool);
      const copies = patternCopies(tool, numericPattern(step.pattern, n));
      let r = t;
      for (const c of copies) r = step.mode === 'cut' ? r.cut(c) : r.fuse(c);
      ctx.bodies.delete(step.tool);
      ctx.materials.delete(step.tool);
      ctx.bodies.set(step.target, r);
      return {
        note: `${copies.length} instances ${step.mode === 'cut' ? 'cut from' : 'fused to'} "${step.target}"`,
      };
    }
    case 'mirror': {
      const t = get(ctx, step.target);
      const { plane, origin } = mirrorPlane(
        step.axis,
        step.offset === undefined ? 0 : n(step.offset),
      );
      const image = as3D(t.clone().mirror(plane, origin), 'mirror');
      if ((step.mode ?? 'add') === 'new') {
        ctx.bodies.set(step.id, image);
        const m = ctx.materials.get(step.target);
        if (m) ctx.materials.set(step.id, m);
      } else ctx.bodies.set(step.target, t.fuse(image));
      return;
    }
    case 'loft': {
      const placed = step.sketches.map((id) => {
        const sk = ctx.sketches.get(id);
        if (!sk) {
          throw new Error(
            `No sketch "${id}". Existing sketches: ${[...ctx.sketches.keys()].join(', ') || '(none yet)'}`,
          );
        }
        return sk;
      });
      // replicad consumes the sketches it lofts, so build fresh ones from the stored drawings.
      const [first, ...rest] = placed.map((sk) =>
        sk.drawing.sketchOnPlane(sk.plane as 'XY', sk.offset),
      );
      if (!first) throw new Error('loft needs at least two sketches');
      const solid = as3D(
        (first as Sketch).loftWith(rest as Sketch[], { ruled: step.ruled ?? false }),
        'loft',
      );
      const mode = step.mode ?? 'new';
      if (mode === 'new') {
        ctx.bodies.set(step.id, solid);
      } else {
        if (!step.target) throw new Error(`loft mode "${mode}" needs a target body`);
        const t = get(ctx, step.target);
        ctx.bodies.set(step.target, mode === 'add' ? t.fuse(solid) : t.cut(solid));
      }
      return;
    }
    case 'fillet': {
      const t = get(ctx, step.target);
      const sel = step.edges;
      const f = sel.all ? undefined : edgeFinder(sel, n);
      const found = (f ? f(new EdgeFinder()) : new EdgeFinder()).find(t).length;
      assertCount('Edge', found, sel.expect);
      if (found === 0) throw new Error('Edge selector matched no edges');
      ctx.bodies.set(step.target, f ? t.fillet(n(step.radius), f) : t.fillet(n(step.radius)));
      return;
    }
    case 'chamfer': {
      const t = get(ctx, step.target);
      const sel = step.edges;
      const f = sel.all ? undefined : edgeFinder(sel, n);
      const found = (f ? f(new EdgeFinder()) : new EdgeFinder()).find(t).length;
      assertCount('Edge', found, sel.expect);
      if (found === 0) throw new Error('Edge selector matched no edges');
      ctx.bodies.set(step.target, f ? t.chamfer(n(step.distance), f) : t.chamfer(n(step.distance)));
      return;
    }
    case 'shell': {
      const t = get(ctx, step.target);
      const f = faceFinder(step.faces, n);
      const found = f(new FaceFinder()).find(t).length;
      assertCount('Face', found, step.faces.expect);
      if (found === 0) throw new Error('Face selector matched no faces');
      ctx.bodies.set(step.target, t.shell(n(step.thickness), f));
      return;
    }
    case 'material': {
      get(ctx, step.target);
      const m = getMaterial(step.name);
      ctx.materials.set(step.target, m.name);
      return { note: `${step.target} is ${m.label} (${m.density} g/cm3)` };
    }
    case 'boolean': {
      const a = get(ctx, step.a);
      const b = get(ctx, step.b);
      const r = step.kind === 'union' ? a.fuse(b) : step.kind === 'cut' ? a.cut(b) : a.intersect(b);
      const inherited = ctx.materials.get(step.a) ?? ctx.materials.get(step.b);
      ctx.bodies.delete(step.a);
      ctx.bodies.delete(step.b);
      ctx.materials.delete(step.a);
      ctx.materials.delete(step.b);
      ctx.bodies.set(step.id, r);
      if (inherited) ctx.materials.set(step.id, inherited);
      return;
    }
    case 'import': {
      if (!ctx.files) throw new Error('This build has no file access, so imports are unavailable');
      const bytes = await ctx.files(step.file);
      if (step.sha256) {
        const h = createHash('sha256').update(bytes).digest('hex');
        if (h !== step.sha256) {
          throw new Error(
            `"${step.file}" has changed since this step was added (checksum mismatch). Remove and re-import it to accept the new version.`,
          );
        }
      }
      const fmt = detectFormat(step.file, bytes);
      if (fmt.format !== 'step' || fmt.support !== 'supported') {
        throw new Error(`Cannot import "${step.file}" (${fmt.name}). ${fmt.howTo}`);
      }
      let shape = as3D(await importSTEP(new Blob([bytes as BlobPart])), `import of ${step.file}`);
      if (step.scale !== undefined) {
        const k = n(step.scale);
        if (!(k > 0)) throw new Error('import scale must be greater than 0');
        shape = shape.scale(k);
      }
      if (step.at) {
        const [x, y, z] = vec(step.at);
        shape = shape.translate(x, y, z);
      }
      ctx.bodies.set(step.id, shape);
      return;
    }
    case 'transform': {
      let t = get(ctx, step.target);
      if (step.rotate) {
        const o = vec(step.rotate.origin);
        const axis = step.rotate.axis;
        const dir: [number, number, number] =
          axis === 'X' ? [1, 0, 0] : axis === 'Y' ? [0, 1, 0] : [0, 0, 1];
        t = t.rotate(n(step.rotate.angle), o, dir); // degrees
      }
      if (step.translate) {
        const [x, y, z] = vec(step.translate);
        t = t.translate(x, y, z);
      }
      ctx.bodies.set(step.target, t);
      return;
    }
  }
}

/**
 * A readable message for any failure. The geometry kernel throws raw exception objects with NO message for
 * invalid operations (for example a fillet that is too big, or chamfering a seam edge), which would otherwise
 * reach the AI as a bare "error".
 */
function describeFailure(e: unknown, op: string): string {
  const msg = e instanceof Error ? e.message : '';
  if (msg) return msg;
  const hint: Record<string, string> = {
    fillet:
      'the radius is probably too large for the faces, or the edges include seam/tangent edges (try a smaller radius, or select with lengthAtLeast / curve / box)',
    chamfer:
      'the distance is probably too large, or the edges include seam/tangent edges (try a smaller distance, or select with lengthAtLeast / curve / box)',
    shell:
      'the wall thickness is probably too large for the shape, or the removed face selection is wrong',
    boolean: 'the two bodies may not overlap, or one is not a valid solid',
    sweep: 'the profile may not fit the path (try a bigger bend radius or a smaller profile)',
    loft: 'the sections may be too different, or not on separate planes/offsets',
  };
  return `The geometry kernel could not complete this ${op} step and gave no detail. ${hint[op] ? `Likely cause: ${hint[op]}.` : 'Check the inputs and try a simpler variant.'}`;
}

/** Build a timeline into geometry. Never throws for model errors: they appear in `report`. */
export async function buildModel(timeline: Timeline, opts: BuildOptions = {}): Promise<Model> {
  await initKernel();
  const bodies = new Map<string, Shape3D>();
  const reports: StepReport[] = [];
  let params: Record<string, number> = {};
  let failed = false;

  try {
    params = resolveParams(timeline.params);
  } catch (e) {
    failed = true;
    reports.push({
      id: '(params)',
      op: 'params',
      status: 'error',
      error: (e as Error).message,
      ms: 0,
    });
  }

  const materials = new Map<string, string>();
  const ctx: Ctx = {
    materials,
    n: (v) => (typeof v === 'number' ? v : evalExpr(v, (name) => params[name])),
    bodies,
    sketches: new Map(),
    files: opts.files,
  };

  for (const step of timeline.steps) {
    if (step.suppressed) {
      reports.push({ id: step.id, op: step.op, status: 'suppressed', ms: 0 });
      continue;
    }
    if (failed) {
      reports.push({ id: step.id, op: step.op, status: 'skipped', ms: 0 });
      continue;
    }
    const t0 = performance.now();
    try {
      const info = await runStep(step, ctx);
      reports.push({
        id: step.id,
        op: step.op,
        status: 'ok',
        ...(info?.note ? { note: info.note } : {}),
        ...(info?.data ? { data: info.data } : {}),
        ms: round(performance.now() - t0, 1),
      });
    } catch (e) {
      failed = true;
      reports.push({
        id: step.id,
        op: step.op,
        status: 'error',
        error: describeFailure(e, step.op),
        ms: round(performance.now() - t0, 1),
      });
    }
  }

  const info: Record<string, BodyInfo> = {};
  for (const [id, shape] of bodies) {
    try {
      const body = describeBody(shape);
      const mat = materials.get(id);
      if (mat) {
        body.material = mat;
        body.massG = massGrams(body.volume, getMaterial(mat).density);
      }
      info[id] = body;
    } catch {
      /* a body we can't measure is still returned as a live shape */
    }
  }
  return {
    timeline,
    bodies,
    materials,
    report: { ok: !failed, params, steps: reports, bodies: info },
  };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
