// ModelBuilder: the tool-call API. Each call validates one step and appends it to the timeline.
// The MCP server wraps this; scripts (see script.ts) drive the very same builder, so both ways of
// describing a model produce identical timelines.
import {
  emptyTimeline,
  formatZodError,
  type Step,
  StepInput,
  type StepOp,
  type Timeline,
  TimelineSchema,
} from './timeline.ts';

export const STEP_OPS: StepOp[] = [
  'import',
  'box',
  'cylinder',
  'sphere',
  'sketch',
  'constrained_sketch',
  'extrude',
  'revolve',
  'loft',
  'sweep',
  'fillet',
  'chamfer',
  'shell',
  'boolean',
  'transform',
];

export class ModelBuilder {
  private tl: Timeline;

  constructor(name = 'untitled') {
    this.tl = emptyTimeline(name);
  }

  static fromJSON(json: unknown): ModelBuilder {
    const parsed = TimelineSchema.safeParse(json);
    if (!parsed.success) throw new Error(`Invalid timeline: ${formatZodError(parsed.error)}`);
    const b = new ModelBuilder(parsed.data.name);
    b.tl = structuredClone(parsed.data);
    return b;
  }

  /** A validated deep copy of the timeline. */
  toJSON(): Timeline {
    return structuredClone(this.tl);
  }

  get steps(): readonly Step[] {
    return this.tl.steps;
  }

  /** Define or change a named parameter (number or expression such as "width/2"). */
  param(name: string, value: number | string): this {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Bad parameter name "${name}"`);
    this.tl.params[name] = value;
    return this;
  }

  /** Validate and append a step. Returns its id (generated if omitted). */
  add(input: unknown): string {
    const parsed = StepInput.safeParse(input);
    if (!parsed.success) throw new Error(`Invalid step: ${formatZodError(parsed.error)}`);
    const step = parsed.data;
    const id = step.id ?? this.nextId(step.op);
    if (this.tl.steps.some((s) => s.id === id)) throw new Error(`Step id "${id}" already exists`);
    this.checkReferences(step);
    this.tl.steps.push({ ...step, id } as Step);
    return id;
  }

  /** Suppress/unsuppress a step without deleting it. */
  suppress(id: string, suppressed = true): this {
    const s = this.tl.steps.find((x) => x.id === id);
    if (!s) throw new Error(`No step "${id}"`);
    s.suppressed = suppressed;
    return this;
  }

  /** Remove a step. Later steps that depend on it will report errors on rebuild. */
  remove(id: string): this {
    const i = this.tl.steps.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`No step "${id}"`);
    this.tl.steps.splice(i, 1);
    return this;
  }

  private nextId(op: string): string {
    let i = this.tl.steps.filter((s) => s.op === op).length + 1;
    while (this.tl.steps.some((s) => s.id === `${op}${i}`)) i++;
    return `${op}${i}`;
  }

  /** Early, friendly reference checks (the engine re-checks at build time). */
  private checkReferences(step: StepInput_): void {
    const sketches = new Set(
      this.tl.steps
        .filter((s) => s.op === 'sketch' || s.op === 'constrained_sketch')
        .map((s) => s.id),
    );
    const bodies = this.bodyIds();
    const need = (id: string | undefined, set: Set<string>, kind: string) => {
      if (id !== undefined && !set.has(id)) {
        throw new Error(
          `Unknown ${kind} "${id}". Known ${kind}s: ${[...set].join(', ') || '(none yet)'}`,
        );
      }
    };
    switch (step.op) {
      case 'loft':
        for (const id of step.sketches) need(id, sketches, 'sketch');
        need(step.target, bodies, 'body');
        break;
      case 'extrude':
      case 'revolve':
      case 'sweep':
        need(step.sketch, sketches, 'sketch');
        need(step.target, bodies, 'body');
        break;
      case 'fillet':
      case 'chamfer':
      case 'shell':
      case 'transform':
        need(step.target, bodies, 'body');
        break;
      case 'boolean':
        need(step.a, bodies, 'body');
        need(step.b, bodies, 'body');
        break;
      default:
    }
  }

  /** Ids of bodies that exist after the steps added so far. */
  bodyIds(): Set<string> {
    const ids = new Set<string>();
    for (const s of this.tl.steps) {
      if (s.suppressed) continue;
      if (s.op === 'box' || s.op === 'cylinder' || s.op === 'sphere' || s.op === 'import')
        ids.add(s.id);
      else if (
        (s.op === 'extrude' || s.op === 'revolve' || s.op === 'loft' || s.op === 'sweep') &&
        (s.mode ?? 'new') === 'new'
      )
        ids.add(s.id);
      else if (s.op === 'boolean') {
        ids.delete(s.a);
        ids.delete(s.b);
        ids.add(s.id);
      }
    }
    return ids;
  }
}

type StepInput_ = ReturnType<typeof StepInput.parse>;
