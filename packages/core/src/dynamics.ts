// One-degree-of-freedom dynamics (rotary or linear) integrated with RK4: inertia, viscous damping, spring, gravity,
// Coulomb friction, a constant drive or a DC motor torque-speed line, hard stops. SI units throughout (kg, m, N, N*m,
// rad, s). Reflect gearing into the inertia and torque yourself (inertia / ratio^2, torque x ratio x efficiency).

export interface DynamicsInput {
  kind: 'rotary' | 'linear';
  /** kg*m^2 (rotary) or kg (linear), already reflected to the coordinate */
  inertia: number;
  /** viscous damping, N*m*s/rad or N*s/m */
  damping?: number;
  /** spring stiffness N*m/rad or N/m, about spring_zero */
  spring?: number;
  springZero?: number;
  /** pendulum-like gravity: restoring force/torque = -mass * g * arm * sin(q) (q = 0 hanging; use upright for an inverted pendulum) */
  gravity?: { mass: number; arm: number; upright?: boolean };
  /** linear only: a constant force from gravity along the motion, N (e.g. mass * g * sin(slope)) */
  constantForce?: number;
  /** Coulomb friction magnitude, N*m or N */
  friction?: number;
  /** drive: a constant torque/force, or a DC motor line T = stall * (1 - speed / noLoad) */
  drive?: { constant: number } | { stall: number; noLoadSpeed: number };
  /** the drive switches on at this time, s (default 0) */
  driveStart?: number;
  q0?: number;
  v0?: number;
  duration: number;
  /** hard stops on q: motion is clamped there and the velocity is zeroed */
  limits?: { min?: number; max?: number };
  /** samples returned (default 200, max 2000) */
  samples?: number;
}

export interface DynamicsResult {
  t: number[];
  q: number[];
  v: number[];
  /** peak |q|, peak |v| and their times */
  peakPosition: { value: number; t: number };
  peakVelocity: { value: number; t: number };
  final: { q: number; v: number };
  /** time after which q stays within 2% of its final value (undefined if it never settles) */
  settleTime?: number;
  /** estimated period from rising zero crossings of (q - mean), s */
  period?: number;
  /** mechanical energy drift for a conservative system (no damping, friction or drive), relative */
  energyDrift?: number;
  stoppedBy?: 'limit-min' | 'limit-max';
  steps: number;
  warnings: string[];
}

const G = 9.80665;

export function simulateDynamics(inp: DynamicsInput): DynamicsResult {
  if (!(inp.inertia > 0)) throw new Error('inertia must be positive');
  if (!(inp.duration > 0)) throw new Error('duration must be positive');
  const c = inp.damping ?? 0;
  const k = inp.spring ?? 0;
  const q0s = inp.springZero ?? 0;
  const mu = inp.friction ?? 0;
  if (c < 0 || k < 0 || mu < 0)
    throw new Error('damping, spring and friction must not be negative');
  if (inp.gravity && !(inp.gravity.mass > 0 && inp.gravity.arm >= 0))
    throw new Error('gravity needs a positive mass and a non-negative arm');
  if (inp.kind === 'linear' && inp.gravity)
    throw new Error(
      'For linear motion use constantForce (mass * g * sin(slope)), not the pendulum gravity term',
    );
  const warnings: string[] = [];
  if (
    inp.limits?.min !== undefined &&
    inp.limits?.max !== undefined &&
    inp.limits.min >= inp.limits.max
  )
    throw new Error('limits.min must be below limits.max');

  const sign = inp.gravity?.upright ? 1 : -1;
  const driveOn = (t: number) => t >= (inp.driveStart ?? 0);
  const force = (t: number, q: number, v: number) => {
    let f = -c * v - k * (q - q0s) + (inp.constantForce ?? 0);
    if (inp.gravity) f += sign * inp.gravity.mass * G * inp.gravity.arm * Math.sin(q);
    if (inp.drive && driveOn(t)) {
      if ('constant' in inp.drive) f += inp.drive.constant;
      else f += inp.drive.stall * (1 - v / inp.drive.noLoadSpeed);
    }
    return f;
  };
  // fastest natural time scale decides the step
  const wMax = Math.sqrt(
    Math.max(k, inp.gravity ? inp.gravity.mass * G * inp.gravity.arm : 0) / inp.inertia,
  );
  const tauMin = c > 0 ? inp.inertia / c : Number.POSITIVE_INFINITY;
  const motorTau =
    inp.drive && 'stall' in inp.drive
      ? (inp.inertia * inp.drive.noLoadSpeed) / inp.drive.stall
      : Number.POSITIVE_INFINITY;
  const scale = Math.min(
    wMax > 0 ? 1 / wMax : Number.POSITIVE_INFINITY,
    tauMin,
    motorTau,
    inp.duration,
  );
  let dt = Math.min(scale / 200, inp.duration / 2000);
  dt = Math.max(dt, inp.duration / 400000);
  const n = Math.ceil(inp.duration / dt);
  dt = inp.duration / n;

  let q = inp.q0 ?? 0;
  let v = inp.v0 ?? 0;
  let t = 0;
  const lo = inp.limits?.min;
  const hi = inp.limits?.max;
  let stopped: DynamicsResult['stoppedBy'];
  const nS = Math.max(2, Math.min(2000, Math.round(inp.samples ?? 200)));
  const every = Math.max(1, Math.floor(n / nS));
  const ts: number[] = [];
  const qs: number[] = [];
  const vs: number[] = [];
  let peakQ = { value: Math.abs(q), t: 0 };
  let peakV = { value: Math.abs(v), t: 0 };
  const e0 =
    0.5 * inp.inertia * v * v +
    0.5 * k * (q - q0s) ** 2 +
    (inp.gravity ? sign * inp.gravity.mass * G * inp.gravity.arm * Math.cos(q) : 0);
  const conservative =
    c === 0 && mu === 0 && !inp.drive && !inp.constantForce && lo === undefined && hi === undefined;
  let maxDrift = 0;
  const all: { t: number; q: number; v: number }[] = [];

  const record = (i: number) => {
    all.push({ t, q, v });
    if (i % every === 0 || i === n) {
      ts.push(t);
      qs.push(q);
      vs.push(v);
    }
    if (Math.abs(q) > peakQ.value) peakQ = { value: Math.abs(q), t };
    if (Math.abs(v) > peakV.value) peakV = { value: Math.abs(v), t };
  };
  record(0);
  for (let i = 1; i <= n; i++) {
    // Coulomb friction: its direction is fixed for the whole step (opposing the velocity, or the net other force when
    // starting from rest), which avoids chatter between the RK4 stages; a body at rest stays at rest while the other
    // forces are below the friction level
    const other0 = force(t, q, v);
    let fr = 0;
    let stuck = false;
    if (mu > 0) {
      if (Math.abs(v) > 1e-12) fr = -Math.sign(v) * mu;
      else if (Math.abs(other0) <= mu) stuck = true;
      else fr = -Math.sign(other0) * mu;
    }
    if (stuck) {
      v = 0;
    } else {
      const accel = (tt: number, qq: number, vv: number) => (force(tt, qq, vv) + fr) / inp.inertia;
      const k1q = v;
      const k1v = accel(t, q, v);
      const k2q = v + 0.5 * dt * k1v;
      const k2v = accel(t + 0.5 * dt, q + 0.5 * dt * k1q, v + 0.5 * dt * k1v);
      const k3q = v + 0.5 * dt * k2v;
      const k3v = accel(t + 0.5 * dt, q + 0.5 * dt * k2q, v + 0.5 * dt * k2v);
      const k4q = v + dt * k3v;
      const k4v = accel(t + dt, q + dt * k3q, v + dt * k3v);
      const vOld = v;
      q += (dt / 6) * (k1q + 2 * k2q + 2 * k3q + k4q);
      v += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
      // friction cannot reverse the motion: if the velocity changed sign and the other forces cannot overcome
      // friction, the body has stopped
      if (
        mu > 0 &&
        vOld !== 0 &&
        Math.sign(v) !== Math.sign(vOld) &&
        Math.abs(force(t + dt, q, 0)) <= mu
      )
        v = 0;
    }
    t += dt;
    if (hi !== undefined && q >= hi) {
      q = hi;
      if (v > 0) v = 0;
      stopped = 'limit-max';
    }
    if (lo !== undefined && q <= lo) {
      q = lo;
      if (v < 0) v = 0;
      stopped = 'limit-min';
    }
    if (conservative) {
      const e =
        0.5 * inp.inertia * v * v +
        0.5 * k * (q - q0s) ** 2 +
        (inp.gravity ? sign * inp.gravity.mass * G * inp.gravity.arm * Math.cos(q) : 0);
      // a characteristic energy scale, not |e0| alone (a pendulum released from horizontal has e0 close to zero)
      const ref = Math.max(
        Math.abs(e0),
        inp.gravity ? inp.gravity.mass * G * inp.gravity.arm : 0,
        0.5 * k * ((inp.q0 ?? 0) - q0s) ** 2,
        0.5 * inp.inertia * (inp.v0 ?? 0) ** 2,
        1e-12,
      );
      maxDrift = Math.max(maxDrift, Math.abs(e - e0) / ref);
    }
    record(i);
  }

  // settling: last time |q - final| exceeds 2% of the larger of |final| and the excursion
  const qf = q;
  const span = Math.max(Math.abs(qf), Math.abs(peakQ.value - Math.abs(qf)), 1e-12);
  let settle: number | undefined;
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i] as { t: number; q: number };
    if (Math.abs(s.q - qf) > 0.02 * span) {
      settle = i === all.length - 1 ? undefined : (all[i + 1] as { t: number }).t;
      break;
    }
    if (i === 0) settle = 0;
  }
  // period from rising zero crossings about the mean
  let mean = 0;
  for (const s of all) mean += s.q;
  mean /= all.length;
  const crossings: number[] = [];
  for (let i = 1; i < all.length; i++) {
    const a = (all[i - 1] as { q: number }).q - mean;
    const b = (all[i] as { q: number }).q - mean;
    if (a < 0 && b >= 0) {
      const ta = (all[i - 1] as { t: number }).t;
      const tb = (all[i] as { t: number }).t;
      crossings.push(ta + ((tb - ta) * -a) / (b - a));
    }
  }
  const period =
    crossings.length >= 2
      ? ((crossings[crossings.length - 1] as number) - (crossings[0] as number)) /
        (crossings.length - 1)
      : undefined;
  if (inp.drive && 'stall' in inp.drive && Math.abs(v) > inp.drive.noLoadSpeed * 1.001)
    warnings.push(
      'The speed exceeds the motor no-load speed: the motor is being back-driven, which this model does not capture',
    );
  if (stopped)
    warnings.push(`The motion hit its ${stopped === 'limit-max' ? 'upper' : 'lower'} stop`);

  return {
    t: ts,
    q: qs,
    v: vs,
    peakPosition: peakQ,
    peakVelocity: peakV,
    final: { q: qf, v },
    ...(settle !== undefined ? { settleTime: settle } : {}),
    ...(period !== undefined ? { period } : {}),
    ...(conservative ? { energyDrift: maxDrift } : {}),
    ...(stopped ? { stoppedBy: stopped } : {}),
    steps: n,
    warnings,
  };
}
