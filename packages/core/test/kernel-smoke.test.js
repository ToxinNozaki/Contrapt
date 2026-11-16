// Kernel smoke test: does OpenCASCADE (via replicad) run headless in Node and do
// the things Contrapt needs — sketch, extrude, fillet, shell, mass properties, STEP?
// Analytic checks use closed-form volumes so a wrong answer can't hide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { initKernel, kernelDiagnostics } from '../src/kernel.js';
import {
  drawRectangle,
  drawCircle,
  makeCylinder,
  measureVolume,
  measureArea,
} from 'replicad';

let oc;
const t0 = performance.now();
test('kernel initialises headless', async () => {
  oc = await initKernel();
  const ms = performance.now() - t0;
  console.log(`  kernel init: ${ms.toFixed(0)} ms`);
  assert.ok(oc);
});

test('extruded rectangle has exact analytic volume', () => {
  const box = drawRectangle(40, 20).sketchOnPlane('XY').extrude(10);
  assert.ok(Math.abs(measureVolume(box) - 40 * 20 * 10) < 1e-6);
  assert.ok(Math.abs(measureArea(box) - 2 * (40 * 20 + 40 * 10 + 20 * 10)) < 1e-6);
});

test('cylinder volume matches pi r^2 h', () => {
  const cyl = makeCylinder(5, 12);
  assert.ok(Math.abs(measureVolume(cyl) - Math.PI * 25 * 12) < 1e-6);
});

test('boolean cut of a through-hole removes pi r^2 h', () => {
  const plate = drawRectangle(40, 40).sketchOnPlane('XY').extrude(5);
  const hole = drawCircle(4).sketchOnPlane('XY').extrude(5);
  const part = plate.cut(hole);
  const expected = 40 * 40 * 5 - Math.PI * 16 * 5;
  assert.ok(Math.abs(measureVolume(part) - expected) < 1e-3);
});

test('fillet removes the expected material from vertical edges', () => {
  const r = 3;
  const box = drawRectangle(40, 20).sketchOnPlane('XY').extrude(10);
  const filleted = box.fillet(r, (e) => e.inDirection('Z'));
  // 4 vertical edges each lose (1 - pi/4) r^2 of cross-section over the height.
  const expected = 40 * 20 * 10 - 4 * (1 - Math.PI / 4) * r * r * 10;
  assert.ok(Math.abs(measureVolume(filleted) - expected) < 1e-3);
});

test('shell hollows a body', () => {
  const box = drawRectangle(40, 20).sketchOnPlane('XY').extrude(10);
  const shelled = box.shell(2, (f) => f.inPlane('XY', 10));
  const v = measureVolume(shelled);
  assert.ok(v > 0 && v < 40 * 20 * 10, `unexpected shell volume ${v}`);
});

test('STEP export produces a valid STEP file', async () => {
  const box = drawRectangle(40, 20).sketchOnPlane('XY').extrude(10);
  const blob = box.blobSTEP();
  const text = await blob.text();
  assert.match(text, /^ISO-10303-21;/);
  assert.match(text, /ENDSEC;/);
  console.log(`  STEP size for a box: ${text.length} bytes`);
  // The kernel's "Statistics on Transfer" chatter must be captured, not printed (MCP stdio safety).
  assert.ok(kernelDiagnostics().some((l) => l.includes('Transfer')), 'expected captured kernel output');
});

test('timing: 100 boolean+fillet rebuilds', () => {
  const s = performance.now();
  for (let i = 0; i < 100; i++) {
    const b = drawRectangle(40, 20).sketchOnPlane('XY').extrude(10);
    b.fillet(2, (e) => e.inDirection('Z'));
  }
  const per = (performance.now() - s) / 100;
  console.log(`  rebuild (extrude+fillet): ${per.toFixed(1)} ms each`);
  assert.ok(per < 500);
});
