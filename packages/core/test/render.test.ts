import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { buildModel, initKernel, ModelBuilder, meshBodies, renderMeshes } from '../src/index.ts';

async function scene(build: (b: ModelBuilder) => void) {
  await initKernel();
  const b = new ModelBuilder();
  build(b);
  return meshBodies(await buildModel(b.toJSON()));
}

function decode(png: Uint8Array) {
  const b = Buffer.from(png);
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const idat = b.indexOf('IDAT');
  const len = b.readUInt32BE(idat - 4);
  const raw = inflateSync(b.subarray(idat + 4, idat + 4 + len));
  assert.equal(raw.length, (w * 3 + 1) * h, 'decompressed size matches the image');
  const px = (x: number, y: number) => {
    const o = y * (w * 3 + 1) + 1 + x * 3;
    return [raw[o], raw[o + 1], raw[o + 2]] as [number, number, number];
  };
  return { w, h, px, iend: b.indexOf('IEND') > 0 };
}

const isBackground = ([r, g, b]: [number, number, number]) => r > 200 && g > 205 && b > 210;

/** Bounding box of pixels that are not the light background (ignores the axis triad corner). */
function silhouette(img: ReturnType<typeof decode>) {
  let x0 = 1e9;
  let x1 = -1;
  let y0 = 1e9;
  let y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (x < 70 && y > img.h - 70) continue; // axis triad
      if (!isBackground(img.px(x, y))) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  return { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

test('renders a valid PNG of the requested size', async () => {
  const m = await scene((b) => b.add({ op: 'box', id: 'b', w: 40, d: 20, h: 10 }));
  const r = renderMeshes(m, { width: 320, height: 240 });
  const img = decode(r.png);
  assert.equal(img.w, 320);
  assert.equal(img.h, 240);
  assert.ok(img.iend);
  assert.match(r.camera, /iso view/);
});

test('top view is orthographic with correct proportions (40 x 20 box is 2:1)', async () => {
  const m = await scene((b) => b.add({ op: 'box', id: 'b', w: 40, d: 20, h: 10 }));
  const s = silhouette(decode(renderMeshes(m, { view: 'top', width: 400 }).png));
  assert.ok(Math.abs(s.w / s.h - 2) < 0.06, `aspect ${s.w}/${s.h}`);
});

test('orientation: top view has +X to the right and +Y up; front has +Z up', async () => {
  const m = await scene((b) => {
    b.add({ op: 'box', id: 'plate', w: 40, d: 40, h: 4 });
    b.add({ op: 'sphere', id: 'ball', r: 4, at: [30, 0, 0] }); // +X
    b.add({ op: 'cylinder', id: 'post', r: 3, h: 6, at: [0, 30, 0] }); // +Y
  });
  const copper = (p: [number, number, number]) =>
    p[0] > 150 && p[1] > 90 && p[1] < 190 && p[2] < 140 && p[0] - p[2] > 60;
  const green = (p: [number, number, number]) => p[1] > p[0] + 25 && p[1] > p[2] + 15;

  const top = decode(renderMeshes(m, { view: 'top', width: 400 }).png);
  const cx = (pred: (p: [number, number, number]) => boolean) => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < top.h; y++)
      for (let x = 0; x < top.w; x++)
        if (!(x < 70 && y > top.h - 70) && pred(top.px(x, y))) {
          sx += x;
          sy += y;
          n++;
        }
    return { x: sx / n, y: sy / n, n };
  };
  const ball = cx(copper); // second body (palette copper)
  const post = cx(green); // third body (palette green)
  assert.ok(ball.n > 20 && post.n > 20, `found ball ${ball.n}, post ${post.n}`);
  assert.ok(ball.x > top.w / 2 + 40, 'ball (+X) is right of centre');
  assert.ok(post.y < top.h / 2 - 40, 'post (+Y) is above centre');

  const front = decode(renderMeshes(m, { view: 'front', width: 400 }).png);
  // in the front view the 4 mm plate is a thin slab and the 8 mm ball pokes above/below: just check silhouette is wider than tall
  const s = silhouette(front);
  assert.ok(s.w > s.h * 3);
});

test('edges make feature lines visible; edges:false removes them', async () => {
  const m = await scene((b) => b.add({ op: 'box', id: 'b', w: 20, d: 20, h: 20 }));
  const dark = (img: ReturnType<typeof decode>) => {
    let n = 0;
    for (let y = 0; y < img.h; y++)
      for (let x = 0; x < img.w; x++) if (img.px(x, y)[0] < 90 && !(x < 70 && y > img.h - 70)) n++;
    return n;
  };
  const withEdges = dark(decode(renderMeshes(m, { view: 'iso', width: 400 }).png));
  const without = dark(decode(renderMeshes(m, { view: 'iso', width: 400, edges: false }).png));
  assert.ok(withEdges > without + 100, `${withEdges} vs ${without}`);
});

test('deterministic, handles an empty model, and clamps silly sizes', async () => {
  const m = await scene((b) => b.add({ op: 'sphere', id: 's', r: 5 }));
  const a = renderMeshes(m, { width: 200 }).png;
  const b = renderMeshes(m, { width: 200 }).png;
  assert.deepEqual([...a], [...b]);
  const empty = renderMeshes([], { width: 128 });
  assert.match(empty.camera, /empty/);
  assert.equal(decode(renderMeshes(m, { width: 1 }).png).w, 64);
  assert.equal(decode(renderMeshes(m, { width: 99999, height: 99999 }).png).w, 2048);
});

test('custom camera angles are accepted and described', async () => {
  const m = await scene((b) => b.add({ op: 'box', id: 'b', w: 10, d: 10, h: 10 }));
  const r = renderMeshes(m, { azimuth: 120, elevation: 20, width: 200 });
  assert.match(r.camera, /custom view/);
  assert.match(r.camera, /azimuth 120/);
});
