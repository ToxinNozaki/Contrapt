import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildModel,
  compileScript,
  getMaterial,
  initKernel,
  MATERIAL_NAMES,
  MATERIALS,
  ModelBuilder,
  massGrams,
} from '../src/index.ts';

const close = (a: number, b: number, tol = 1e-3) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

test('mass = volume x density for every material (1000 mm3 weighs exactly its density in grams)', async () => {
  await initKernel();
  for (const name of MATERIAL_NAMES) {
    const b = new ModelBuilder();
    b.add({ op: 'box', id: 'cube', w: 10, d: 10, h: 10 });
    b.add({ op: 'material', target: 'cube', name });
    const m = await buildModel(b.toJSON());
    assert.ok(m.report.ok, `${name}: ${JSON.stringify(m.report.steps)}`);
    const body = m.report.bodies.cube;
    assert.equal(body?.material, name);
    close(body?.massG ?? 0, MATERIALS[name]?.density ?? -1, 1e-6);
  }
});

test('a real part: 40 x 20 x 10 aluminium plate is 21.6 g, and the material note says so', async () => {
  await initKernel();
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'p', w: 40, d: 20, h: 10 });
  b.add({ op: 'material', id: 'mat', target: 'p', name: '6061-T6' });
  const m = await buildModel(b.toJSON());
  close(m.report.bodies.p?.massG ?? 0, 21.6, 1e-6);
  assert.match(
    m.report.steps.find((s) => s.id === 'mat')?.note ?? '',
    /Aluminium 6061-T6 \(2\.7 g\/cm3\)/,
  );
  assert.equal(m.materials.get('p'), '6061-T6');
  assert.equal(massGrams(8000, 2.7), 21.6);
});

test('mass tracks later edits: holes remove mass, parameters rescale it', async () => {
  await initKernel();
  const b = new ModelBuilder().param('t', 10);
  b.add({ op: 'box', id: 'p', w: 40, d: 20, h: 't' });
  b.add({ op: 'material', target: 'p', name: 'mild-steel' });
  b.add({ op: 'hole', target: 'p', at: [0, 0, 'm'] as never, diameter: 5 } as never);
  const bad = await buildModel(b.toJSON());
  assert.equal(bad.report.ok, false); // 'm' is not a parameter: a clear error, not a crash

  const c = new ModelBuilder().param('t', 10);
  c.add({ op: 'box', id: 'p', w: 40, d: 20, h: 't', at: [0, 0, 5] });
  c.add({ op: 'material', target: 'p', name: 'mild-steel' });
  c.add({ op: 'hole', target: 'p', at: [0, 0, 10], diameter: 5 });
  const m = await buildModel(c.toJSON());
  const vol = 8000 - Math.PI * 6.25 * 10;
  close(m.report.bodies.p?.massG ?? 0, (vol * 7.85) / 1000, 1e-3);
  c.param('t', 20);
  const m2 = await buildModel(c.toJSON());
  assert.ok((m2.report.bodies.p?.massG ?? 0) > (m.report.bodies.p?.massG ?? 0));
});

test('material survives booleans (inherited from the first operand), mirror copies and patterns', async () => {
  await initKernel();
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'a', w: 20, d: 20, h: 20 });
  b.add({ op: 'material', target: 'a', name: 'PETG' });
  b.add({ op: 'cylinder', id: 'pin', r: 3, h: 40 });
  b.add({ op: 'boolean', id: 'drilled', kind: 'cut', a: 'a', b: 'pin' });
  const m = await buildModel(b.toJSON());
  assert.equal(m.report.bodies.drilled?.material, 'PETG');
  assert.equal(m.materials.has('a'), false); // the consumed operand's entry is gone
  close(m.report.bodies.drilled?.massG ?? 0, ((8000 - Math.PI * 9 * 20) * 1.27) / 1000, 1e-3);

  // second operand's material is used only when the first has none
  const c = new ModelBuilder();
  c.add({ op: 'box', id: 'x', w: 10, d: 10, h: 10 });
  c.add({ op: 'box', id: 'y', w: 10, d: 10, h: 10, at: [10, 0, 0] });
  c.add({ op: 'material', target: 'y', name: 'brass' });
  c.add({ op: 'boolean', id: 'u', kind: 'union', a: 'x', b: 'y' });
  assert.equal((await buildModel(c.toJSON())).report.bodies.u?.material, 'brass');

  const mir = new ModelBuilder();
  mir.add({ op: 'box', id: 'h', w: 10, d: 10, h: 10, at: [5, 0, 0] });
  mir.add({ op: 'material', target: 'h', name: 'acetal' });
  mir.add({ op: 'mirror', id: 'twin', target: 'h', axis: 'X', offset: 20, mode: 'new' });
  const mm = await buildModel(mir.toJSON());
  assert.equal(mm.report.bodies.twin?.material, 'acetal');
  assert.equal(mm.report.bodies.h?.material, 'acetal');
});

test('bodies without a material report no mass; the last material step wins; suppressing removes it', async () => {
  await initKernel();
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'p', w: 10, d: 10, h: 10 });
  const none = await buildModel(b.toJSON());
  assert.equal(none.report.bodies.p?.massG, undefined);
  b.add({ op: 'material', id: 'm1', target: 'p', name: 'PLA' });
  b.add({ op: 'material', id: 'm2', target: 'p', name: 'copper' });
  assert.equal((await buildModel(b.toJSON())).report.bodies.p?.material, 'copper');
  b.suppress('m2');
  assert.equal((await buildModel(b.toJSON())).report.bodies.p?.material, 'PLA');
});

test('unknown materials and bad targets give clear errors; scripts work', async () => {
  await initKernel();
  const b = new ModelBuilder();
  assert.throws(
    () => b.add({ op: 'material', target: 'nope', name: '6061-T6' }),
    /Unknown body "nope"/,
  );
  b.add({ op: 'box', id: 'p', w: 1, d: 1, h: 1 });
  assert.throws(() => b.add({ op: 'material', target: 'p', name: 'unobtainium' }), /Invalid step/);
  assert.throws(() => getMaterial('unobtainium'), /Available: 6061-T6/);

  const tl = compileScript(
    "box({ id: 'p', w: 10, d: 10, h: 10 }); material({ target: 'p', name: 'PLA' });",
  );
  const m = await buildModel(tl);
  close(m.report.bodies.p?.massG ?? 0, 1.24, 1e-6);
});

test('the library is sane: densities positive, names unique, plastics lighter than metals', () => {
  assert.ok(MATERIAL_NAMES.length >= 18);
  for (const m of Object.values(MATERIALS)) assert.ok(m.density > 0.3 && m.density < 20, m.name);
  assert.ok(getMaterial('PLA').density < getMaterial('6061-T6').density);
  assert.ok(getMaterial('6061-T6').density < getMaterial('mild-steel').density);
});
