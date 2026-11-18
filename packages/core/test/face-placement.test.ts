import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel, initKernel, ModelBuilder } from '../src/index.ts';

type Step = Parameters<ModelBuilder['add']>[0];

const run = async (steps: Step[]) => {
  await initKernel();
  const b = new ModelBuilder();
  for (const s of steps) b.add(s);
  return buildModel(b.toJSON());
};
// A 40 x 30 x 20 block centred on x,y with its base on z=0: x -20..20, y -15..15, z 0..20.
const block: Step = { op: 'box', id: 'p', w: 40, d: 30, h: 20, at: [0, 0, 10] };

// For each face: the face spec, uv on it, and the world point + direction that the old "at" form needs.
const SIX = [
  { normal: '+Z', uv: [5, 6], at: [5, 6, 20], dir: '-Z' },
  { normal: '-Z', uv: [5, 6], at: [5, 6, 0], dir: '+Z' },
  { normal: '+X', uv: [4, 7], at: [20, 4, 7], dir: '-X' },
  { normal: '-X', uv: [4, 7], at: [-20, 4, 7], dir: '+X' },
  { normal: '+Y', uv: [8, 9], at: [8, 15, 9], dir: '-Y' },
  { normal: '-Y', uv: [8, 9], at: [8, -15, 9], dir: '+Y' },
] as const;

test('face + uv drills exactly what the equivalent world-coordinate "at" hole drills, on all six faces', async () => {
  for (const f of SIX) {
    const viaFace = await run([
      block,
      { op: 'hole', target: 'p', face: { normal: f.normal }, uv: [...f.uv], diameter: 4, depth: 5 },
    ]);
    const viaAt = await run([
      block,
      { op: 'hole', target: 'p', at: [...f.at], direction: f.dir, diameter: 4, depth: 5 },
    ]);
    assert.ok(viaFace.report.ok, `${f.normal}: ${JSON.stringify(viaFace.report.steps)}`);
    const want = 24000 - Math.PI * 4 * 5;
    assert.ok(Math.abs((viaFace.report.bodies.p?.volume ?? 0) - want) < 1e-3, `${f.normal}`);
    assert.equal(viaFace.report.bodies.p?.volume, viaAt.report.bodies.p?.volume, `${f.normal}`);
    assert.deepEqual(viaFace.report.bodies.p?.centerOfMass, viaAt.report.bodies.p?.centerOfMass);
    const note = viaFace.report.steps[1]?.note ?? '';
    assert.doesNotMatch(note, /WARNING/, `${f.normal}: ${note}`);
    assert.match(note, new RegExp(`on the \\${f.normal} face`));
  }
});

test('a through hole and a list of uv points on a face', async () => {
  const m = await run([
    block,
    {
      op: 'hole',
      target: 'p',
      face: { normal: '+Z' },
      uv: [
        [-10, 0],
        [10, 0],
      ],
      diameter: 6,
    },
  ]);
  assert.ok(m.report.ok);
  assert.ok(Math.abs((m.report.bodies.p?.volume ?? 0) - (24000 - 2 * Math.PI * 9 * 20)) < 1e-3);
});

test('uvFrom centre and corner measure from the face, not the world origin', async () => {
  // a block that is NOT centred on the origin: x 100..140, y 50..80, z 0..20
  const off: Step = { op: 'box', id: 'p', w: 40, d: 30, h: 20, at: [120, 65, 10] };
  const centre = await run([
    off,
    { op: 'hole', target: 'p', face: { normal: '+Z' }, uv: [0, 0], uvFrom: 'center', diameter: 4 },
  ]);
  const corner = await run([
    off,
    { op: 'hole', target: 'p', face: { normal: '+Z' }, uv: [5, 5], uvFrom: 'corner', diameter: 4 },
  ]);
  const ref = (at: number[]) => run([off, { op: 'hole', target: 'p', at, diameter: 4 }]);
  assert.equal(
    centre.report.bodies.p?.centerOfMass.join(),
    (await ref([120, 65, 20])).report.bodies.p?.centerOfMass.join(),
  );
  assert.equal(
    corner.report.bodies.p?.centerOfMass.join(),
    (await ref([105, 55, 20])).report.bodies.p?.centerOfMass.join(),
  );
  assert.ok(corner.report.ok && centre.report.ok);
});

test('the outermost face is chosen by default, and "near" picks another matching face', async () => {
  // an L-shaped body has two +Z faces: a low step (z=10) and a high step (z=30)
  const steps: Step[] = [
    { op: 'box', id: 'lo', w: 40, d: 20, h: 10, at: [0, 0, 5] },
    { op: 'box', id: 'hi', w: 20, d: 20, h: 30, at: [10, 0, 15] },
    { op: 'boolean', id: 'p', kind: 'union', a: 'lo', b: 'hi' },
  ];
  const top = await run([
    ...steps,
    { op: 'hole', target: 'p', face: { normal: '+Z' }, uv: [10, 0], diameter: 4, depth: 3 },
  ]);
  assert.match(top.report.steps[3]?.note ?? '', /Z=30.*outermost/);
  const step = await run([
    ...steps,
    {
      op: 'hole',
      target: 'p',
      face: { normal: '+Z', near: [-15, 0, 10] },
      uv: [-12, 0],
      diameter: 4,
      depth: 3,
    },
  ]);
  const note = step.report.steps[3]?.note ?? '';
  assert.match(note, /Z=10/);
  assert.match(note, /1 of 2 such faces/);
  assert.doesNotMatch(note, /WARNING/);
});

test('clear errors: no such face, missing uv, mixing at with face, uv without face, curved faces', async () => {
  const noFace = await run([
    { op: 'cylinder', id: 'p', r: 10, h: 10 },
    { op: 'hole', target: 'p', face: { normal: '+X' }, uv: [0, 5], diameter: 3 },
  ]);
  assert.equal(noFace.report.ok, false);
  assert.match(noFace.report.steps[1]?.error ?? '', /no flat face pointing \+X/);

  const noUv = await run([block, { op: 'hole', target: 'p', face: { normal: '+Y' }, diameter: 3 }]);
  assert.match(noUv.report.steps[1]?.error ?? '', /needs "uv": \[X, Z\] on the \+Y face/);

  const both = await run([
    block,
    { op: 'hole', target: 'p', at: [0, 0, 20], face: { normal: '+Z' }, uv: [0, 0], diameter: 3 },
  ]);
  assert.match(both.report.steps[1]?.error ?? '', /either "at" or "face"/);

  const neither = await run([block, { op: 'hole', target: 'p', diameter: 3 }]);
  assert.match(neither.report.steps[1]?.error ?? '', /needs "at".*or "face" \+ "uv"/);

  const lone = await run([
    block,
    { op: 'hole', target: 'p', at: [0, 0, 20], uv: [1, 1], diameter: 3 },
  ]);
  assert.match(lone.report.steps[1]?.error ?? '', /only works together with "face"/);
});

test('an explicit direction still wins, and a face hole that points out of the part warns', async () => {
  const flipped = await run([
    block,
    {
      op: 'hole',
      target: 'p',
      face: { normal: '+Z' },
      uv: [0, 0],
      direction: '+Z',
      diameter: 4,
      depth: 5,
    },
  ]);
  assert.match(flipped.report.steps[1]?.note ?? '', /WARNING.*drills away from the part/);
  assert.equal(flipped.report.bodies.p?.volume, 24000);
});

test('face-placed holes work in script mode and with patterns', async () => {
  const { compileScript } = await import('../src/index.ts');
  await initKernel();
  const tl = compileScript(
    "box({ id: 'p', w: 40, d: 30, h: 20, at: [0, 0, 10] }); hole({ target: 'p', face: { normal: '+Z' }, uv: [-10, 0], diameter: 4, pattern: { kind: 'linear', count: 3, step: [10, 0, 0] } });",
  );
  const m = await buildModel(tl);
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  assert.ok(Math.abs((m.report.bodies.p?.volume ?? 0) - (24000 - 3 * Math.PI * 4 * 20)) < 1e-3);
});
