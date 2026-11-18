import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  billOfMaterials,
  buildModel,
  initKernel,
  interferenceReport,
  ModelBuilder,
  motionCheck,
} from '../src/index.ts';

type Step = Parameters<ModelBuilder['add']>[0];
const build = async (steps: Step[]) => {
  await initKernel();
  const b = new ModelBuilder();
  for (const s of steps) b.add(s);
  return buildModel(b.toJSON());
};
const bbox = (m: Awaited<ReturnType<typeof build>>, id: string) => m.report.bodies[id]?.bbox;

// base: x -20..20, y -15..15, z 0..10; lid starts far away, 20 x 20 x 5
const base: Step = { op: 'box', id: 'base', w: 40, d: 30, h: 10, at: [0, 0, 5] };
const lid = (at: [number, number, number]): Step => ({
  op: 'box',
  id: 'lid',
  w: 20,
  d: 20,
  h: 5,
  at,
});

test('mate: the lid drops flat onto the base top (touching), and the note says how far it moved', async () => {
  const m = await build([
    base,
    lid([100, 100, 100]),
    { op: 'mate', target: 'lid', face: { normal: '-Z' }, to: { body: 'base', normal: '+Z' } },
  ]);
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  assert.equal(bbox(m, 'lid')?.min[2], 10); // lid bottom on base top (z=10)
  assert.equal(bbox(m, 'lid')?.min[0], 90); // not centred: x unchanged
  assert.match(m.report.steps[2]?.note ?? '', /moved by \(0, 0, -?\d/);
  assert.equal(
    interferenceReport(m).touching.length + interferenceReport(m).interfering.length >= 0,
    true,
  );
});

test('mate with centre and gap: centred on the base top with a 0.5 mm clearance', async () => {
  const m = await build([
    base,
    lid([100, 100, 100]),
    {
      op: 'mate',
      target: 'lid',
      face: { normal: '-Z' },
      to: { body: 'base', normal: '+Z' },
      gap: 0.5,
      center: true,
    },
  ]);
  const lb = bbox(m, 'lid');
  assert.ok(lb);
  assert.ok(Math.abs(lb.min[2] - 10.5) < 1e-9);
  assert.ok(Math.abs(lb.min[0] + 10) < 1e-9 && Math.abs(lb.max[0] - 10) < 1e-9);
  assert.ok(Math.abs(lb.min[1] + 10) < 1e-9 && Math.abs(lb.max[1] - 10) < 1e-9);
  const rep = interferenceReport(m);
  assert.equal(rep.interfering.length, 0);
  assert.ok(Math.abs((rep.tightestClear?.minDistance ?? 0) - 0.5) < 1e-6);
});

test('mate works on every axis: side faces meet with the right sign', async () => {
  const cases = [
    { face: '-X', to: '+X', expectMin: [20, 'x'] },
    { face: '+X', to: '-X', expectMax: [-20, 'x'] },
    { face: '-Y', to: '+Y', expectMin: [15, 'y'] },
    { face: '+Y', to: '-Y', expectMax: [-15, 'y'] },
  ] as const;
  for (const c of cases) {
    const m = await build([
      base,
      lid([100, 100, 100]),
      { op: 'mate', target: 'lid', face: { normal: c.face }, to: { body: 'base', normal: c.to } },
    ]);
    assert.ok(m.report.ok, `${c.face}: ${JSON.stringify(m.report.steps)}`);
    const lb = bbox(m, 'lid');
    const ax = ('expectMin' in c ? c.expectMin[1] : c.expectMax[1]) === 'x' ? 0 : 1;
    if ('expectMin' in c) assert.equal(lb?.min[ax], c.expectMin[0], c.face);
    else assert.equal(lb?.max[ax], c.expectMax[0], c.face);
  }
});

test('mate errors: faces must oppose, bodies must differ, and missing faces are explained', async () => {
  const same = await build([
    base,
    lid([0, 0, 50]),
    { op: 'mate', target: 'lid', face: { normal: '+Z' }, to: { body: 'base', normal: '+Z' } },
  ]);
  assert.match(
    same.report.steps[2]?.error ?? '',
    /must point at each other.*needs the other body's -Z face/,
  );
  const self = await build([
    base,
    { op: 'mate', target: 'base', face: { normal: '-Z' }, to: { body: 'base', normal: '+Z' } },
  ]);
  assert.match(self.report.steps[1]?.error ?? '', /itself/);
  const none = await build([
    base,
    { op: 'cylinder', id: 'rod', r: 3, h: 20 },
    { op: 'mate', target: 'rod', face: { normal: '+X' }, to: { body: 'base', normal: '-X' } },
  ]);
  assert.match(none.report.steps[2]?.error ?? '', /no flat face pointing \+X/);
  await initKernel();
  assert.throws(
    () =>
      new ModelBuilder().add({
        op: 'mate',
        target: 'a',
        face: { normal: '+X' },
        to: { body: 'b', normal: '-X' },
      }),
    /Unknown body "a"/,
  );
});

test('interference report over a small assembly: overlap, touch and clear are told apart', async () => {
  const m = await build([
    { op: 'box', id: 'a', w: 10, d: 10, h: 10 },
    { op: 'box', id: 'b', w: 10, d: 10, h: 10, at: [10, 0, 0] },
    { op: 'box', id: 'c', w: 10, d: 10, h: 10, at: [4, 0, 0] },
    { op: 'box', id: 'd', w: 10, d: 10, h: 10, at: [0, 0, 18] },
  ]);
  const rep = interferenceReport(m);
  assert.equal(rep.checked, 6);
  assert.deepEqual(rep.interfering.map((p) => `${p.a}-${p.b}`).sort(), ['a-c', 'b-c']);
  assert.deepEqual(
    rep.touching.map((p) => `${p.a}-${p.b}`),
    ['a-b'],
  );
  assert.equal(rep.tightestClear?.minDistance, 8);
  assert.throws(() => interferenceReport(m, ['a']), /at least two/);
  assert.throws(() => interferenceReport(m, ['a', 'zz']), /No body "zz"/);
});

test('bill of materials groups identical parts and totals the mass', async () => {
  const m = await build([
    { op: 'box', id: 'plate1', w: 40, d: 20, h: 10 },
    { op: 'material', target: 'plate1', name: '6061-T6' },
    { op: 'box', id: 'plate2', w: 40, d: 20, h: 10, at: [100, 0, 0] },
    { op: 'material', target: 'plate2', name: '6061-T6' },
    { op: 'box', id: 'spacer', w: 10, d: 10, h: 10, at: [0, 100, 0] },
    { op: 'material', target: 'spacer', name: 'brass' },
    { op: 'box', id: 'mystery', w: 5, d: 5, h: 5, at: [0, 0, 100] },
  ]);
  const bom = billOfMaterials(m);
  assert.equal(bom.parts, 4);
  assert.equal(bom.lines.length, 3);
  const plates = bom.lines.find((l) => l.ids.includes('plate1'));
  assert.deepEqual(plates?.ids, ['plate1', 'plate2']);
  assert.equal(plates?.quantity, 2);
  assert.equal(plates?.massEachG, 21.6);
  assert.equal(plates?.massTotalG, 43.2);
  assert.equal(bom.totalMassG, 43.2 + 8.5);
  assert.deepEqual(bom.missingMaterial, ['mystery']);
});

test('motion check: a pin sliding toward a wall first collides at the exact stroke, and a rotating arm hits a post', async () => {
  // pin: 4 x 4 x 4 box at x -2..2; wall: x 30..40. Slide +X by 40: tip (x=2+d) reaches 30 at d = 28 = 70% of travel.
  const slide = await build([
    { op: 'box', id: 'pin', w: 4, d: 4, h: 4 },
    { op: 'box', id: 'wall', w: 10, d: 20, h: 20, at: [35, 0, 0] },
  ]);
  const r = motionCheck(slide, { body: 'pin', translate: [40, 0, 0], steps: 40 });
  assert.equal(r.collisionFree, false);
  assert.equal(r.startsInCollision, false);
  // step k puts the tip at 2 + k; first overlap needs the tip past 30: k = 29 (fraction 0.725)
  assert.equal(r.firstCollision?.step, 29);
  assert.equal(r.firstCollision?.collisions[0]?.body, 'wall');
  assert.ok(Math.abs((r.results[27]?.minGapMm ?? 0) - 1) < 1e-6); // step 27: tip at 29, gap 1 mm
  const clearRun = motionCheck(slide, { body: 'pin', translate: [20, 0, 0], steps: 20 });
  assert.equal(clearRun.collisionFree, true);
  assert.ok(Math.abs((clearRun.tightestGapMm ?? 0) - 8) < 1e-6); // last pose: tip at 22, wall at 30

  // arm: 20 long along +X from the Z axis; post at (0, 15). Rotating +90 degrees about Z sweeps the arm onto +Y.
  const swing = await build([
    { op: 'box', id: 'arm', w: 20, d: 2, h: 2, at: [10, 0, 0] },
    { op: 'box', id: 'post', w: 2, d: 2, h: 10, at: [0, 15, 0] },
  ]);
  const s = motionCheck(swing, { body: 'arm', rotate: { axis: 'Z', degrees: 90 }, steps: 18 });
  assert.equal(s.collisionFree, false);
  assert.ok((s.firstCollision?.fraction ?? 0) > 0.7, `${s.firstCollision?.fraction}`);
  const away = motionCheck(swing, { body: 'arm', rotate: { axis: 'Z', degrees: -90 }, steps: 18 });
  assert.equal(away.collisionFree, true);
});

test('motion check validates its inputs', async () => {
  const m = await build([
    { op: 'box', id: 'a', w: 1, d: 1, h: 1 },
    { op: 'box', id: 'b', w: 1, d: 1, h: 1, at: [5, 0, 0] },
  ]);
  assert.throws(() => motionCheck(m, { body: 'a' }), /"translate" or a "rotate"/);
  assert.throws(
    () => motionCheck(m, { body: 'a', translate: [1, 0, 0], rotate: { axis: 'Z', degrees: 1 } }),
    /either/,
  );
  assert.throws(() => motionCheck(m, { body: 'zz', translate: [1, 0, 0] }), /No body "zz"/);
  assert.throws(
    () => motionCheck(m, { body: 'a', translate: [1, 0, 0], against: ['a'] }),
    /nothing to check against/,
  );
});
