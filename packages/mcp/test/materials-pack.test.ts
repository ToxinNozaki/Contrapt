// The material library (core) and the Materials knowledge pack (mcp) must never disagree.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MATERIALS } from '@contrapt/core';

const pack = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'knowledge', 'materials.md'),
  'utf8',
);

/** Numbers in a cell: "2.70" -> [2.7]; "0.6–0.7" -> [0.6, 0.7]; "~3.5" -> [3.5]; "low" -> []. */
const nums = (cell: string) => (cell.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

const rows = new Map<string, string[]>();
// the main properties table is everything before the thermal table
for (const line of pack.slice(0, pack.indexOf('## Thermal properties')).split('\n')) {
  if (!line.startsWith('|')) continue;
  const cells = line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
  if (cells[0]) rows.set(cells[0], cells);
}

test('every library material has its row in the Materials pack, with matching density and modulus', () => {
  for (const m of Object.values(MATERIALS)) {
    const row = rows.get(m.packRow);
    assert.ok(row, `${m.name}: no row "${m.packRow}" in knowledge/materials.md`);

    const rho = nums(row[3] ?? '');
    assert.ok(rho.length > 0, `${m.name}: no density in the pack`);
    const [lo, hi] = [Math.min(...rho), Math.max(...rho)];
    assert.ok(
      m.density >= lo - 1e-9 && m.density <= hi + 1e-9,
      `${m.name}: library density ${m.density} outside pack ${lo}-${hi}`,
    );

    const e = nums(row[1] ?? '');
    if (m.youngsModulusGPa !== undefined && e.length > 0) {
      assert.ok(
        m.youngsModulusGPa >= Math.min(...e) - 1e-9 && m.youngsModulusGPa <= Math.max(...e) + 1e-9,
        `${m.name}: library E ${m.youngsModulusGPa} outside pack ${e.join('-')}`,
      );
    }
  }
});

test('every pack material row exists in the library (so the pack never promises a missing material)', () => {
  const known = new Set(Object.values(MATERIALS).map((m) => m.packRow));
  for (const [label, cells] of rows) {
    if (label === 'Material' || /^-+$/.test(label)) continue;
    if (!/^\d+(\.\d+)?$/.test(cells[3]?.replace(/[^0-9.]/g, '') ?? '')) continue; // not a material row
    if (!cells[3] || nums(cells[3]).length === 0) continue;
    assert.ok(known.has(label), `pack row "${label}" has no library entry`);
  }
});

test('the thermal-properties table in the pack matches the library: conductivity and expansion, and "varies" means undefined', () => {
  const start = pack.indexOf('## Thermal properties');
  const end = pack.indexOf('## Choosing a material');
  assert.ok(start > 0 && end > start, 'thermal table present');
  const trows = new Map<string, string[]>();
  for (const line of pack.slice(start, end).split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells[0]) trows.set(cells[0], cells);
  }
  let checked = 0;
  for (const m of Object.values(MATERIALS)) {
    const row = trows.get(m.packRow);
    if (m.conductivityWmK === undefined && m.expansionPerK === undefined) {
      assert.equal(
        row,
        undefined,
        `${m.name} has no thermal data and must not appear in the table`,
      );
      continue;
    }
    assert.ok(row, `${m.name}: no thermal row "${m.packRow}"`);
    const k = nums(row[1] ?? '');
    if (m.conductivityWmK === undefined)
      assert.equal(k.length, 0, `${m.name}: pack gives k but the library does not`);
    else assert.deepEqual(k, [m.conductivityWmK], `${m.name}: conductivity`);
    const a = nums(row[2] ?? '');
    if (m.expansionPerK === undefined)
      assert.equal(a.length, 0, `${m.name}: pack gives alpha but the library does not`);
    else
      assert.ok(
        Math.abs((a[0] ?? -1) - m.expansionPerK * 1e6) < 1e-9,
        `${m.name}: expansion ${a} vs ${m.expansionPerK}`,
      );
    checked++;
  }
  assert.ok(checked >= 15);
  // sanity: metals out-conduct plastics by orders of magnitude
  assert.ok(
    (MATERIALS['6061-T6']?.conductivityWmK ?? 0) > 100 * (MATERIALS.PLA?.conductivityWmK ?? 1),
  );
});
