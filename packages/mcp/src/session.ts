// A Session is the live design: one ModelBuilder (the timeline) plus its latest build.
// Every mutation rebuilds immediately so the AI gets verified numbers back, and notifies listeners
// (the browser viewer) so people can watch the model change as it is built.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type BuildReport,
  buildModel,
  isSafeFileName,
  type Model,
  ModelBuilder,
  meshBodies,
  type ViewerMesh,
} from '@contrapt/core';

export interface Snapshot {
  version: number;
  name: string;
  report: BuildReport;
  meshes: ViewerMesh[];
  timeline: ReturnType<ModelBuilder['toJSON']>;
}

export interface SessionOptions {
  /** Folder holding files for `import` steps. Imports are unavailable when omitted. */
  importsDir?: string;
}

export class Session {
  builder: ModelBuilder;
  model?: Model;
  meshes: ViewerMesh[] = [];
  version = 0;
  private listeners = new Set<() => void>();
  /** Serialises rebuilds so rapid tool calls can't interleave. */
  private queue: Promise<unknown> = Promise.resolve();

  private readonly importsDir?: string;

  constructor(name = 'untitled', opts: SessionOptions = {}) {
    this.builder = new ModelBuilder(name);
    this.importsDir = opts.importsDir;
  }

  private readonly files = async (name: string): Promise<Uint8Array> => {
    if (!this.importsDir) throw new Error('Imports are not enabled for this session');
    if (!isSafeFileName(name)) throw new Error(`"${name}" is not a plain file name`);
    try {
      return new Uint8Array(await readFile(join(this.importsDir, name)));
    } catch {
      throw new Error(`Cannot read "${name}" from the imports folder (is it still there?)`);
    }
  };

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  reset(name = 'untitled'): Promise<Model> {
    this.builder = new ModelBuilder(name);
    return this.rebuild();
  }

  replaceTimeline(json: unknown): Promise<Model> {
    this.builder = ModelBuilder.fromJSON(json);
    return this.rebuild();
  }

  /** Rebuild geometry from the current timeline and tell listeners. */
  rebuild(): Promise<Model> {
    const run = this.queue.then(async () => {
      const model = await buildModel(this.builder.toJSON(), {
        files: this.importsDir ? this.files : undefined,
      });
      this.model = model;
      try {
        this.meshes = model.report.ok || model.bodies.size > 0 ? meshBodies(model) : [];
      } catch {
        this.meshes = [];
      }
      this.version++;
      for (const l of this.listeners) l();
      return model;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  snapshot(): Snapshot {
    const tl = this.builder.toJSON();
    return {
      version: this.version,
      name: tl.name,
      report: this.model?.report ?? { ok: true, params: {}, steps: [], bodies: {} },
      meshes: this.meshes,
      timeline: tl,
    };
  }
}
