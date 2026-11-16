// Kernel smoke test: does OpenCASCADE (via replicad) run headless in Node and do
// the things Contrapt needs — sketch, extrude, fillet, shell, mass properties, STEP?
// Analytic checks use closed-form volumes so a wrong answer can't hide.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { drawCircle, drawRectangle, makeCylinder, measureArea, measureVolume } from 'replicad';
import { initKernel, kernelDiagnostics } from '../src/kernel.ts';
import { as3D } from '../src/shapes.ts';

const box = (w: number, d: number, h: number) =>
  as3D(drawRectangle(w, d).sketchOnPlane('XY').extrude(h));

const t0 = performance.now();
test('kernel initialises headless', async () => {
  const oc = await initKernel();
  console.log(`  kernel init: ${(performance.now() - t0).toFixed(0)} ms`);
  assert.ok(oc);
});

test('extruded rectangle has exact analytic volume', () => {
  const b = box(40, 20, 10);
  assert.ok(Math.abs(measureVolume(b) - 40 * 20 * 10) < 1e-6);
  assert.ok(Math.abs(measureArea(b) - 2 * (40 * 20 + 40 * 10 + 20 * 10)) < 1e-6);
});

test('cylinder volume matches pi r^2 h', () => {
  const cyl = makeCylinder(5, 12);
  assert.ok(Math.abs(measureVolume(cyl) - Math.PI * 25 * 12) < 1e-6);
});

test('boolean cut of a through-hole removes pi r^2 h', () => {
  const plate = box(40, 40, 5);
  const hole = as3D(drawCircle(4).sketchOnPlane('XY').extrude(5));
  const part = plate.cut(hole);
  assert.ok(Math.abs(measureVolume(part) - (40 * 40 * 5 - Math.PI * 16 * 5)) < 1e-3);
});

test('fillet removes the expected material from vertical edges', () => {
  const r = 3;
  const filleted = box(40, 20, 10).fillet(r, (e) => e.inDirection('Z'));
  // 4 vertical edges each lose (1 - pi/4) r^2 of cross-section over the height.
  const expected = 40 * 20 * 10 - 4 * (1 - Math.PI / 4) * r * r * 10;
  assert.ok(Math.abs(measureVolume(filleted) - expected) < 1e-3);
});

test('shell hollows a body', () => {
  const shelled = box(40, 20, 10).shell(2, (f) => f.inPlane('XY', 10));
  const v = measureVolume(shelled);
  assert.ok(v > 0 && v < 40 * 20 * 10, `unexpected shell volume ${v}`);
});

test('STEP export produces a valid STEP file', async () => {
  const text = await box(40, 20, 10).blobSTEP().text();
  assert.match(text, /^ISO-10303-21;/);
  assert.match(text, /ENDSEC;/);
  console.log(`  STEP size for a box: ${text.length} bytes`);
  // The kernel's "Statistics on Transfer" chatter must be captured, not printed (MCP stdio safety).
  assert.ok(
    kernelDiagnostics().some((l) => l.includes('Transfer')),
    'expected captured kernel output',
  );
});

test('timing: 100 extrude+fillet rebuilds', () => {
  const s = performance.now();
  for (let i = 0; i < 100; i++) box(40, 20, 10).fillet(2, (e) => e.inDirection('Z'));
  const per = (performance.now() - s) / 100;
  console.log(`  rebuild (extrude+fillet): ${per.toFixed(1)} ms each`);
  assert.ok(per < 500);
});
