import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel, initKernel, ModelBuilder, printCheck } from '../src/index.ts';

type Step = Parameters<ModelBuilder['add']>[0];
const build = async (steps: Step[]) => {
  await initKernel();
  const b = new ModelBuilder();
  for (const s of steps) b.add(s);
  const m = await buildModel(b.toJSON());
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  return m;
};
const close = (a: number, b: number, tol: number, what = '') =>
  assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${what} ${a} vs ${b}`);

test('a plain block: sits flat (bed contact = footprint), no overhang, wall = the thinnest dimension', async () => {
  const r = printCheck(await build([{ op: 'box', id: 'p', w: 20, d: 20, h: 10 }]), { body: 'p' });
  close(r.current.bedContactMm2, 400, 1e-6, 'bed');
  assert.equal(r.current.overhangAreaMm2, 0);
  assert.equal(r.current.heightMm, 10);
  close(r.wall.minMm ?? 0, 10, 1e-3, 'wall');
  assert.equal(r.wall.thinPct, 0);
  assert.equal(r.findings[0]?.severity, 'info');
  assert.match(r.findings[0]?.text ?? '', /No overhang/);
});

test('a horizontal hole: only the roof within 45 degrees of straight down overhangs (a quarter of the bore)', async () => {
  const steps: Step[] = [
    { op: 'box', id: 'p', w: 40, d: 20, h: 40, at: [0, 0, 20] },
    { op: 'hole', target: 'p', face: { normal: '+Y' }, uv: [0, 20], diameter: 10 },
  ];
  const r = printCheck(await build(steps), { body: 'p' });
  close(r.current.overhangAreaMm2, (Math.PI / 2) * 5 * 20, 0.02, 'roof arc');
  assert.match(r.findings.map((f) => f.text).join(' '), /overhangs more than 45 degrees/);
  const loose = printCheck(await build(steps), { body: 'p', overhangDeg: 80 });
  assert.ok(loose.current.overhangAreaMm2 < r.current.overhangAreaMm2 / 2);
});

test('slope angle decides: a 60 degree-from-vertical underside overhangs, a 30 degree one does not', async () => {
  const wedge = (deg: number) =>
    build([
      { op: 'box', id: 'plate', w: 40, d: 20, h: 3 },
      { op: 'transform', target: 'plate', rotate: { angle: deg, axis: 'Y', origin: [0, 0, 0] } },
      { op: 'transform', target: 'plate', translate: [0, 0, 40] },
    ]);
  const shallow = printCheck(await wedge(30), { body: 'plate' });
  const steep = printCheck(await wedge(60), { body: 'plate' });
  assert.ok(shallow.current.overhangAreaMm2 > 700, `${shallow.current.overhangAreaMm2}`);
  assert.ok(steep.current.overhangAreaMm2 < 100, `${steep.current.overhangAreaMm2}`);
});

test('orientation advice: a T-bar printed flange-up needs support; flipping it puts the flange on the bed', async () => {
  const m = await build([
    { op: 'box', id: 'flange', w: 60, d: 20, h: 4, at: [0, 0, 22] },
    { op: 'box', id: 'stem', w: 6, d: 20, h: 20, at: [0, 0, 10] },
    { op: 'boolean', id: 'p', kind: 'union', a: 'flange', b: 'stem' },
  ]);
  const r = printCheck(m, { body: 'p' });
  // flange underside either side of the stem: 2 x (27 x 20) = 1080 mm2
  close(r.current.overhangAreaMm2, 1080, 1e-3, 'current overhang');
  // two orientations print it with no support: flange on the bed (-Z up) and standing on its end (+Y up, a straight extrusion);
  // the advice picks the shorter one and is never worse than the current orientation
  const flipped = r.orientations.find((o) => o.up === '-Z');
  assert.equal(flipped?.overhangAreaMm2, 0);
  assert.ok((flipped?.bedContactMm2 ?? 0) > 1000);
  assert.equal(r.recommended.overhangAreaMm2, 0);
  assert.equal(r.recommended.supportVolumeMm3, 0);
  assert.notEqual(r.recommended.up, '+Z');
  assert.ok(r.recommended.heightMm <= (flipped?.heightMm ?? 0));
  assert.match(
    r.findings.map((f) => f.text).join(' '),
    /Printing with [+-][XYZ] up cuts support volume/,
  );
});

test('thin walls are found by ray casting: a 0.6 mm shell is flagged near its true thickness', async () => {
  const m = await build([
    { op: 'box', id: 'p', w: 30, d: 30, h: 30, at: [0, 0, 15] },
    { op: 'shell', target: 'p', thickness: 0.6, faces: { plane: { name: 'XY', offset: 30 } } },
  ]);
  const r = printCheck(m, { body: 'p' });
  close(r.wall.minMm ?? 0, 0.6, 0.02, 'wall');
  assert.ok(r.wall.thinPct > 50);
  assert.match(r.findings.map((f) => f.text).join(' '), /Thin walls: as thin as 0\.6/);
  const ok = printCheck(m, { body: 'p', minWallMm: 0.4 });
  assert.equal(ok.wall.thinPct, 0);
});

test('build volume: a 250 mm bar does not fit a 200 mm bed in any orientation, and a part that fits is accepted', async () => {
  const bar = printCheck(await build([{ op: 'box', id: 'p', w: 250, d: 30, h: 20 }]), {
    body: 'p',
    buildVolume: [200, 200, 200],
  });
  // 250 along the bed diagonal is not modelled: axis-aligned only, so it must stand up and exceed the 200 height too
  assert.ok(bar.findings.some((f) => /does not fit the 200 x 200 x 200/.test(f.text)));
  const ok = printCheck(await build([{ op: 'box', id: 'p', w: 150, d: 100, h: 20 }]), {
    body: 'p',
    buildVolume: [200, 200, 200],
  });
  assert.equal(ok.current.fitsBuildVolume, true);
  assert.ok(!ok.findings.some((f) => /build volume/.test(f.text)));
});

test('errors are clear', async () => {
  const m = await build([{ op: 'box', id: 'p', w: 1, d: 1, h: 1 }]);
  assert.throws(() => printCheck(m, { body: 'nope' }), /No body "nope"/);
});
