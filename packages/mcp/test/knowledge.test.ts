// Tests for the engineering knowledge packs and playbooks. These tie the written examples to real
// arithmetic: if someone edits a worked example and breaks the math, this fails.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getKnowledge, loadKnowledge, parseKnowledge } from '../src/knowledge.ts';
import { buildPlaybook, PLAYBOOKS } from '../src/prompts.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'knowledge');
const docs = loadKnowledge();
const ids = new Set(docs.map((d) => d.id));

test('every pack has front matter, a body, and a unique id', () => {
  assert.ok(docs.length >= 15, `only ${docs.length} packs`);
  assert.equal(ids.size, docs.length);
  for (const d of docs) {
    assert.ok(d.title.length > 3, d.id);
    assert.ok(d.summary.length > 20, `${d.id} summary too short`);
    assert.ok(d.body.length > 400, `${d.id} body is suspiciously short`);
    assert.match(d.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'ids are lowercase-hyphen');
  }
});

test('the expected disciplines are covered', () => {
  for (const id of [
    'engineering-method',
    'safety-and-ethics',
    'strength-and-stiffness',
    'materials',
    'fasteners-and-joints',
    'tolerances-and-fits',
    'manufacturing-3d-printing',
    'manufacturing-cnc-and-laser',
    'manufacturing-sheet-metal',
    'manufacturing-molding-and-casting',
    'mechanisms-and-motion',
    'motors-power-and-electronics',
    'thermal-and-fluids',
    'structures-and-frames',
    'robotics-and-controls',
    'design-failure-modes',
    'importing-cad-files',
    'contrapt-modeling-patterns',
  ]) {
    assert.ok(ids.has(id), `missing pack ${id}`);
  }
  // method first: it is the entry point
  assert.equal(docs[0]?.id, 'engineering-method');
});

test('bad front matter is rejected with a clear message', () => {
  assert.throws(() => parseKnowledge('x', 'no front matter'), /front-matter/);
  assert.throws(() => parseKnowledge('x', '---\ntitle: a\n---\nbody'), /summary/);
  assert.throws(
    () => getKnowledge('nope'),
    /Unknown knowledge topic "nope"\. Topics: engineering-method/,
  );
});

test('backticked references to other packs resolve', () => {
  const unknown: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)) {
      const token = m[1] as string;
      // only treat tokens that look like pack ids (shared prefix with a real pack id)
      const looksLikePack = [...ids].some((id) => id.split('-')[0] === token.split('-')[0]);
      if (looksLikePack && !ids.has(token)) unknown.push(`${f}: ${token}`);
    }
  }
  assert.deepEqual(unknown, []);
});

test('no personal information leaked into the packs (public repo)', () => {
  // The machine's own user name is looked up at run time, never written into the repo.
  const user = userInfo().username;
  for (const f of readdirSync(dir)) {
    const text = readFileSync(join(dir, f), 'utf8');
    assert.doesNotMatch(
      text,
      /[A-Za-z]:\\Users|\/Users\/|\/home\/[a-z]/i,
      `${f}: absolute user path`,
    );
    assert.doesNotMatch(
      text,
      /[\w.+-]+@(gmail|outlook|hotmail|yahoo|icloud)\./i,
      `${f}: email address`,
    );
    if (user.length >= 3) {
      assert.ok(
        !text.toLowerCase().includes(user.toLowerCase()),
        `${f}: contains the local user name`,
      );
    }
  }
});

test('packs never claim a simulation ran', () => {
  const method = getKnowledge('engineering-method').body;
  assert.match(method, /does \*\*not yet\*\* run stress/);
  assert.match(method, /Never write "simulated"/);
});

// ---- worked examples recomputed -----------------------------------------------------------------
test('strength pack: cantilever example numbers are right', () => {
  const E = 69000;
  const [b, h, L, F] = [20, 5, 100, 50];
  const I = (b * h ** 3) / 12;
  const deflection = (F * L ** 3) / (3 * E * I);
  const stress = (F * L * (h / 2)) / I;
  assert.ok(Math.abs(I - 208.3) < 0.1);
  assert.ok(Math.abs(deflection - 1.16) < 0.01);
  assert.ok(Math.abs(stress - 60) < 0.1);
  assert.ok(Math.abs(276 / stress - 4.6) < 0.05);
  const text = getKnowledge('strength-and-stiffness').body;
  assert.match(text, /208\.3 mm⁴/);
  assert.match(text, /≈ 1\.16 mm/);
  assert.match(text, /≈ 60 MPa/);
  assert.match(text, /≈ 4\.6/);
  assert.ok(Math.abs((8 / 5) ** 3 - 4.1) < 0.05); // "cuts deflection by (8/5)^3 ≈ 4x"
});

test('sheet-metal pack: bend allowance and deduction example', () => {
  const [t, R, K, theta] = [2, 2, 0.4, 90];
  const BA = (Math.PI / 180) * theta * (R + K * t);
  const BD = 2 * (R + t) * Math.tan((theta * Math.PI) / 360) - BA;
  assert.ok(Math.abs(BA - 4.4) < 0.01);
  assert.ok(Math.abs(BD - 3.6) < 0.01);
  const text = getKnowledge('manufacturing-sheet-metal').body;
  assert.match(text, /= 4\.40/);
  assert.match(text, /= 3\.60 mm/);
});

test('motors pack: wheeled robot example', () => {
  const F = 5 * 0.5 + 0.015 * 5 * 9.81;
  const torquePerWheel = (F * 0.05) / 2;
  assert.ok(Math.abs(F - 3.2) < 0.05);
  assert.ok(Math.abs(torquePerWheel - 0.08) < 0.005);
  assert.match(getKnowledge('motors-power-and-electronics').body, /≈ 3\.2 N/);
});

test('mechanisms pack: gear example and timing pulley', () => {
  assert.ok(Math.abs(0.1 * (60 / 20) * 0.95 - 0.285) < 1e-9); // "≈ 0.29 N·m"
  assert.equal(3000 / (60 / 20), 1000);
  assert.ok(Math.abs((20 * 2) / Math.PI - 12.73) < 0.01); // GT2 20T pulley, "12.7 mm"
  const text = getKnowledge('mechanisms-and-motion').body;
  assert.match(text, /≈ 0\.29 N·m/);
  assert.match(text, /12\.7 mm/);
});

test('thermal pack: expansion and pneumatic examples', () => {
  assert.ok(Math.abs(23e-6 * 500 * 30 - 0.345) < 0.001); // "≈ 0.35 mm"
  const A = (Math.PI * 40 ** 2) / 4; // 40 mm bore
  assert.ok(Math.abs(A - 1257) < 1);
  assert.ok(Math.abs(0.6 * A - 754) < 1); // 0.6 MPa => 754 N
  const text = getKnowledge('thermal-and-fluids').body;
  assert.match(text, /≈ 0\.35 mm/);
  assert.match(text, /≈ 754 N/);
});

test('robotics pack: shoulder torque example', () => {
  const T = 9.81 * (0.5 * 0.3 + 0.4 * 0.15);
  assert.ok(Math.abs(T - 2.06) < 0.01);
  assert.match(getKnowledge('robotics-and-controls').body, /≈ 2\.06 N·m/);
});

test('materials pack: mass-from-volume example', () => {
  assert.ok(Math.abs((16400 * 2.7) / 1000 - 44) < 0.5);
  assert.match(getKnowledge('materials').body, /≈ 44 g/);
});

// ---- playbooks ------------------------------------------------------------------------------------
test('every playbook builds, embeds knowledge, and states the honesty rule', () => {
  assert.ok(PLAYBOOKS.length >= 9);
  const args: Record<string, string> = {
    goal: 'a phone stand',
    description: 'a 5 kg arm',
    problem: 'dry my socks',
    process: '3d-printing',
  };
  for (const p of PLAYBOOKS) {
    const text = buildPlaybook(p.name, args);
    assert.ok(text.length > 2000, `${p.name} is too thin (${text.length})`);
    assert.match(text, /does NOT yet simulate/, p.name);
    assert.match(text, /Knowledge pack:|knowledge topics/i, p.name);
  }
});

test('design_for_process embeds the matching process pack', () => {
  const expect: Record<string, string> = {
    '3d-printing': 'Design for 3D printing',
    cnc: 'CNC machining and laser',
    laser: 'CNC machining and laser',
    'sheet-metal': 'Design for sheet metal',
    molding: 'injection molding and casting',
    casting: 'injection molding and casting',
  };
  for (const [process, title] of Object.entries(expect)) {
    assert.match(buildPlaybook('design_for_process', { process }), new RegExp(title), process);
  }
});

test('playbook arguments are validated', () => {
  assert.throws(
    () => buildPlaybook('design_for_process', { process: 'telepathy' }),
    /Bad arguments/,
  );
  assert.throws(() => buildPlaybook('design_for_process', {}), /Bad arguments/);
  assert.throws(() => buildPlaybook('nope'), /Unknown playbook "nope"/);
  assert.match(
    buildPlaybook('design_part', { goal: 'a hook', constraints: 'holds 2 kg' }),
    /holds 2 kg/,
  );
});
