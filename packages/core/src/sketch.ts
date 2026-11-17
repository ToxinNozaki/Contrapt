// Constrained 2D sketches: a thin, friendly layer over FreeCAD's planegcs solver (WebAssembly, ~0.5 MB).
//
// The AI describes a sketch with NAMED points (rough starting positions), lines and circles built from
// them, and constraints that refer to those names ("A-B horizontal", "distance A to B is 40"). The solver
// moves the points until the constraints hold. We report how many degrees of freedom are left (0 = fully
// defined), and name any conflicting or redundant constraints, so the AI can fix its own sketch.
import { GcsWrapper, init_planegcs_module } from '@salusoft89/planegcs';

export type ConstraintType =
  | 'fix'
  | 'x'
  | 'y'
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'distance'
  | 'parallel'
  | 'perpendicular'
  | 'equalLength'
  | 'angle'
  | 'radius'
  | 'diameter'
  | 'equalRadius'
  | 'onLine'
  | 'onCircle'
  | 'tangent';

export const CONSTRAINT_TYPES: [ConstraintType, ...ConstraintType[]] = [
  'fix',
  'x',
  'y',
  'coincident',
  'horizontal',
  'vertical',
  'distance',
  'parallel',
  'perpendicular',
  'equalLength',
  'angle',
  'radius',
  'diameter',
  'equalRadius',
  'onLine',
  'onCircle',
  'tangent',
];

/** A constraint with all numbers already evaluated. */
export interface NumericConstraint {
  type: ConstraintType;
  a: string;
  b?: string;
  value?: number;
  at?: [number, number];
}

export interface ArcGeometry {
  cx: number;
  cy: number;
  r: number;
  start: [number, number];
  end: [number, number];
  /** A point halfway along the arc (used to draw it). */
  mid: [number, number];
}

export interface SolveInput {
  points: Record<string, [number, number]>;
  lines: Record<string, [string, string]>;
  circles: Record<string, { center: string; r: number }>;
  /** Counter-clockwise arcs from `start` to `end` around `center` (all three are named points). */
  arcs?: Record<string, { center: string; start: string; end: string }>;
  constraints: NumericConstraint[];
}

export interface SolveOutput {
  points: Record<string, [number, number]>;
  circles: Record<string, { cx: number; cy: number; r: number }>;
  arcs: Record<string, ArcGeometry>;
  /** Remaining degrees of freedom: 0 = fully defined, >0 = under-constrained, <0 = over-constrained. */
  dof: number;
  /** Indices (into the input constraints) that contradict each other. */
  conflicting: number[];
  /** Indices of constraints that add nothing (already implied). */
  redundant: number[];
  ok: boolean;
}

let modPromise: ReturnType<typeof init_planegcs_module> | undefined;
const solverLog: string[] = [];

/**
 * planegcs prints progress ("Solving with DogLeg", redundancy reports) with direct console.log calls compiled into
 * its WebAssembly glue, NOT through Emscripten's print hook. An MCP stdio server must never write to stdout, so
 * the console is swapped for a capturing sink while the (fully synchronous) solve runs.
 */
function silenceConsole(): () => void {
  const saved = { log: console.log, info: console.info, debug: console.debug, warn: console.warn };
  const sink = (...args: unknown[]) => {
    solverLog.push(args.map(String).join(' '));
  };
  console.log = sink;
  console.info = sink;
  console.debug = sink;
  console.warn = sink;
  return () => {
    console.log = saved.log;
    console.info = saved.info;
    console.debug = saved.debug;
    console.warn = saved.warn;
  };
}

function getModule() {
  modPromise ??= init_planegcs_module({
    print: (t: string) => solverLog.push(t),
    printErr: (t: string) => solverLog.push(t),
  } as never);
  return modPromise;
}

export function solverDiagnostics(): string[] {
  return solverLog.slice();
}

const rad = (d: number) => (d * Math.PI) / 180;
const round = (x: number) => Math.round(x * 1e6) / 1e6;

export async function solveSketch(input: SolveInput): Promise<SolveOutput> {
  const names = new Set<string>();
  const kind = new Map<string, 'point' | 'line' | 'circle' | 'arc'>();
  const declare = (name: string, k: 'point' | 'line' | 'circle' | 'arc') => {
    if (names.has(name))
      throw new Error(
        `The name "${name}" is used twice. Points, lines and circles need unique names.`,
      );
    names.add(name);
    kind.set(name, k);
  };
  for (const n of Object.keys(input.points)) declare(n, 'point');
  for (const n of Object.keys(input.lines)) declare(n, 'line');
  for (const n of Object.keys(input.circles)) declare(n, 'circle');
  for (const n of Object.keys(input.arcs ?? {})) declare(n, 'arc');

  const need = (
    name: string | undefined,
    k: 'point' | 'line' | 'circle' | 'arc',
    ctx: string,
  ): string => {
    if (!name) throw new Error(`${ctx} is missing a name`);
    const got = kind.get(name);
    if (!got)
      throw new Error(
        `${ctx}: "${name}" is not defined. Defined: ${[...names].join(', ') || '(nothing)'}`,
      );
    if (got !== k) throw new Error(`${ctx}: "${name}" is a ${got}, expected a ${k}`);
    return name;
  };
  const P = (n: string) => `P_${n}`;
  const L = (n: string) => `L_${n}`;
  const C = (n: string) => `C_${n}`;
  const A = (n: string) => `A_${n}`;

  // geometry first (planegcs requires referenced points to come first)
  const prims: Record<string, unknown>[] = [];
  for (const [n, [x, y]] of Object.entries(input.points))
    prims.push({ id: P(n), type: 'point', x, y, fixed: false });
  for (const [n, [p1, p2]] of Object.entries(input.lines)) {
    need(p1, 'point', `line ${n}`);
    need(p2, 'point', `line ${n}`);
    prims.push({ id: L(n), type: 'line', p1_id: P(p1), p2_id: P(p2) });
  }
  for (const [n, c] of Object.entries(input.circles)) {
    need(c.center, 'point', `circle ${n}`);
    prims.push({ id: C(n), type: 'circle', c_id: P(c.center), radius: c.r });
  }

  for (const [n, a] of Object.entries(input.arcs ?? {})) {
    const c = input.points[need(a.center, 'point', `arc ${n}`)] as [number, number];
    const s = input.points[need(a.start, 'point', `arc ${n}`)] as [number, number];
    const e = input.points[need(a.end, 'point', `arc ${n}`)] as [number, number];
    const startAngle = Math.atan2(s[1] - c[1], s[0] - c[0]);
    let endAngle = Math.atan2(e[1] - c[1], e[0] - c[0]);
    while (endAngle <= startAngle) endAngle += 2 * Math.PI;
    prims.push({
      id: A(n),
      type: 'arc',
      c_id: P(a.center),
      radius: Math.hypot(s[0] - c[0], s[1] - c[1]) || 1,
      start_angle: startAngle,
      end_angle: endAngle,
      start_id: P(a.start),
      end_id: P(a.end),
    });
    prims.push({ id: `AR_${n}`, type: 'arc_rules', a_id: A(n) });
  }

  // constraints; remember which planegcs ids belong to which input index
  const owner = new Map<string, number>();
  const push = (i: number, c: Record<string, unknown>) => {
    const id = `K${prims.length}`;
    owner.set(id, i);
    prims.push({ id, ...c });
  };
  input.constraints.forEach((c, i) => {
    const ctx = `constraint #${i + 1} (${c.type})`;
    const val = () => {
      if (c.value === undefined || !Number.isFinite(c.value))
        throw new Error(`${ctx} needs a numeric "value"`);
      return c.value;
    };
    switch (c.type) {
      case 'fix': {
        const p = need(c.a, 'point', ctx);
        const [x, y] = c.at ?? (input.points[p] as [number, number]);
        push(i, { type: 'coordinate_x', p_id: P(p), x });
        push(i, { type: 'coordinate_y', p_id: P(p), y });
        break;
      }
      case 'x':
        push(i, { type: 'coordinate_x', p_id: P(need(c.a, 'point', ctx)), x: val() });
        break;
      case 'y':
        push(i, { type: 'coordinate_y', p_id: P(need(c.a, 'point', ctx)), y: val() });
        break;
      case 'coincident':
        push(i, {
          type: 'p2p_coincident',
          p1_id: P(need(c.a, 'point', ctx)),
          p2_id: P(need(c.b, 'point', ctx)),
        });
        break;
      case 'horizontal':
      case 'vertical': {
        const h = c.type === 'horizontal';
        if (kind.get(c.a) === 'line')
          push(i, { type: h ? 'horizontal_l' : 'vertical_l', l_id: L(c.a) });
        else
          push(i, {
            type: h ? 'horizontal_pp' : 'vertical_pp',
            p1_id: P(need(c.a, 'point', ctx)),
            p2_id: P(need(c.b, 'point', ctx)),
          });
        break;
      }
      case 'distance':
        push(i, {
          type: 'p2p_distance',
          p1_id: P(need(c.a, 'point', ctx)),
          p2_id: P(need(c.b, 'point', ctx)),
          distance: val(),
        });
        break;
      case 'parallel':
        push(i, {
          type: 'parallel',
          l1_id: L(need(c.a, 'line', ctx)),
          l2_id: L(need(c.b, 'line', ctx)),
        });
        break;
      case 'perpendicular':
        push(i, {
          type: 'perpendicular_ll',
          l1_id: L(need(c.a, 'line', ctx)),
          l2_id: L(need(c.b, 'line', ctx)),
        });
        break;
      case 'equalLength':
        push(i, {
          type: 'equal_length',
          l1_id: L(need(c.a, 'line', ctx)),
          l2_id: L(need(c.b, 'line', ctx)),
        });
        break;
      case 'angle':
        push(i, {
          type: 'l2l_angle_ll',
          l1_id: L(need(c.a, 'line', ctx)),
          l2_id: L(need(c.b, 'line', ctx)),
          angle: rad(val()),
        });
        break;
      case 'radius':
        if (kind.get(c.a) === 'arc') push(i, { type: 'arc_radius', a_id: A(c.a), radius: val() });
        else push(i, { type: 'circle_radius', c_id: C(need(c.a, 'circle', ctx)), radius: val() });
        break;
      case 'diameter':
        if (kind.get(c.a) === 'arc')
          push(i, { type: 'arc_diameter', a_id: A(c.a), diameter: val() });
        else
          push(i, { type: 'circle_diameter', c_id: C(need(c.a, 'circle', ctx)), diameter: val() });
        break;
      case 'equalRadius':
        push(i, {
          type: 'equal_radius_cc',
          c1_id: C(need(c.a, 'circle', ctx)),
          c2_id: C(need(c.b, 'circle', ctx)),
        });
        break;
      case 'onLine':
        push(i, {
          type: 'point_on_line_pl',
          p_id: P(need(c.a, 'point', ctx)),
          l_id: L(need(c.b, 'line', ctx)),
        });
        break;
      case 'onCircle':
        if (kind.get(c.b ?? '') === 'arc') {
          push(i, {
            type: 'point_on_arc',
            p_id: P(need(c.a, 'point', ctx)),
            a_id: A(need(c.b, 'arc', ctx)),
          });
        } else {
          push(i, {
            type: 'point_on_circle',
            p_id: P(need(c.a, 'point', ctx)),
            c_id: C(need(c.b, 'circle', ctx)),
          });
        }
        break;
      case 'tangent': {
        const ka = kind.get(c.a);
        const kb = kind.get(c.b ?? '');
        if (ka === 'line' && kb === 'arc')
          push(i, { type: 'tangent_la', l_id: L(c.a), a_id: A(c.b as string) });
        else if (ka === 'arc' && kb === 'line')
          push(i, { type: 'tangent_la', l_id: L(c.b as string), a_id: A(c.a) });
        else if (ka === 'arc' && kb === 'arc')
          push(i, { type: 'tangent_aa', a1_id: A(c.a), a2_id: A(c.b as string) });
        else if (ka === 'circle' && kb === 'arc')
          push(i, { type: 'tangent_ca', c_id: C(c.a), a_id: A(c.b as string) });
        else if (ka === 'arc' && kb === 'circle')
          push(i, { type: 'tangent_ca', c_id: C(c.b as string), a_id: A(c.a) });
        else if (ka === 'line')
          push(i, { type: 'tangent_lc', l_id: L(c.a), c_id: C(need(c.b, 'circle', ctx)) });
        else
          push(i, {
            type: 'tangent_cc',
            c1_id: C(need(c.a, 'circle', ctx)),
            c2_id: C(need(c.b, 'circle', ctx)),
          });
        break;
      }
    }
  });

  const mod = await getModule();
  const restoreConsole = silenceConsole();
  const w = new GcsWrapper(new mod.GcsSystem());
  try {
    w.push_primitives_and_params(prims as never);
    const status = w.solve() as number;
    w.apply_solution();
    const dof = w.gcs.dof();
    const toIdx = (ids: string[]) =>
      [...new Set(ids.map((id) => owner.get(id)).filter((x): x is number => x !== undefined))].sort(
        (a, b) => a - b,
      );
    const conflicting = toIdx(w.get_gcs_conflicting_constraints());
    const redundant = toIdx(w.get_gcs_redundant_constraints());

    const solved = w.sketch_index.get_primitives() as {
      id: string;
      type: string;
      x?: number;
      y?: number;
    }[];
    const points: Record<string, [number, number]> = {};
    for (const p of solved) {
      if (p.type === 'point' && p.id.startsWith('P_'))
        points[p.id.slice(2)] = [round(p.x as number), round(p.y as number)];
    }
    const circles: SolveOutput['circles'] = {};
    for (const [n, c] of Object.entries(input.circles)) {
      const prim = solved.find((p) => p.id === C(n)) as unknown as { radius: number } | undefined;
      const [cx, cy] = points[c.center] as [number, number];
      circles[n] = { cx, cy, r: round(prim?.radius ?? c.r) };
    }
    const arcs: SolveOutput['arcs'] = {};
    for (const [n, a] of Object.entries(input.arcs ?? {})) {
      const [cx, cy] = points[a.center] as [number, number];
      const s = points[a.start] as [number, number];
      const e = points[a.end] as [number, number];
      const r = Math.hypot(s[0] - cx, s[1] - cy);
      const sa = Math.atan2(s[1] - cy, s[0] - cx);
      let sweep = Math.atan2(e[1] - cy, e[0] - cx) - sa;
      while (sweep <= 1e-9) sweep += 2 * Math.PI;
      const ma = sa + sweep / 2;
      arcs[n] = {
        cx,
        cy,
        r: round(r),
        start: s,
        end: e,
        mid: [round(cx + r * Math.cos(ma)), round(cy + r * Math.sin(ma))],
      };
    }
    return {
      points,
      circles,
      arcs,
      dof,
      conflicting,
      redundant,
      ok: (status === 0 || status === 1) && conflicting.length === 0,
    };
  } finally {
    w.destroy_gcs_module();
    restoreConsole();
  }
}

/** Order the lines of a closed loop into a polygon (list of points), checking that it really closes. */
export function loopToPolygon(
  loop: string[],
  lines: Record<string, [string, string]>,
  points: Record<string, [number, number]>,
): [number, number][] {
  const first = loop[0] as string;
  const seg = (n: string) => {
    const l = lines[n];
    if (!l)
      throw new Error(
        `Loop uses "${n}", which is not a line. Lines: ${Object.keys(lines).join(', ') || '(none)'}`,
      );
    return l;
  };
  const [a0, b0] = seg(first);
  const order = [a0];
  let end = b0;
  for (const name of loop.slice(1)) {
    const [p, q] = seg(name);
    order.push(end);
    if (p === end) end = q;
    else if (q === end) end = p;
    else
      throw new Error(
        `Loop is not connected: line "${name}" does not touch the end of the previous line (point "${end}").`,
      );
  }
  if (end !== a0)
    throw new Error(`Loop does not close: it ends at "${end}" but started at "${a0}".`);
  return order.map((n) => {
    const p = points[n];
    if (!p) throw new Error(`Unknown point "${n}"`);
    return p;
  });
}

export type PathSeg =
  | { kind: 'line'; to: [number, number] }
  | { kind: 'arc'; to: [number, number]; via: [number, number] };

/** Order a closed loop of lines AND arcs into a drawable path, checking that it connects and closes. */
export function loopToPath(
  loop: string[],
  lines: Record<string, [string, string]>,
  arcs: Record<string, { center: string; start: string; end: string }>,
  points: Record<string, [number, number]>,
  arcGeometry: Record<string, ArcGeometry>,
): { start: [number, number]; segs: PathSeg[] } {
  const ends = (name: string): [string, string] => {
    const l = lines[name];
    if (l) return l;
    const a = arcs[name];
    if (a) return [a.start, a.end];
    throw new Error(
      `Loop uses "${name}", which is neither a line nor an arc. Lines: ${Object.keys(lines).join(', ') || '(none)'}; arcs: ${Object.keys(arcs).join(', ') || '(none)'}`,
    );
  };
  const pt = (n: string): [number, number] => {
    const p = points[n];
    if (!p) throw new Error(`Unknown point "${n}"`);
    return p;
  };
  const [a0, b0] = ends(loop[0] as string);
  const segs: PathSeg[] = [];
  const add = (name: string, to: string) => {
    const g = arcGeometry[name];
    segs.push(g ? { kind: 'arc', to: pt(to), via: g.mid } : { kind: 'line', to: pt(to) });
  };
  add(loop[0] as string, b0);
  let end = b0;
  for (const name of loop.slice(1)) {
    const [p, q] = ends(name);
    if (p === end) {
      add(name, q);
      end = q;
    } else if (q === end) {
      add(name, p);
      end = p;
    } else {
      throw new Error(
        `Loop is not connected: "${name}" does not touch the end of the previous segment (point "${end}").`,
      );
    }
  }
  if (end !== a0)
    throw new Error(`Loop does not close: it ends at "${end}" but started at "${a0}".`);
  return { start: pt(a0), segs };
}
