import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evalExpr, exprNames } from '../src/expr.ts';

const ev = (s: string, vars: Record<string, number> = {}) => evalExpr(s, (n) => vars[n]);

test('arithmetic and precedence', () => {
  assert.equal(ev('1 + 2 * 3'), 7);
  assert.equal(ev('(1 + 2) * 3'), 9);
  assert.equal(ev('2 ^ 3 ^ 2'), 512); // right associative
  assert.equal(ev('-2 ^ 2'), -4);
  assert.equal(ev('10 / 4'), 2.5);
  assert.equal(ev('10 % 4'), 2);
  assert.equal(ev('1.5e2'), 150);
});

test('parameters, constants and functions', () => {
  assert.equal(ev('w / 2 + 3', { w: 40 }), 23);
  assert.ok(Math.abs(ev('pi * r ^ 2', { r: 2 }) - Math.PI * 4) < 1e-12);
  assert.equal(ev('max(1, 5, 3)'), 5);
  assert.ok(Math.abs(ev('sin(rad(90))') - 1) < 1e-12);
  assert.equal(ev('sqrt(16) + abs(-2)'), 6);
});

test('errors are clear', () => {
  assert.throws(() => ev('2 +'), /Unexpected/);
  assert.throws(() => ev('foo + 1'), /Unknown parameter "foo"/);
  assert.throws(() => ev('bar(1)'), /Unknown function "bar"/);
  assert.throws(() => ev('1 / 0'), /finite/);
  assert.throws(() => ev('2 $ 3'), /Unexpected character/);
});

test('expressions cannot reach JavaScript', () => {
  assert.throws(() => ev('process.exit(1)'));
  assert.throws(() => ev('constructor'));
  assert.throws(() => ev('globalThis'));
});

test('exprNames lists parameter references only', () => {
  assert.deepEqual(exprNames('w / 2 + max(a, b) * pi').sort(), ['a', 'b', 'w']);
});
