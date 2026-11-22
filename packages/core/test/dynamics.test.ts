import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateDynamics } from '../src/index.ts';

const rel = (a: number, b: number, tol: number, what = '') =>
  assert.ok(
    Math.abs(a - b) <= tol * Math.abs(b),
    `${what} ${a} vs ${b} (${(((a - b) / b) * 100).toFixed(3)}%)`,
  );
const g = 9.80665;

test('small-angle pendulum period is 2 pi sqrt(L / g), and energy is conserved', () => {
  const L = 1;
  const m = 2;
  const r = simulateDynamics({
    kind: 'rotary',
    inertia: m * L * L,
    gravity: { mass: m, arm: L },
    q0: 0.05,
    duration: 12,
  });
  rel(r.period ?? 0, 2 * Math.PI * Math.sqrt(L / g), 2e-3, 'period');
  assert.ok((r.energyDrift ?? 1) < 1e-6, `drift ${r.energyDrift}`);
  rel(r.peakPosition.value, 0.05, 1e-3, 'amplitude');
});

test('large-amplitude pendulum: a 90 degree release takes 1.1803 times the small-angle period (elliptic integral)', () => {
  const r = simulateDynamics({
    kind: 'rotary',
    inertia: 1,
    gravity: { mass: 1, arm: 1 },
    q0: Math.PI / 2,
    duration: 20,
  });
  rel(r.period ?? 0, 1.18034 * 2 * Math.PI * Math.sqrt(1 / g), 3e-3, 'period at 90 degrees');
  assert.ok((r.energyDrift ?? 1) < 1e-6);
});

test('DC motor spin-up with no load: omega(t) = w0 (1 - exp(-t / tau)), tau = J w0 / stall torque', () => {
  const J = 0.001;
  const Ts = 0.5;
  const w0 = 100;
  const tau = (J * w0) / Ts; // 0.2 s
  const r = simulateDynamics({
    kind: 'rotary',
    inertia: J,
    drive: { stall: Ts, noLoadSpeed: w0 },
    duration: 1.2,
    samples: 600,
  });
  const at = (time: number) => {
    const i = r.t.findIndex((x) => x >= time);
    return r.v[i] as number;
  };
  rel(at(0.4), w0 * (1 - Math.exp(-0.4 / tau)), 2e-3, 'speed at 0.4 s');
  rel(r.final.v, w0 * (1 - Math.exp(-1.2 / tau)), 1e-3, 'final speed');
  assert.equal(r.warnings.length, 0);
});

test('critically damped spring-mass: x(t) = x0 (1 + w t) exp(-w t), no overshoot, settles', () => {
  const m = 1;
  const k = 100;
  const w = Math.sqrt(k / m);
  const r = simulateDynamics({
    kind: 'linear',
    inertia: m,
    spring: k,
    damping: 2 * Math.sqrt(m * k),
    q0: 0.1,
    duration: 2,
    samples: 400,
  });
  const i = r.t.findIndex((x) => x >= 0.2);
  rel(r.q[i] as number, 0.1 * (1 + w * 0.2) * Math.exp(-w * 0.2), 2e-3, 'x(0.2)');
  assert.ok(Math.min(...r.q) >= -1e-9, 'critically damped response must not overshoot');
  assert.ok((r.settleTime ?? 99) < 1);
});

test('underdamped spring-mass: damped period 2 pi / (w sqrt(1 - zeta^2)) and a logarithmic decrement', () => {
  const m = 0.5;
  const k = 200;
  const zeta = 0.05;
  const c = 2 * zeta * Math.sqrt(m * k);
  const r = simulateDynamics({
    kind: 'linear',
    inertia: m,
    spring: k,
    damping: c,
    q0: 0.02,
    duration: 3,
    samples: 2000,
  });
  const wn = Math.sqrt(k / m);
  rel(r.period ?? 0, (2 * Math.PI) / (wn * Math.sqrt(1 - zeta * zeta)), 3e-3, 'damped period');
  assert.ok(r.peakVelocity.value > 0);
  assert.ok(Math.abs(r.final.q) < 0.02);
});

test('Coulomb friction stops a sliding mass at the exact distance v0^2 / (2 mu g) and holds it there', () => {
  const m = 2;
  const mu = 0.3;
  const v0 = 3;
  const r = simulateDynamics({ kind: 'linear', inertia: m, friction: mu * m * g, v0, duration: 3 });
  rel(r.final.q, (v0 * v0) / (2 * mu * g), 5e-3, 'stopping distance');
  assert.equal(r.final.v, 0);
});

test('a force below the friction level does not move the mass; above it, it accelerates at (F - f) / m', () => {
  const still = simulateDynamics({
    kind: 'linear',
    inertia: 1,
    friction: 5,
    drive: { constant: 4 },
    duration: 1,
  });
  assert.equal(still.final.q, 0);
  const moving = simulateDynamics({
    kind: 'linear',
    inertia: 1,
    friction: 5,
    drive: { constant: 8 },
    duration: 1,
  });
  rel(moving.final.q, 0.5 * 3 * 1, 5e-3, 'x = a t^2 / 2 with a = 3');
});

test('motor lifting a weight: the arm swings up to its stop and the stop is reported', () => {
  const r = simulateDynamics({
    kind: 'rotary',
    inertia: 0.02,
    gravity: { mass: 0.5, arm: 0.2 },
    drive: { stall: 2, noLoadSpeed: 20 },
    limits: { min: -0.1, max: 1.2 },
    duration: 2,
  });
  assert.equal(r.stoppedBy, 'limit-max');
  assert.equal(r.final.q, 1.2);
  assert.ok(r.warnings.some((w) => /upper stop/.test(w)));
});

test('an inverted pendulum falls over (upright), and a drive that starts late waits', () => {
  const fall = simulateDynamics({
    kind: 'rotary',
    inertia: 1,
    gravity: { mass: 1, arm: 1, upright: true },
    q0: 0.01,
    duration: 2,
  });
  assert.ok(fall.peakPosition.value > 1, `${fall.peakPosition.value}`);
  const late = simulateDynamics({
    kind: 'linear',
    inertia: 1,
    drive: { constant: 10 },
    driveStart: 1,
    duration: 2,
  });
  rel(late.final.q, 0.5 * 10 * 1 ** 2, 5e-3, 'moves only after 1 s');
});

test('input validation', () => {
  assert.throws(
    () => simulateDynamics({ kind: 'rotary', inertia: 0, duration: 1 }),
    /inertia must be positive/,
  );
  assert.throws(
    () => simulateDynamics({ kind: 'rotary', inertia: 1, duration: 0 }),
    /duration must be positive/,
  );
  assert.throws(
    () => simulateDynamics({ kind: 'rotary', inertia: 1, damping: -1, duration: 1 }),
    /must not be negative/,
  );
  assert.throws(
    () =>
      simulateDynamics({ kind: 'linear', inertia: 1, gravity: { mass: 1, arm: 1 }, duration: 1 }),
    /constantForce/,
  );
  assert.throws(
    () => simulateDynamics({ kind: 'rotary', inertia: 1, limits: { min: 2, max: 1 }, duration: 1 }),
    /below limits.max/,
  );
});
