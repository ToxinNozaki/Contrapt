import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractImage, makeInventorLikeFixture, readInventorFile, TINY_PNG } from '../src/index.ts';

test('reads container facts, properties and the preview from an Inventor-like file', () => {
  const info = readInventorFile(
    makeInventorLikeFixture({ partNumber: 'BRK-7', material: 'Steel', author: 'Pat' }),
  );
  assert.equal(info.cfbVersion, 3);
  assert.equal(info.rseSegments, 3);
  assert.ok(info.streams >= 6);
  assert.equal(info.summary.partNumber, 'BRK-7');
  assert.equal(info.summary.material, 'Steel');
  assert.equal(info.summary.author, 'Pat');
  assert.equal(info.summary.application, '2026.4 (Build 304435000, 435)');
  assert.equal(info.preview?.format, 'png');
  assert.equal(info.preview?.width, 1);
  assert.equal(info.preview?.height, 1);
  assert.deepEqual([...(info.preview?.bytes ?? [])], [...TINY_PNG]); // cut out byte-for-byte
  assert.ok(info.notes.some((n) => /Geometry is not read natively/.test(n)));
  assert.deepEqual(info.sections.map((s) => s.name).sort(), [
    'Design Tracking Properties',
    'Inventor Summary Information',
  ]);
});

test('a file without a preview says so instead of failing', () => {
  const info = readInventorFile(makeInventorLikeFixture({ preview: false }));
  assert.equal(info.preview, undefined);
  assert.ok(info.notes.some((n) => /No preview image/.test(n)));
});

test('garbage and truncated input never throws', () => {
  const good = makeInventorLikeFixture();
  const cases: Uint8Array[] = [
    new Uint8Array(0),
    new Uint8Array(10),
    Uint8Array.from({ length: 5000 }, (_, i) => (i * 31) % 256),
    good.subarray(0, 700), // truncated mid-container
    good.subarray(0, 1024),
  ];
  for (const c of cases) {
    const info = readInventorFile(c);
    assert.ok(Array.isArray(info.notes));
  }
  const corrupt = Uint8Array.from(good);
  for (let i = 600; i < Math.min(corrupt.length, 1400); i += 7) corrupt[i] = 0xff; // scribble inside
  assert.ok(Array.isArray(readInventorFile(corrupt).notes));
});

test('image extraction is exact and ignores trailing junk', () => {
  const blob = Uint8Array.from([
    ...Buffer.from('junk-prefix'),
    ...TINY_PNG,
    ...Buffer.from('trailing-junk'),
  ]);
  const img = extractImage(blob);
  assert.deepEqual([...(img?.bytes ?? [])], [...TINY_PNG]);
  assert.equal(extractImage(Buffer.from('no image here')), undefined);
  // a PNG whose chunk lengths lie must not read out of bounds
  const lying = Uint8Array.from([
    ...TINY_PNG.subarray(0, 33),
    0xff,
    0xff,
    0xff,
    0x7f,
    0x49,
    0x44,
    0x41,
    0x54,
  ]);
  assert.equal(extractImage(lying), undefined);
});

// Optional: run against a real file without ever committing it.
//   CONTRAPT_SAMPLE_IPT=/path/to/part.ipt npm test -w @contrapt/core
const sample = process.env.CONTRAPT_SAMPLE_IPT;
test('real Inventor file (only when CONTRAPT_SAMPLE_IPT is set)', { skip: !sample }, () => {
  const info = readInventorFile(new Uint8Array(readFileSync(sample as string)));
  assert.ok(info.rseSegments > 0, 'expected RSe data segments');
  assert.equal(info.preview?.format, 'png');
  assert.ok((info.preview?.width ?? 0) >= 64);
  assert.ok(info.summary.application, 'expected the Inventor version string');
});
