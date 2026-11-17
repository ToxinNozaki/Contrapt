// Script mode: compile a short script into a timeline (the same one tool calls would produce).
//
//   param('w', 40);
//   const s = sketch({ plane: 'XY', profile: [{ shape: 'rect', w: 'w', h: 20 }] });
//   extrude({ sketch: s, distance: 10 });
//
// SECURITY NOTE: this runs in a `node:vm` context with code-generation disabled, a hard timeout, and
// no host objects exposed (only a JSON-string bridge, with errors re-thrown inside the sandbox
// realm). That blocks the usual accidental and prompt-injection mistakes, but `node:vm` is NOT a
// security boundary against a determined attacker. Treat scripts as trusted-ish; stronger isolation
// (worker + permission model) is tracked in docs/FEATURES.md.
import vm from 'node:vm';
import { ModelBuilder, STEP_OPS } from './builder.ts';
import type { Timeline } from './timeline.ts';

export interface ScriptOptions {
  name?: string;
  /** Wall-clock limit for the script body, in ms. */
  timeoutMs?: number;
}

const PRELUDE = `(function (call) {
  const g = globalThis;
  const wrap = (op) => (args) => call(op, JSON.stringify(args === undefined ? {} : args));
  for (const op of ${JSON.stringify(STEP_OPS)}) g[op === 'import' ? 'importFile' : op] = wrap(op); // import is reserved JavaScript syntax
  g.param = (name, value) => call('param', JSON.stringify({ name, value }));
})`;

export function compileScript(source: string, opts: ScriptOptions = {}): Timeline {
  const builder = new ModelBuilder(opts.name ?? 'script');

  const bridge = (op: string, json: string): string => {
    try {
      const args = JSON.parse(json) as Record<string, unknown>;
      if (op === 'param') {
        builder.param(String(args.name), args.value as number | string);
        return String(args.name);
      }
      return builder.add({ op, ...args });
    } catch (e) {
      // Throw a plain string: an Error object from the host realm would expose host constructors.
      throw `${(e as Error).message}`;
    }
  };

  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });

  // Wrap the bridge inside the sandbox realm so sandbox code never holds a host function object.
  const install = vm.runInContext(PRELUDE, context, { timeout: 1000 }) as (f: unknown) => void;
  const safeCall = vm.runInContext(
    `(function (f) { return function (op, json) {
       try { return f(op, json); } catch (e) { throw new Error(String(e)); }
     }; })`,
    context,
    { timeout: 1000 },
  ) as (f: typeof bridge) => unknown;
  install(safeCall(bridge));

  try {
    vm.runInContext(source, context, {
      timeout: opts.timeoutMs ?? 2000,
      filename: 'model-script.js',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Script failed: ${msg}`);
  }
  return builder.toJSON();
}
