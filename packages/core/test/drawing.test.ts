import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel, drawingSheet, initKernel, ModelBuilder } from '../src/index.ts';

type Step = Parameters<ModelBuilder['add']>[0];
const build = async (steps: Step[]) => {
  await initKernel();
  const b = new ModelBuilder();
  for (const s of steps) b.add(s);
  return buildModel(b.toJSON());
};
const dim = (svg: string, kind: string) => new RegExp(`data-dim="${kind}">([^<]+)<`).exec(svg)?.[1];

test('a 40 x 20 x 10 block: three views, overall dimensions 40 / 10 / 20, title block with material and mass', async () => {
  const m = await build([
    { op: 'box', id: 'p', w: 40, d: 20, h: 10 },
    { op: 'material', target: 'p', name: '6061-T6' },
  ]);
  const r = drawingSheet(m, { title: 'Test plate', number: 'TP-001' });
  assert.deepEqual(
    r.overall.map((x) => Math.round(x * 1000) / 1000),
    [40, 20, 10],
  );
  assert.match(r.scale, /^\d+:1$|^1:\d+$/);
  assert.equal(dim(r.svg, 'width'), '40');
  assert.equal(dim(r.svg, 'height'), '10');
  assert.equal(dim(r.svg, 'depth'), '20');
  for (const v of ['front', 'top', 'right']) assert.match(r.svg, new RegExp(`data-view="${v}"`));
  assert.match(r.svg, /Test plate/);
  assert.match(r.svg, /TP-001/);
  assert.match(r.svg, /Aluminium 6061-T6|6061-T6/);
  assert.match(r.svg, /21\.6 g/);
  assert.match(r.svg, /third angle/);
  assert.ok(r.svg.startsWith('<svg') && r.svg.trimEnd().endsWith('</svg>'));
});

test('scale is a standard value that makes the drawing fit: tiny parts are enlarged, huge ones reduced', async () => {
  const tiny = drawingSheet(await build([{ op: 'box', id: 'p', w: 4, d: 3, h: 2 }]));
  assert.match(tiny.scale, /^(\d+):1$/);
  assert.ok(Number(tiny.scale.split(':')[0]) >= 5, tiny.scale);
  const huge = drawingSheet(await build([{ op: 'box', id: 'p', w: 2000, d: 1000, h: 800 }]));
  assert.match(huge.scale, /^1:(\d+)$/);
  assert.ok(Number(huge.scale.split(':')[1]) >= 10, huge.scale);
  assert.equal(dim(huge.svg, 'width'), '2000');
  assert.equal(huge.warnings.length, 0);
});

test('hidden lines appear for internal features (a blind hole) and can be switched off', async () => {
  const m = await build([
    { op: 'box', id: 'p', w: 40, d: 40, h: 20 },
    { op: 'hole', target: 'p', face: { normal: '+Z' }, uv: [0, 0], diameter: 8, depth: 10 },
  ]);
  const withHidden = drawingSheet(m);
  const without = drawingSheet(m, { hiddenLines: false });
  assert.match(withHidden.svg, /stroke-dasharray/);
  assert.doesNotMatch(without.svg, /stroke-dasharray/);
});

test('an assembly draws every body, a subset can be chosen, and errors are clear', async () => {
  const m = await build([
    { op: 'box', id: 'a', w: 10, d: 10, h: 10 },
    { op: 'box', id: 'b', w: 10, d: 10, h: 10, at: [30, 0, 0] },
  ]);
  const both = drawingSheet(m);
  assert.equal(dim(both.svg, 'width'), '40'); // 10 + 20 gap + 10
  const one = drawingSheet(m, { bodies: ['a'] });
  assert.equal(dim(one.svg, 'width'), '10');
  assert.throws(() => drawingSheet(m, { bodies: ['zz'] }), /No body "zz"/);
  assert.throws(() => drawingSheet({ ...m, bodies: new Map() } as never), /no bodies/);
});

test('text is escaped so titles cannot break the SVG', async () => {
  const m = await build([{ op: 'box', id: 'p', w: 5, d: 5, h: 5 }]);
  const r = drawingSheet(m, { title: 'Bracket <A> & "B"' });
  assert.match(r.svg, /Bracket &lt;A&gt; &amp; &quot;B&quot;/);
  assert.doesNotMatch(r.svg, /<A>/);
});

test('layout: views and their dimension lines stay inside the border, never overlap each other or the title block', async () => {
  const shapes: Step[][] = [
    [{ op: 'box', id: 'p', w: 40, d: 20, h: 10 }],
    [{ op: 'box', id: 'p', w: 300, d: 10, h: 10 }], // long and thin
    [{ op: 'box', id: 'p', w: 10, d: 10, h: 300 }], // tall
    [{ op: 'cylinder', id: 'p', r: 25, h: 60 }],
  ];
  const inside = (r: { x: number; y: number; w: number; h: number }) =>
    r.x >= 10 && r.y >= 10 && r.x + r.w <= 287 && r.y + r.h <= 200;
  const overlap = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const steps of shapes) {
    const r = drawingSheet(await build(steps));
    const l = r.layout;
    for (const [k, v] of Object.entries(l))
      assert.ok(inside(v), `${k} outside the border: ${JSON.stringify(v)} (${r.scale})`);
    for (const a of ['front', 'top', 'right'])
      assert.equal(
        overlap(l[a] as never, l.titleBlock as never),
        false,
        `${a} overlaps the title block (${r.scale})`,
      );
    assert.equal(overlap(l.front as never, l.top as never), false, 'front/top overlap');
    assert.equal(overlap(l.front as never, l.right as never), false, 'front/right overlap');
    assert.equal(overlap(l.top as never, l.right as never), false, 'top/right overlap');
  }
});

test('the sheet is accessible: it has a title and a description naming the sheet and the overall size', async () => {
  const m = await build([{ op: 'box', id: 'p', w: 40, d: 20, h: 10 }]);
  const r = drawingSheet(m, { title: 'Bracket <A>' });
  assert.match(r.svg, /<title>Bracket &lt;A&gt;: third-angle drawing, scale /);
  assert.match(r.svg, /<desc>.*Overall width 40, depth 20, height 10\./);
  assert.match(r.svg, /role="img"/);
});
