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
// x -20..20, y -15..15, z 0..20 (volume 24000)
const block: Step = { op: 'box', id: 'p', w: 40, d: 30, h: 20, at: [0, 0, 10] };

// Sketch a 10 x 10 square on each face and extrude it as a cut 4 deep (against the outward direction the note names).
const CASES = [
  { normal: '+Z', dist: -4 },
  { normal: '-Z', dist: 4 },
  { normal: '+X', dist: -4 },
  { normal: '-X', dist: 4 },
  { normal: '+Y', dist: 4 },
  { normal: '-Y', dist: -4 },
] as const;

test('sketch onFace lands on each face of a block, and the note tells which way a positive extrude goes', async () => {
  for (const c of CASES) {
    const m = await run([
      block,
      {
        op: 'sketch',
        id: 's',
        onFace: { target: 'p', normal: c.normal },
        // side faces span z 0..20, so centre the square at z=10
        profile: [{ shape: 'rect', w: 10, h: 10, cy: c.normal.endsWith('Z') ? 0 : 10 }],
      },
      { op: 'extrude', sketch: 's', distance: c.dist, mode: 'cut', target: 'p' },
    ]);
    assert.ok(m.report.ok, `${c.normal}: ${JSON.stringify(m.report.steps)}`);
    assert.equal(m.report.bodies.p?.volume, 24000 - 400, `${c.normal} pocket volume`);
    assert.ok(
      (m.report.steps[1]?.note ?? '').includes(`on the ${c.normal} face`),
      m.report.steps[1]?.note ?? 'no note',
    );
  }
});

test('the stated extrude direction is the real one (a boss grows outward when the note says so)', async () => {
  for (const normal of ['+Z', '+X', '-Y'] as const) {
    const m = await run([
      block,
      {
        op: 'sketch',
        id: 's',
        onFace: { target: 'p', normal },
        profile: [{ shape: 'rect', w: 6, h: 6 }],
      },
      { op: 'extrude', id: 'boss', sketch: 's', distance: 3 },
    ]);
    const note = m.report.steps[1]?.note ?? '';
    const dir = /positive extrude distance goes ([+-][XYZ])/.exec(note)?.[1];
    assert.equal(dir, normal === '+Z' ? '+Z' : normal === '+X' ? '+X' : '-Y');
    assert.equal(m.report.bodies.boss?.volume, 6 * 6 * 3);
  }
});

test('onFace works for constrained sketches, and with a near selector', async () => {
  const m = await run([
    { op: 'box', id: 'lo', w: 40, d: 20, h: 10, at: [0, 0, 5] },
    { op: 'box', id: 'hi', w: 20, d: 20, h: 30, at: [10, 0, 15] },
    { op: 'boolean', id: 'p', kind: 'union', a: 'lo', b: 'hi' },
    {
      op: 'constrained_sketch',
      id: 'cs',
      onFace: { target: 'p', normal: '+Z', near: [-15, 0, 10] },
      points: { a: [-15, -3], b: [-9, -3], c: [-9, 3], d: [-15, 3] },
      lines: { ab: ['a', 'b'], bc: ['b', 'c'], cd: ['c', 'd'], da: ['d', 'a'] },
      constraints: [
        { type: 'fix', a: 'a', at: [-15, -3] },
        { type: 'horizontal', a: 'ab' },
        { type: 'vertical', a: 'bc' },
        { type: 'horizontal', a: 'cd' },
        { type: 'vertical', a: 'da' },
        { type: 'distance', a: 'a', b: 'b', value: 6 },
        { type: 'distance', a: 'b', b: 'c', value: 6 },
      ],
      profile: [{ loop: ['ab', 'bc', 'cd', 'da'] }],
    },
    { op: 'extrude', sketch: 'cs', distance: -5, mode: 'cut', target: 'p' },
  ]);
  assert.ok(m.report.ok, JSON.stringify(m.report.steps));
  assert.match(m.report.steps[3]?.note ?? '', /Z=10.*1 of 2 such faces/);
  assert.equal(m.report.bodies.p?.volume, 40 * 20 * 10 + 20 * 20 * 20 - 36 * 5);
});

test('sketch placement errors are clear', async () => {
  const both = await run([
    block,
    {
      op: 'sketch',
      id: 's',
      plane: 'XY',
      onFace: { target: 'p', normal: '+Z' },
      profile: [{ shape: 'rect', w: 1, h: 1 }],
    },
  ]);
  assert.match(both.report.steps[1]?.error ?? '', /either "plane" \+ "offset" or "onFace"/);
  const neither = await run([
    block,
    { op: 'sketch', id: 's', profile: [{ shape: 'rect', w: 1, h: 1 }] },
  ]);
  assert.match(neither.report.steps[1]?.error ?? '', /needs "plane".*or "onFace"/);
  const curved = await run([
    { op: 'cylinder', id: 'p', r: 5, h: 5 },
    {
      op: 'sketch',
      id: 's',
      onFace: { target: 'p', normal: '+X' },
      profile: [{ shape: 'rect', w: 1, h: 1 }],
    },
  ]);
  assert.match(curved.report.steps[1]?.error ?? '', /no flat face pointing \+X/);
});
