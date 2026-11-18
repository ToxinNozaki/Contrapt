// One-parameter design optimisation against the model's specs: sweep a parameter, keep the best value whose rebuilt
// geometry passes every spec, then bisect toward the boundary between feasible and infeasible. Honest limits: it
// assumes a single dominant trade-off (the feasible region is an interval around the best sample); it is a search over
// real rebuilds, not a gradient method.
import { buildModel, type FileProvider } from './engine.ts';
import { evaluateSpecs, type Metric, measureMetric, type Spec } from './specs.ts';
import type { Timeline } from './timeline.ts';

export interface OptimizeInput {
  param: string;
  min: number;
  max: number;
  metric: Metric;
  body: string;
  goal: 'minimize' | 'maximize';
  /** samples in the first sweep (default 13, 3..60) */
  samples?: number;
  /** bisection steps toward the feasibility boundary (default 10) */
  refine?: number;
}

export interface Trial {
  value: number;
  /** the build succeeded */
  built: boolean;
  /** every spec passes (requires at least one spec) */
  feasible: boolean;
  objective?: number;
  failing: string[];
}

export interface OptimizeResult {
  best?: { value: number; objective: number };
  trials: Trial[];
  /** why nothing was found, or caveats */
  message: string;
}

export async function optimizeParam(
  timeline: Timeline,
  specs: readonly Spec[],
  inp: OptimizeInput,
  files?: FileProvider,
): Promise<OptimizeResult> {
  if (!(inp.max > inp.min)) throw new Error('max must be greater than min');
  if (specs.length === 0)
    throw new Error(
      'Add at least one spec first: the optimiser needs requirements to satisfy (add_spec)',
    );
  if (!(inp.param in timeline.params))
    throw new Error(
      `Unknown parameter "${inp.param}". Parameters: ${Object.keys(timeline.params).join(', ') || '(none)'}`,
    );
  const n = Math.max(3, Math.min(60, Math.round(inp.samples ?? 13)));
  const sign = inp.goal === 'minimize' ? 1 : -1; // lower "cost" is better
  const trials: Trial[] = [];

  const run = async (value: number): Promise<Trial> => {
    const tl: Timeline = structuredClone(timeline);
    tl.params[inp.param] = value;
    const model = await buildModel(tl, { files });
    const t: Trial = { value, built: model.report.ok, feasible: false, failing: [] };
    if (!model.report.ok) {
      t.failing.push('build failed');
    } else {
      const rep = evaluateSpecs(model, specs);
      t.failing = rep.results.filter((x) => !x.ok).map((x) => x.id);
      t.feasible = rep.allPass;
      try {
        t.objective = measureMetric(model, inp.metric, inp.body);
      } catch (e) {
        t.feasible = false;
        t.failing.push(e instanceof Error ? e.message : String(e));
      }
    }
    trials.push(t);
    return t;
  };

  const sweep: Trial[] = [];
  for (let i = 0; i < n; i++) sweep.push(await run(inp.min + ((inp.max - inp.min) * i) / (n - 1)));

  const cost = (t: Trial) => sign * (t.objective ?? Number.POSITIVE_INFINITY);
  const feasible = sweep.filter((t) => t.feasible);
  if (feasible.length === 0) {
    const built = sweep.filter((t) => t.built);
    const least = [...built].sort((a, b) => a.failing.length - b.failing.length)[0];
    return {
      trials,
      message: `No sampled value of ${inp.param} in [${inp.min}, ${inp.max}] satisfies every spec. Fewest failures at ${least ? `${inp.param}=${least.value} (failing: ${least.failing.join(', ')})` : 'none (no build succeeded)'}. Widen the range, relax a spec, or change something other than ${inp.param}.`,
    };
  }
  let best = feasible.reduce((a, b) => (cost(b) < cost(a) ? b : a));

  // Refine toward the boundary on the side where the objective keeps improving: bisect between the best feasible
  // sample and its adjacent infeasible sample (if any).
  const idx = sweep.indexOf(best);
  const neighbours = [sweep[idx - 1], sweep[idx + 1]].filter((t): t is Trial => !!t && !t.feasible);
  const toward = neighbours.sort((a, b) => cost(a) - cost(b))[0];
  if (toward) {
    let good = best.value;
    let bad = toward.value;
    for (let k = 0; k < (inp.refine ?? 10); k++) {
      const mid = (good + bad) / 2;
      const t = await run(mid);
      if (t.feasible) {
        good = mid;
        if (cost(t) < cost(best)) best = t;
      } else bad = mid;
    }
  }
  trials.sort((a, b) => a.value - b.value);
  const edge = best.value === inp.min || best.value === inp.max;
  return {
    best: { value: best.value, objective: best.objective ?? 0 },
    trials,
    message: `Best ${inp.goal} of ${inp.metric}(${inp.body}) with every spec passing: ${inp.param} = ${Math.round(best.value * 1e6) / 1e6} (${inp.metric} ${Math.round((best.objective ?? 0) * 1e4) / 1e4}).${edge ? ` The best value sits at the edge of the searched range, so a wider range might do better.` : ''} Beam specs are hand-calculation estimates, so verify before building.`,
  };
}
