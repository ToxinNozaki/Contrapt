import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  buildModel,
  compileScript,
  describeStep,
  detectFormat,
  exportStep,
  initKernel,
  isSafeFileName,
  ModelBuilder,
  sniffContent,
  TimelineSchema,
} from '../src/index.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const OLE = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
const close = (a: number, b: number, tol = 1e-3) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

// A real STEP file made by Contrapt's own exporter: 40 x 20 x 10 box, volume 8000.
async function boxStep(): Promise<Uint8Array> {
  await initKernel();
  const b = new ModelBuilder();
  b.add({ op: 'box', id: 'b', w: 40, d: 20, h: 10 });
  return enc(await exportStep(await buildModel(b.toJSON()), 'b'));
}

const provider = (files: Record<string, Uint8Array>) => async (name: string) => {
  const f = files[name];
  if (!f) throw new Error(`no such file ${name}`);
  return f;
};

test('format detection: STEP is supported, by name and by content', async () => {
  const step = await boxStep();
  const f = detectFormat('part.step', step);
  assert.equal(f.format, 'step');
  assert.equal(f.support, 'supported');
  assert.equal(detectFormat('part.STP', step).format, 'step'); // alias + case
  assert.equal(detectFormat('mystery.dat', step).format, 'step'); // unknown extension, STEP content
});

test('Inventor files are recognised and explained, not guessed at', () => {
  const ipt = detectFormat('Bracket v3.ipt', OLE);
  assert.equal(ipt.support, 'via-step');
  assert.equal(ipt.kind, 'solid');
  assert.match(ipt.howTo, /Inventor/);
  assert.match(ipt.howTo, /STEP/);

  const iam = detectFormat('Machine.iam', OLE);
  assert.equal(iam.kind, 'assembly');
  assert.match(iam.howTo, /referenced parts|reference/i);

  const idw = detectFormat('Sheet1.idw', OLE);
  assert.equal(idw.kind, 'drawing');
  assert.match(idw.howTo, /no 3D geometry/);
  assert.notEqual(idw.support, 'supported');

  assert.equal(detectFormat('Explode.ipn', OLE).kind, 'presentation');
});

test('other CAD programs point to STEP export', () => {
  for (const [name, word] of [
    ['a.sldprt', 'SolidWorks'],
    ['a.f3d', 'Fusion'],
    ['a.3dm', 'Rhino'],
    ['a.catpart', 'CATIA'],
  ] as const) {
    const f = detectFormat(name, OLE);
    assert.equal(f.support, 'via-step', name);
    assert.match(f.howTo + f.name, new RegExp(word), name);
  }
});

test('a .step that is not STEP is flagged, not trusted', () => {
  const f = detectFormat('fake.step', OLE);
  assert.notEqual(f.support, 'supported');
  assert.match(f.howTo, /do not look like a STEP file/);
});

test('content sniffing', () => {
  assert.equal(sniffContent(enc('ISO-10303-21;\nHEADER;')), 'step');
  assert.equal(sniffContent(enc('\uFEFFISO-10303-21;')), 'step');
  assert.equal(sniffContent(OLE), 'ole');
  assert.equal(sniffContent(enc('AC1027\0\0')), 'dwg');
  assert.equal(sniffContent(enc('  0\nSECTION\n  2\nHEADER')), 'dxf');
  assert.equal(sniffContent(enc('solid cube\n facet normal 0 0 1')), 'stl');
  const bin = new Uint8Array(84 + 50 * 2);
  new DataView(bin.buffer).setUint32(80, 2, true);
  assert.equal(sniffContent(bin), 'stl'); // binary STL: size matches 84 + 50 * triangles
  assert.equal(sniffContent(enc('hello world')), undefined);
});

test('planned formats are recognised as planned', () => {
  assert.equal(detectFormat('a.stl', enc('solid x\nfacet')).support, 'planned');
  assert.equal(detectFormat('a.dxf', enc('  0\nSECTION')).support, 'planned');
  assert.equal(detectFormat('a.igs', enc('x')).support, 'planned');
  assert.equal(detectFormat('whatever.xyz', enc('hi')).support, 'unknown');
});

test('describeStep summarises a STEP file', async () => {
  const s = describeStep(await boxStep());
  assert.equal(s.solids, 1);
  assert.ok(s.schema, 'schema should be present');
});

test('file names: plain names only', () => {
  for (const ok of ['part.step', 'Bracket v3.step', 'a(1).stp', 'x-y_z.STEP'])
    assert.ok(isSafeFileName(ok), ok);
  for (const bad of [
    '../x.step',
    'a/b.step',
    'a\\b.step',
    '..',
    '.hidden',
    'C:\\x.step',
    '',
    'a..b/../c',
    '/etc/passwd',
  ]) {
    assert.ok(!isSafeFileName(bad), bad);
  }
  const bad = TimelineSchema.safeParse({
    version: 1,
    name: 'x',
    units: 'mm',
    params: {},
    steps: [{ id: 'i', op: 'import', file: '../secrets.step' }],
  });
  assert.equal(bad.success, false);
});

test('import round-trip is exact: volume, size, then edit it like any body', async () => {
  const step = await boxStep();
  const b = new ModelBuilder();
  b.add({ op: 'import', id: 'blk', file: 'box.step' });
  const m = await buildModel(b.toJSON(), { files: provider({ 'box.step': step }) });
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.blk?.volume ?? 0, 8000);
  assert.deepEqual(m.report.bodies.blk?.bbox.size, [40, 20, 10]);

  // exact B-rep: an imported body can be filleted and drilled
  b.add({ op: 'fillet', target: 'blk', radius: 2, edges: { direction: 'Z', expect: 4 } });
  const hole = b.add({
    op: 'sketch',
    plane: 'XY',
    offset: -5,
    profile: [{ shape: 'circle', r: 3 }],
  });
  b.add({ op: 'extrude', sketch: hole, distance: 10, mode: 'cut', target: 'blk' });
  const m2 = await buildModel(b.toJSON(), { files: provider({ 'box.step': step }) });
  assert.ok(m2.report.ok, JSON.stringify(m2.report.steps));
  const expected = 8000 - 4 * (1 - Math.PI / 4) * 4 * 10 - Math.PI * 9 * 10;
  close(m2.report.bodies.blk?.volume ?? 0, expected, 1e-2);
});

test('import scale and position', async () => {
  const step = await boxStep();
  const b = new ModelBuilder();
  b.param('k', 2);
  b.add({ op: 'import', id: 'big', file: 'box.step', scale: 'k', at: [100, 0, 0] });
  const m = await buildModel(b.toJSON(), { files: provider({ 'box.step': step }) });
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.big?.volume ?? 0, 8000 * 8); // scale 2 => volume x8
  assert.deepEqual(m.report.bodies.big?.bbox.size, [80, 40, 20]);
  assert.ok((m.report.bodies.big?.centerOfMass[0] ?? 0) > 99); // moved +100 in X
});

test('checksum protects against a file that changed after import', async () => {
  const step = await boxStep();
  const sha = createHash('sha256').update(step).digest('hex');
  const good = new ModelBuilder();
  good.add({ op: 'import', id: 'a', file: 'box.step', sha256: sha });
  assert.ok((await buildModel(good.toJSON(), { files: provider({ 'box.step': step }) })).report.ok);

  const tampered = enc(`${new TextDecoder().decode(step)}\n/* edited */`);
  const m = await buildModel(good.toJSON(), { files: provider({ 'box.step': tampered }) });
  assert.equal(m.report.ok, false);
  assert.match(m.report.steps[0]?.error ?? '', /checksum mismatch/);
});

test('importing unsupported or missing files fails with an actionable message', async () => {
  const b = new ModelBuilder();
  b.add({ op: 'import', id: 'p', file: 'Bracket.ipt' });
  const m = await buildModel(b.toJSON(), { files: provider({ 'Bracket.ipt': OLE }) });
  assert.equal(m.report.ok, false);
  assert.match(m.report.steps[0]?.error ?? '', /Inventor/);
  assert.match(m.report.steps[0]?.error ?? '', /STEP/);

  const none = await buildModel(b.toJSON()); // no file provider at all
  assert.match(none.report.steps[0]?.error ?? '', /no file access/);

  const missing = await buildModel(b.toJSON(), { files: provider({}) });
  assert.match(missing.report.steps[0]?.error ?? '', /no such file/);
});

test('script mode exposes the import step as importFile (import is reserved JavaScript)', async () => {
  const step = await boxStep();
  const tl = compileScript("importFile({ id: 'blk', file: 'box.step', scale: 2 });");
  assert.equal(tl.steps[0]?.op, 'import');
  const m = await buildModel(tl, { files: provider({ 'box.step': step }) });
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  close(m.report.bodies.blk?.volume ?? 0, 8000 * 8);
});
