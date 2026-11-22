// FEA-backed requirements in the Proof Loop: frame and solid_fea specs, live (pending) versus full evaluation, and the
// optimiser driving a real finite-element check.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildModel,
  evaluateSpec,
  evaluateSpecs,
  initKernel,
  ModelBuilder,
  optimizeParam,
  type Spec,
} from '../src/index.ts';

type Step = Parameters<ModelBuilder['add']>[0];

/** 6061 cantilever arm along X, 20 wide x t deep (sketch 'sec'), 100 long, as a frame of four members. */
function arm(t = 6): ModelBuilder {
  const b = new ModelBuilder('arm').param('t', t);
  b.add({
    op: 'sketch',
    id: 'sec',
    plane: 'XY',
    profile: [{ shape: 'rect', w: 20, h: 't' }],
  } as Step);
  b.add({ op: 'extrude', id: 'arm', sketch: 'sec', distance: 100 });
  b.add({ op: 'material', target: 'arm', name: '6061-T6' });
  return b;
}
const build = async (b: ModelBuilder) => {
  await initKernel();
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  return m;
};

const FRAME: Extract<Spec, { kind: 'frame' }>['frame'] = {
  nodes: { n0: [0, 0, 0], n1: [25, 0, 0], n2: [50, 0, 0], n3: [75, 0, 0], n4: [100, 0, 0] },
  members: [0, 1, 2, 3].map((i) => ({
    id: `m${i}`,
    a: `n${i}`,
    b: `n${i + 1}`,
    material: '6061-T6' as const,
    section: { sketch: 'sec' },
  })),
  supports: [{ node: 'n0', fix: 'fixed' }],
  loads: [{ node: 'n4', force: [0, 0, -50] }],
};
const frameSpec = (extra: Partial<Extract<Spec, { kind: 'frame' }>>): Spec =>
  ({ id: 'tip', kind: 'frame', frame: FRAME, ...extra }) as Spec;

test('a frame spec runs beam-element FEA on the model sketch section: deflection, safety factor and frequency', async () => {
  const m = await build(arm(6));
  // 20 x 6: I = 360 mm4. delta = 50 x 100^3 / (3 x 69000 x 360) = 0.671 mm; sigma = 50 x 100 x 3 / 360 = 41.7 MPa
  const ok = evaluateSpec(
    m,
    frameSpec({ maxDisplacementMm: 1, minSafetyFactor: 4, minFrequencyHz: 50 }),
  );
  assert.equal(ok.ok, true, ok.summary);
  assert.equal(ok.fea, true);
  assert.match(ok.summary, /max displacement \(n4\) 0\.67/);
  assert.match(ok.summary, /safety factor 6\.6/);
  const bad = evaluateSpec(m, frameSpec({ maxDisplacementMm: 0.5 }));
  assert.equal(bad.ok, false);
  assert.match(bad.summary, /EXCEEDS max 0\.5/);
  assert.ok((bad.marginPct ?? 0) < 0);
  // bending only: no member in compression, so the buckling check is reported as not applicable
  const bk = evaluateSpec(m, frameSpec({ minBucklingFactor: 3, maxDisplacementMm: 5 }));
  assert.equal(bk.ok, true);
  assert.match(bk.summary, /nothing to buckle/);
  // a spec with no checks, or a broken frame, says why instead of passing silently
  assert.match(evaluateSpec(m, frameSpec({})).summary, /needs at least one of/);
  const broken = evaluateSpec(m, {
    ...frameSpec({ maxDisplacementMm: 1 }),
    frame: { ...FRAME, supports: [{ node: 'zz', fix: 'fixed' }] },
  } as Spec);
  assert.equal(broken.ok, false);
  assert.match(broken.summary, /cannot evaluate/);
});

test('a compressed strut fails its buckling-factor spec by the Euler margin', async () => {
  const m = await build(arm(6));
  const n = 8;
  const L = 200;
  const nodes: Record<string, [number, number, number]> = {};
  for (let i = 0; i <= n; i++) nodes[`s${i}`] = [(L * i) / n, 0, 0];
  const members = Array.from({ length: n }, (_, i) => ({
    id: `b${i}`,
    a: `s${i}`,
    b: `s${i + 1}`,
    material: '6061-T6' as const,
    section: { shape: 'round' as const, d: 8 },
  }));
  const strut = (min: number): Spec => ({
    id: 'strut',
    kind: 'frame',
    minBucklingFactor: min,
    frame: {
      nodes,
      members,
      supports: [
        { node: 's0', fix: ['ux', 'uy', 'uz', 'rx'] },
        { node: `s${n}`, fix: ['uy', 'uz', 'rx'] },
      ],
      loads: [{ node: `s${n}`, force: [-100, 0, 0] }],
    },
  });
  // Euler: pi^2 E I / L^2 = 9.87 x 69000 x 201.06 / 40000 = 3423 N => factor 34.2 on a 100 N load
  const pass = evaluateSpec(m, strut(30));
  assert.equal(pass.ok, true, pass.summary);
  assert.match(pass.summary, /buckling load factor 34\./);
  assert.equal(evaluateSpec(m, strut(40)).ok, false);
});

test('live evaluation skips heavy analyses as pending (not passing), and the full evaluation runs them', async () => {
  const m = await build(arm(6));
  const specs: Spec[] = [
    { id: 'mass', kind: 'mass', body: 'arm', maxG: 50 },
    frameSpec({ maxDisplacementMm: 1 }),
  ];
  const live = evaluateSpecs(m, specs, { live: true });
  assert.equal(live.pending, 1);
  assert.equal(live.passing, 1);
  assert.equal(live.allPass, false);
  assert.equal(live.results[1]?.pending, true);
  assert.match(live.results[1]?.summary ?? '', /call check_specs/);
  const full = evaluateSpecs(m, specs);
  assert.equal(full.pending, 0);
  assert.equal(full.allPass, true, JSON.stringify(full.results));
});

test('a solid_fea spec meshes the model body with its material: bar deflection and safety factor', async () => {
  const b = new ModelBuilder('bar');
  b.add({ op: 'box', id: 'bar', w: 60, d: 6, h: 6, at: [30, 0, 0] });
  b.add({ op: 'material', target: 'bar', name: '6061-T6' });
  const m = await build(b);
  // 60 N at the tip of a 60 x 6 x 6 aluminium bar: beam theory 60 x 60^3 / (3 x 69000 x 108) = 0.58 mm, root stress 100 MPa
  const spec = (extra: Partial<Extract<Spec, { kind: 'solid_fea' }>>): Spec =>
    ({
      id: 'bar-load',
      kind: 'solid_fea',
      body: 'bar',
      elementSizeMm: 1.5,
      supports: [{ region: { face: { normal: '-X' } } }],
      loads: [{ region: { face: { normal: '+X' } }, force: [0, 0, -60] }],
      ...extra,
    }) as Spec;
  const ok = evaluateSpec(m, spec({ maxDisplacementMm: 1, minSafetyFactor: 1.2 }));
  assert.equal(ok.ok, true, ok.summary);
  assert.equal(ok.fea, true);
  assert.match(ok.summary, /\[640 elements\]/);
  const bad = evaluateSpec(m, spec({ maxDisplacementMm: 0.4 }));
  assert.equal(bad.ok, false);
  assert.match(bad.summary, /EXCEEDS max 0\.4/);
  const weak = evaluateSpec(m, spec({ minSafetyFactor: 10 }));
  assert.equal(weak.ok, false);
  assert.match(weak.summary, /BELOW min 10/);
  const nomat = new ModelBuilder('nomat');
  nomat.add({ op: 'box', id: 'bar', w: 60, d: 6, h: 6, at: [30, 0, 0] });
  const r = evaluateSpec(await build(nomat), spec({ maxDisplacementMm: 1 }));
  assert.equal(r.ok, false);
  assert.match(r.summary, /no material: add a material step/);
  assert.match(
    evaluateSpec(m, spec({})).summary,
    /needs maxDisplacementMm and\/or minSafetyFactor/,
  );
});

test('the optimiser drives a real FEA requirement: the thinnest arm whose frame deflects under 2 mm', async () => {
  const b = arm(10);
  b.addSpec(frameSpec({ maxDisplacementMm: 2, id: 'droop' } as never));
  b.addSpec({ id: 'light', kind: 'mass', body: 'arm', maxG: 60 });
  // beam elements are exact for a tip load: t^3 >= 4 F L^3 / (E w d) = 72.46 => t >= 4.169 mm
  const res = await optimizeParam(b.toJSON(), b.specs, {
    param: 't',
    min: 2,
    max: 12,
    metric: 'mass',
    body: 'arm',
    goal: 'minimize',
    samples: 9,
    refine: 8,
  });
  assert.ok(res.best, res.message);
  const exact = 72.463768 ** (1 / 3);
  assert.ok(res.best.value >= exact - 1e-9, `${res.best.value} below the true limit ${exact}`);
  assert.ok(res.best.value - exact < 0.02, `${res.best.value} vs ${exact}`);
});

test('a thermal spec keeps a heated part under its limit: an aluminium heat spreader versus the same part in PLA', async () => {
  const mk = async (material: 'copper' | 'PLA') => {
    const b = new ModelBuilder('plate');
    b.add({ op: 'box', id: 'plate', w: 40, d: 40, h: 4 });
    b.add({ op: 'material', target: 'plate', name: material });
    return build(b);
  };
  const spec = (maxTemperatureC: number): Spec => ({
    id: 'chip-temp',
    kind: 'thermal',
    body: 'plate',
    elementSizeMm: 2,
    heatInputs: [{ region: { face: { normal: '+Z' } }, powerW: 5 }],
    convections: [{ region: { face: { normal: '-Z' } }, hWm2K: 10, ambientC: 25 }],
    maxTemperatureC,
  });
  // 5 W through 10 W/(m2 K) over 1600 mm2: the whole plate sits near 25 + 5 / (10 x 1.6e-3) = 337 C when it spreads the heat
  const cu = evaluateSpec(await mk('copper'), spec(400));
  assert.equal(cu.ok, true, cu.summary);
  assert.equal(cu.fea, true);
  assert.match(cu.summary, /hottest point 33\d\.\d+ C/);
  assert.equal(evaluateSpec(await mk('copper'), spec(300)).ok, false);
  // PLA barely conducts, so the heated face runs far hotter than the cooled one
  const pla = evaluateSpec(await mk('PLA'), spec(400));
  assert.equal(pla.ok, false);
  assert.match(pla.summary, /EXCEEDS max 400/);
  // live evaluation skips it as pending, like the other FEA specs
  const live = evaluateSpecs(await mk('copper'), [spec(400)], { live: true });
  assert.equal(live.pending, 1);
  // errors say what to fix
  const raw = new ModelBuilder('raw');
  raw.add({ op: 'box', id: 'plate', w: 40, d: 40, h: 4 });
  assert.match(
    evaluateSpec(await build(raw), spec(400)).summary,
    /no material: add a material step/,
  );
  assert.match(
    evaluateSpec(await mk('copper'), { ...spec(400), maxTemperatureC: undefined } as Spec).summary,
    /needs maxTemperatureC and\/or minTemperatureC/,
  );
});

test('a modal spec keeps the lowest natural frequency away from a forcing frequency', async () => {
  const b = new ModelBuilder('arm');
  b.add({ op: 'box', id: 'arm', w: 100, d: 10, h: 5, at: [50, 0, 0] });
  b.add({ op: 'material', target: 'arm', name: '6061-T6' });
  const m = await build(b);
  const spec = (extra: object): Spec =>
    ({
      id: 'no-resonance',
      kind: 'modal',
      body: 'arm',
      supports: [{ region: { face: { normal: '-X' } } }],
      ...extra,
    }) as Spec;
  // beam theory: 411 Hz for this 100 x 10 x 5 mm aluminium cantilever
  const ok = evaluateSpec(m, spec({ minFrequencyHz: 300 }));
  assert.equal(ok.ok, true, ok.summary);
  assert.equal(ok.fea, true);
  assert.match(ok.summary, /lowest natural frequency 4[01]\d(\.\d+)? Hz/);
  const bad = evaluateSpec(m, spec({ minFrequencyHz: 500 }));
  assert.equal(bad.ok, false);
  assert.match(bad.summary, /BELOW min 500/);
  assert.equal(evaluateSpec(m, spec({ maxFrequencyHz: 300 })).ok, false);
  assert.equal(evaluateSpecs(m, [spec({ minFrequencyHz: 300 })], { live: true }).pending, 1);
  assert.match(evaluateSpec(m, spec({})).summary, /needs minFrequencyHz and\/or maxFrequencyHz/);
});
