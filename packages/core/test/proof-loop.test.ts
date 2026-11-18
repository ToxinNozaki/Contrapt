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

/** A 20 mm wide, t mm thick, 100 mm long 6061 cantilever arm: hand numbers are in the comments. */
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

const BEAM: Spec = {
  id: 'stiff',
  kind: 'beam',
  sketch: 'sec',
  support: 'cantilever',
  load: 'point',
  value: 50,
  lengthMm: 100,
  material: '6061-T6',
  minSafetyFactor: 2,
  maxDeflectionMm: 2,
};

test('specs and the journal live in the timeline: they survive a JSON round trip and replace by id', () => {
  const b = arm();
  b.addSpec({ id: 'mass', kind: 'mass', body: 'arm', maxG: 20 });
  b.addSpec({ id: 'mass', kind: 'mass', body: 'arm', maxG: 15 }); // same id replaces
  b.addJournal('decision', 'Chose 6061 because it is easy to machine', '2026-11-17T00:00:00.000Z');
  const copy = ModelBuilder.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
  assert.equal(copy.specs.length, 1);
  assert.equal((copy.specs[0] as Extract<Spec, { kind: 'mass' }>).maxG, 15);
  assert.equal(copy.journal[0]?.text, 'Chose 6061 because it is easy to machine');
  assert.throws(() => copy.removeSpec('nope'), /No spec "nope". Specs: mass/);
  assert.throws(() => copy.addSpec({ id: 'x', kind: 'mass' }), /Invalid spec/);
  assert.throws(() => copy.addJournal('note', ''), /Invalid journal entry/);
  // a timeline from before specs existed still loads
  const old = arm().toJSON();
  assert.equal(old.specs, undefined);
  assert.equal(ModelBuilder.fromJSON(old).specs.length, 0);
});

test('dimension, mass and volume specs pass and fail with the right margins', async () => {
  const m = await build(arm(6));
  // 20 x 6 x 100 mm: volume 12000 mm3, mass 12000 x 2.7 / 1000 = 32.4 g
  const ok = evaluateSpec(m, { id: 'len', kind: 'dimension', body: 'arm', axis: 'z', max: 120 });
  assert.equal(ok.ok, true);
  assert.equal(ok.marginPct, 16.7);
  const bad = evaluateSpec(m, { id: 'w', kind: 'dimension', body: 'arm', axis: 'x', max: 19 });
  assert.equal(bad.ok, false);
  assert.match(bad.summary, /EXCEEDS max 19/);
  const lo = evaluateSpec(m, { id: 'mm', kind: 'mass', body: 'arm', minG: 30, maxG: 40 });
  assert.equal(lo.ok, true);
  assert.match(lo.summary, /32\.4 g/);
  assert.equal(evaluateSpec(m, { id: 'mm', kind: 'mass', body: 'arm', maxG: 30 }).ok, false);
  assert.equal(
    evaluateSpec(m, { id: 'v', kind: 'volume', body: 'arm', minMm3: 12000, maxMm3: 12000 }).ok,
    true,
  );
});

test('a mass spec on a body with no material fails with a fixable message; missing bodies say what exists', async () => {
  await initKernel();
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'p', w: 1, d: 1, h: 1 });
  const m = await buildModel(b.toJSON());
  const r = evaluateSpec(m, { id: 'm', kind: 'mass', body: 'p', maxG: 5 });
  assert.equal(r.ok, false);
  assert.match(r.summary, /no material.*add a material step/);
  const gone = evaluateSpec(m, { id: 'v', kind: 'volume', body: 'zz', maxMm3: 1 });
  assert.equal(gone.ok, false);
  assert.match(gone.summary, /cannot evaluate: no body "zz" \(bodies: p\)/);
});

test('interference and gap specs judge real geometry', async () => {
  await initKernel();
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'a', w: 10, d: 10, h: 10 });
  b.add({ op: 'box', id: 'b', w: 10, d: 10, h: 10, at: [10, 0, 0] }); // touching
  b.add({ op: 'box', id: 'c', w: 10, d: 10, h: 10, at: [5, 0, 0] }); // overlapping
  b.add({ op: 'box', id: 'd', w: 10, d: 10, h: 10, at: [13, 0, 0] }); // 3 mm clear of a
  const m = await buildModel(b.toJSON());
  assert.equal(evaluateSpec(m, { id: 's1', kind: 'no_interference', a: 'a', b: 'b' }).ok, true);
  assert.equal(
    evaluateSpec(m, { id: 's2', kind: 'no_interference', a: 'a', b: 'b', allowTouching: false }).ok,
    false,
  );
  const hit = evaluateSpec(m, { id: 's3', kind: 'no_interference', a: 'a', b: 'c' });
  assert.equal(hit.ok, false);
  assert.match(hit.summary, /overlap by 500/);
  assert.equal(evaluateSpec(m, { id: 's4', kind: 'min_gap', a: 'a', b: 'd', minMm: 2 }).ok, true);
  const tight = evaluateSpec(m, { id: 's5', kind: 'min_gap', a: 'a', b: 'd', minMm: 5 });
  assert.equal(tight.ok, false);
  assert.match(tight.summary, /gap a-d 3 mm \(BELOW min 5\)/);
});

test('beam spec: the 6 mm arm fails its deflection limit by the hand-calculated amount, and says it is an estimate', async () => {
  const m = await build(arm(6));
  // delta = 4 F L^3 / (E w t^3) = 4 x 50 x 1e6 / (69000 x 20 x 216) = 0.6709 mm: passes 2 mm
  const pass = evaluateSpec(m, BEAM);
  assert.equal(pass.ok, true, pass.summary);
  assert.equal(pass.estimate, true);
  assert.match(pass.summary, /deflection 0\.67/);
  // at t = 3 mm: delta = 5.368 mm (fails), stress = 6 F L / (w t^2) = 166.7 MPa -> SF 1.66 (fails)
  const thin = evaluateSpec(await build(arm(3)), BEAM);
  assert.equal(thin.ok, false);
  assert.match(thin.summary, /safety factor 1\.6\d* .*BELOW min 2/);
  assert.match(thin.summary, /deflection 5.36.*EXCEEDS max 2/);
  assert.ok((thin.marginPct ?? 0) < 0);
  const noLimit = evaluateSpec(m, {
    ...BEAM,
    minSafetyFactor: undefined,
    maxDeflectionMm: undefined,
  });
  assert.equal(noLimit.ok, false);
  assert.match(noLimit.summary, /needs at least one of/);
});

test('evaluateSpecs summarises: allPass needs at least one spec and every spec passing', async () => {
  const m = await build(arm(6));
  assert.equal(evaluateSpecs(m, []).allPass, false);
  const rep = evaluateSpecs(m, [BEAM, { id: 'm', kind: 'mass', body: 'arm', maxG: 10 }]);
  assert.equal(rep.total, 2);
  assert.equal(rep.passing, 1);
  assert.equal(rep.allPass, false);
});

test('optimizer finds the thinnest arm that meets the specs: deflection governs at t = (4 F L^3 / (E w d))^(1/3)', async () => {
  const b = arm(10);
  b.addSpec(BEAM);
  // deflection <= 2 mm => t^3 >= 4 x 50 x 1e6 / (69000 x 20 x 2) = 72.46 => t >= 4.169 mm (stress needs only 3.30 mm)
  const res = await optimizeParam(b.toJSON(), b.specs, {
    param: 't',
    min: 2,
    max: 12,
    metric: 'mass',
    body: 'arm',
    goal: 'minimize',
  });
  assert.ok(res.best, res.message);
  const exact = 72.463768 ** (1 / 3);
  assert.ok(res.best.value >= exact - 1e-9, `${res.best.value} is below the true limit ${exact}`);
  assert.ok(res.best.value - exact < 0.01, `${res.best.value} vs ${exact}`);
  assert.ok(Math.abs(res.best.objective - 20 * res.best.value * 100 * 2.7e-3) < 1e-3);
  assert.match(res.message, /t = 4\.1/);
  assert.ok(res.trials.length > 13); // sweep plus bisection
  // the optimiser never edits the model it was given
  assert.equal(b.toJSON().params.t, 10);
});

test('maximize works too, and the edge of the range is flagged', async () => {
  const b = arm(10);
  b.addSpec({ id: 'light', kind: 'mass', body: 'arm', maxG: 40 }); // mass <= 40 g => t <= 40/(20 x 100 x 2.7e-3) = 7.407
  const res = await optimizeParam(b.toJSON(), b.specs, {
    param: 't',
    min: 2,
    max: 12,
    metric: 'size_y',
    body: 'arm',
    goal: 'maximize',
  });
  assert.ok(res.best);
  assert.ok(res.best.value <= 7.4075 + 1e-9 && res.best.value > 7.39, `${res.best.value}`);
  const edge = await optimizeParam(b.toJSON(), b.specs, {
    param: 't',
    min: 2,
    max: 5,
    metric: 'size_y',
    body: 'arm',
    goal: 'maximize',
  });
  assert.match(edge.message, /edge of the searched range/);
});

test('optimizer failure modes: impossible specs explain themselves; bad inputs are rejected', async () => {
  const b = arm(10);
  b.addSpec({ id: 'tiny', kind: 'mass', body: 'arm', maxG: 1 });
  const none = await optimizeParam(b.toJSON(), b.specs, {
    param: 't',
    min: 2,
    max: 12,
    metric: 'mass',
    body: 'arm',
    goal: 'minimize',
  });
  assert.equal(none.best, undefined);
  assert.match(none.message, /No sampled value of t.*satisfies every spec.*failing: tiny/);
  const base = {
    param: 't',
    min: 2,
    max: 12,
    metric: 'mass',
    body: 'arm',
    goal: 'minimize',
  } as const;
  await assert.rejects(optimizeParam(arm().toJSON(), [], base), /Add at least one spec/);
  await assert.rejects(
    optimizeParam(b.toJSON(), b.specs, { ...base, param: 'q' }),
    /Unknown parameter "q"/,
  );
  await assert.rejects(
    optimizeParam(b.toJSON(), b.specs, { ...base, min: 5, max: 5 }),
    /max must be greater/,
  );
});
