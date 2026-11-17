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
  importSTEP,
  makeBox,
  makeCylinder,
  makeSphere,
  type Shape3D,
  type Sketch,
} from 'replicad';
import { evalExpr, exprNames, type Num } from './expr.ts';
import { detectFormat } from './import.ts';
import { initKernel } from './kernel.ts';
import { type BodyInfo, describeBody } from './measure.ts';
import { as3D } from './shapes.ts';
import type { EdgeSelector, FaceSelector, ProfileItem, Step, Timeline } from './timeline.ts';

export interface StepReport {
  id: string;
  op: string;
  status: 'ok' | 'error' | 'skipped' | 'suppressed';
  error?: string;
  ms: number;
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

type Ctx = {
  files?: FileProvider;
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
function itemDrawing(item: ProfileItem, n: Ctx['n']): Drawing {
  const cx = item.shape === 'polygon' ? 0 : n(item.cx ?? 0);
  const cy = item.shape === 'polygon' ? 0 : n(item.cy ?? 0);
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
    case 'polygon': {
      const pts = item.points.map(([x, y]) => [n(x), n(y)] as [number, number]);
      const first = pts[0] as [number, number];
      let pen = draw(first);
      for (const p of pts.slice(1)) pen = pen.lineTo(p);
      return pen.close();
    }
  }
}

function profileDrawing(items: ProfileItem[], n: Ctx['n']): Drawing {
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
  if (!sel.all && !sel.direction && !sel.plane && sel.length === undefined && !sel.box) {
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

// ---- step execution -----------------------------------------------------------------------------
async function runStep(step: Step, ctx: Ctx): Promise<void> {
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
    case 'boolean': {
      const a = get(ctx, step.a);
      const b = get(ctx, step.b);
      const r = step.kind === 'union' ? a.fuse(b) : step.kind === 'cut' ? a.cut(b) : a.intersect(b);
      ctx.bodies.delete(step.a);
      ctx.bodies.delete(step.b);
      ctx.bodies.set(step.id, r);
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

  const ctx: Ctx = {
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
      await runStep(step, ctx);
      reports.push({
        id: step.id,
        op: step.op,
        status: 'ok',
        ms: round(performance.now() - t0, 1),
      });
    } catch (e) {
      failed = true;
      reports.push({
        id: step.id,
        op: step.op,
        status: 'error',
        error: (e as Error).message,
        ms: round(performance.now() - t0, 1),
      });
    }
  }

  const info: Record<string, BodyInfo> = {};
  for (const [id, shape] of bodies) {
    try {
      info[id] = describeBody(shape);
    } catch {
      /* a body we can't measure is still returned as a live shape */
    }
  }
  return { timeline, bodies, report: { ok: !failed, params, steps: reports, bodies: info } };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
