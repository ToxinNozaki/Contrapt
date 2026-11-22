// Planar mechanism kinematics: rigid links between pinned points, one driven crank, sliders constrained to a line.
// Poses come from the same 2D constraint solver the sketches use (planegcs), solved step by step from the previous pose
// so the assembly keeps its branch. Plus an analytic four-bar classifier (Grashof) with transmission-angle limits.
// Kinematics only: no masses, forces or friction.
import { solveSketch } from './sketch.ts';

type P2 = [number, number];
const DEG = Math.PI / 180;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface MechanismInput {
  /** every pin, with its position in a valid assembly pose (mm) */
  points: Record<string, P2>;
  /** pins fixed to the frame */
  grounds: string[];
  /** rigid links between two pins (length defaults to their initial distance) */
  links: { a: string; b: string; length?: number }[];
  /** pins forced to stay on a horizontal (y = const) or vertical (x = const) line: sliders */
  sliders?: { point: string; axis: 'x' | 'y' }[];
  /** the driven crank: its pivot (a ground) and the tip pin that circles it */
  crank: { pivot: string; tip: string; fromDeg: number; toDeg: number };
  steps?: number;
  /** pins whose position is recorded */
  track?: string[];
  /** absolute angle of the direction a -> b, degrees */
  angles?: { name: string; a: string; b: string }[];
  /** the angle at pin q between q->p and q->r, degrees 0..180 (a transmission angle, for example) */
  joints?: { name: string; p: string; q: string; r: string }[];
}

export interface MechanismPose {
  deg: number;
  ok: boolean;
  tracked?: Record<string, P2>;
  angles?: Record<string, number>;
  joints?: Record<string, number>;
}

export interface MechanismResult {
  poses: MechanismPose[];
  feasible: number;
  /** crank angles (degrees) where the mechanism could not be assembled */
  infeasibleFromDeg?: number;
  ranges: Record<string, { min: number; max: number }>;
  /** x/y extents of each tracked point over the feasible poses */
  extents: Record<string, { minX: number; maxX: number; minY: number; maxY: number }>;
  warnings: string[];
}

const angleOf = (p: P2, q: P2) => Math.atan2(q[1] - p[1], q[0] - p[0]) / DEG;
const dist = (p: P2, q: P2) => Math.hypot(p[0] - q[0], p[1] - q[1]);

function jointAngle(p: P2, q: P2, r: P2) {
  const a = [p[0] - q[0], p[1] - q[1]];
  const b = [r[0] - q[0], r[1] - q[1]];
  const dot = (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number);
  const n = Math.hypot(a[0] as number, a[1] as number) * Math.hypot(b[0] as number, b[1] as number);
  return Math.acos(Math.max(-1, Math.min(1, dot / n))) / DEG;
}

export async function sweepMechanism(inp: MechanismInput): Promise<MechanismResult> {
  const names = Object.keys(inp.points);
  const must = (n: string, what: string) => {
    if (!inp.points[n]) throw new Error(`${what}: unknown pin "${n}". Pins: ${names.join(', ')}`);
  };
  for (const g of inp.grounds) must(g, 'ground');
  for (const l of inp.links) {
    must(l.a, 'link');
    must(l.b, 'link');
  }
  for (const s of inp.sliders ?? []) must(s.point, 'slider');
  must(inp.crank.pivot, 'crank pivot');
  must(inp.crank.tip, 'crank tip');
  if (!inp.grounds.includes(inp.crank.pivot))
    throw new Error('The crank pivot must be one of the grounds');
  if (inp.grounds.includes(inp.crank.tip)) throw new Error('The crank tip cannot be a ground');
  for (const t of inp.track ?? []) must(t, 'track');
  for (const a of inp.angles ?? []) {
    must(a.a, 'angle');
    must(a.b, 'angle');
  }
  for (const jn of inp.joints ?? []) {
    must(jn.p, 'joint');
    must(jn.q, 'joint');
    must(jn.r, 'joint');
  }
  const steps = Math.max(1, Math.min(720, Math.round(inp.steps ?? 72)));
  const pivot = inp.points[inp.crank.pivot] as P2;
  const radius = dist(pivot, inp.points[inp.crank.tip] as P2);
  if (!(radius > 1e-9)) throw new Error('The crank tip must not coincide with its pivot');

  const lengths = inp.links.map(
    (l) => l.length ?? dist(inp.points[l.a] as P2, inp.points[l.b] as P2),
  );
  lengths.forEach((L, i) => {
    if (!(L > 1e-9)) throw new Error(`Link ${inp.links[i]?.a}-${inp.links[i]?.b} has zero length`);
  });

  let guess: Record<string, P2> = JSON.parse(JSON.stringify(inp.points));
  const poses: MechanismPose[] = [];
  const warnings: string[] = [];
  let infeasibleFrom: number | undefined;
  let prev: Record<string, P2> | undefined;
  const minLink = Math.min(...lengths, radius);

  for (let i = 0; i <= steps; i++) {
    const deg = inp.crank.fromDeg + ((inp.crank.toDeg - inp.crank.fromDeg) * i) / steps;
    const tip: P2 = [
      pivot[0] + radius * Math.cos(deg * DEG),
      pivot[1] + radius * Math.sin(deg * DEG),
    ];
    const constraints = [
      ...inp.grounds.map((g) => ({ type: 'fix' as const, a: g, at: inp.points[g] as P2 })),
      { type: 'fix' as const, a: inp.crank.tip, at: tip },
      ...inp.links.map((l, k) => ({
        type: 'distance' as const,
        a: l.a,
        b: l.b,
        value: lengths[k] as number,
      })),
      ...(inp.sliders ?? []).map((s) => ({
        type: (s.axis === 'y' ? 'y' : 'x') as 'x' | 'y',
        a: s.point,
        value: (inp.points[s.point] as P2)[s.axis === 'y' ? 1 : 0],
      })),
    ];
    const start = { ...guess, [inp.crank.tip]: tip };
    let solved: Record<string, P2> | undefined;
    try {
      const out = await solveSketch({ points: start, lines: {}, circles: {}, constraints });
      if (out.ok && out.conflicting.length === 0) {
        // verify every link really has its length (guards against a solver that settled for a compromise)
        const bad = inp.links.some(
          (l, k) =>
            Math.abs(dist(out.points[l.a] as P2, out.points[l.b] as P2) - (lengths[k] as number)) >
            1e-3 * (lengths[k] as number),
        );
        if (!bad) solved = out.points;
      }
    } catch {
      solved = undefined;
    }
    if (!solved) {
      poses.push({ deg: r4(deg), ok: false });
      if (infeasibleFrom === undefined) infeasibleFrom = r4(deg);
      continue;
    }
    if (prev) {
      let jump = 0;
      for (const n of names) jump = Math.max(jump, dist(solved[n] as P2, prev[n] as P2));
      if (jump > 0.6 * minLink && !warnings.some((w) => w.startsWith('Possible branch flip')))
        warnings.push(
          `Possible branch flip near crank angle ${r2(deg)} degrees: a pin jumped ${r2(jump)} mm in one step (the linkage may pass a dead-centre or toggle position). Use more steps to look closer.`,
        );
    }
    prev = solved;
    guess = solved;
    const pose: MechanismPose = { deg: r4(deg), ok: true };
    if (inp.track?.length)
      pose.tracked = Object.fromEntries(
        inp.track.map((t) => [t, [r4((solved[t] as P2)[0]), r4((solved[t] as P2)[1])] as P2]),
      );
    if (inp.angles?.length)
      pose.angles = Object.fromEntries(
        inp.angles.map((a) => [a.name, r2(angleOf(solved[a.a] as P2, solved[a.b] as P2))]),
      );
    if (inp.joints?.length)
      pose.joints = Object.fromEntries(
        inp.joints.map((jn) => [
          jn.name,
          r2(jointAngle(solved[jn.p] as P2, solved[jn.q] as P2, solved[jn.r] as P2)),
        ]),
      );
    poses.push(pose);
  }

  const ok = poses.filter((p) => p.ok);
  if (poses[0] && !poses[0].ok)
    throw new Error(
      'The starting pose cannot be assembled: check that the pin positions are close to a valid assembly and the link lengths are consistent',
    );
  const ranges: MechanismResult['ranges'] = {};
  const note = (k: string, v: number) => {
    const r = ranges[k];
    if (!r) ranges[k] = { min: v, max: v };
    else {
      r.min = Math.min(r.min, v);
      r.max = Math.max(r.max, v);
    }
  };
  const extents: MechanismResult['extents'] = {};
  for (const p of ok) {
    for (const [k, v] of Object.entries(p.angles ?? {})) note(k, v);
    for (const [k, v] of Object.entries(p.joints ?? {})) note(k, v);
    for (const [k, v] of Object.entries(p.tracked ?? {})) {
      const e = extents[k];
      if (!e) extents[k] = { minX: v[0], maxX: v[0], minY: v[1], maxY: v[1] };
      else {
        e.minX = Math.min(e.minX, v[0]);
        e.maxX = Math.max(e.maxX, v[0]);
        e.minY = Math.min(e.minY, v[1]);
        e.maxY = Math.max(e.maxY, v[1]);
      }
    }
  }
  if (infeasibleFrom !== undefined)
    warnings.push(
      `The mechanism locks or cannot be assembled from crank angle ${infeasibleFrom} degrees on (${ok.length} of ${poses.length} poses feasible).`,
    );
  return {
    poses,
    feasible: ok.length,
    infeasibleFromDeg: infeasibleFrom,
    ranges,
    extents,
    warnings,
  };
}

// ---- four-bar classification ---------------------------------------------------------------------------------------

export interface FourBarResult {
  /** Grashof: shortest + longest <= the other two (some link can turn through a full revolution) */
  grashof: boolean;
  type:
    | 'crank-rocker'
    | 'double-crank (drag link)'
    | 'double-rocker (Grashof, coupler turns fully)'
    | 'rocker-crank (Grashof, the OUTPUT turns fully, the input only rocks)'
    | 'triple-rocker (non-Grashof)'
    | 'change point (special case)';
  crankTurnsFully: boolean;
  /** rocker angle limits relative to the ground line, degrees (when the crank can sweep) */
  rockerRangeDeg?: { min: number; max: number; swing: number };
  /** transmission angle (coupler-rocker), degrees, over the feasible crank positions */
  transmissionDeg?: { min: number; max: number };
  quality: string;
  notes: string[];
}

/**
 * Four-bar with ground length g between the crank pivot O2 and the rocker pivot O4, crank c, coupler k, rocker r.
 * Angles are measured from the ground line O2->O4; positive rotation toward +y.
 */
export function fourBarCheck(g: number, c: number, k: number, r: number): FourBarResult {
  for (const [n, v] of [
    ['ground', g],
    ['crank', c],
    ['coupler', k],
    ['rocker', r],
  ] as const)
    if (!(v > 0)) throw new Error(`${n} length must be positive`);
  const links = [g, c, k, r];
  const s = Math.min(...links);
  const l = Math.max(...links);
  const others = links.reduce((a, b) => a + b, 0) - s - l;
  const eps = 1e-9 * (g + c + k + r);
  const grashof = s + l <= others + eps;
  const change = Math.abs(s + l - others) < eps;
  const notes: string[] = [];
  let type: FourBarResult['type'];
  if (!grashof) type = 'triple-rocker (non-Grashof)';
  else if (change) type = 'change point (special case)';
  else if (s === c) type = 'crank-rocker';
  else if (s === g) type = 'double-crank (drag link)';
  else if (s === k) type = 'double-rocker (Grashof, coupler turns fully)';
  else type = 'rocker-crank (Grashof, the OUTPUT turns fully, the input only rocks)';
  // the input crank makes full turns only when it is the shortest link (crank-rocker) or the ground is (drag link)
  const crankTurnsFully = grashof && !change && (s === c || s === g);
  if (change)
    notes.push(
      'Change-point linkage (shortest + longest = the other two): it can fold flat and flip branches; avoid for real mechanisms.',
    );

  const poses: { mu: number; rocker: number }[] = [];
  const N = 720;
  for (let i = 0; i < N; i++) {
    const th = (2 * Math.PI * i) / N;
    // crank pin B = c(cos th, sin th); rocker pivot O4 = (g, 0); coupler k from B to C, rocker r from O4 to C
    const bx = c * Math.cos(th);
    const by = c * Math.sin(th);
    const dx = g - bx;
    const dy = -by;
    const d = Math.hypot(dx, dy);
    if (d > k + r || d < Math.abs(k - r) || d === 0) continue; // cannot close
    const a = (k * k - r * r + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, k * k - a * a));
    // two assemblies; take the "open" one (C above the line B-O4 side with positive cross) to stay on one branch
    const mx = bx + (a * dx) / d;
    const my = by + (a * dy) / d;
    const cx = mx + (h * dy) / d;
    const cy = my - (h * dx) / d;
    const rockerAng = Math.atan2(cy - 0, cx - g) / DEG;
    const cosMu = (k * k + r * r - d * d) / (2 * k * r);
    const mu = Math.acos(Math.max(-1, Math.min(1, cosMu))) / DEG;
    poses.push({ mu, rocker: rockerAng });
  }
  const res: FourBarResult = { grashof, type, crankTurnsFully, quality: '', notes };
  if (poses.length > 0) {
    // the rocker angle wraps at +-180: unwrap relative to the first feasible pose
    const base = (poses[0] as { rocker: number }).rocker;
    const un = poses.map((p) => {
      let a = p.rocker - base;
      while (a > 180) a -= 360;
      while (a < -180) a += 360;
      return a + base;
    });
    const mn = Math.min(...un);
    const mx = Math.max(...un);
    res.rockerRangeDeg = { min: r2(mn), max: r2(mx), swing: r2(mx - mn) };
    const mus = poses.map((p) => p.mu);
    res.transmissionDeg = { min: r2(Math.min(...mus)), max: r2(Math.max(...mus)) };
    const worst = Math.min(res.transmissionDeg.min, 180 - res.transmissionDeg.max);
    res.quality =
      worst >= 40
        ? 'Transmission angle stays within 40-140 degrees: good force transfer through the whole cycle.'
        : worst >= 25
          ? 'Transmission angle dips below 40 degrees (or above 140): marginal; expect high bearing loads and possible binding near those poses.'
          : 'Transmission angle gets very small or very large: the linkage can jam near those poses. Change the link lengths.';
  } else res.quality = 'The loop never closes for any crank angle: check the lengths.';
  if (!grashof)
    notes.push(
      'Non-Grashof: no link can turn fully; the crank only rocks between limit positions.',
    );
  if (type === 'crank-rocker')
    notes.push('The crank turns fully; the rocker oscillates (the usual wiper/drive linkage).');
  if (type === 'double-crank (drag link)')
    notes.push(
      'Both the crank and the rocker turn fully (drag link), with a non-uniform output speed.',
    );
  notes.push(
    'Closed-form position analysis of the ideal planar linkage: no joint clearance, flex or friction.',
  );
  return res;
}
