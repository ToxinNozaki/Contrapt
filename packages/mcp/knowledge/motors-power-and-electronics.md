---
title: Motors, power and electronics integration
summary: Sizing motors and gearing, steppers vs servos, batteries and runtime, wiring and fusing, thermal and safety notes.
---
# Motors, power and electronics integration

Contrapt models enclosures and mechanics, not circuits. Use this pack to size drive systems and leave space
for electronics, wiring and cooling.

## Basic relations
- Mechanical power P (W) = T (N·m) × ω (rad/s), ω = 2 π rpm / 60. Torque T = F × r (force × lever arm).
- Electrical power P = V × I. Battery energy (Wh) = V × Ah. Runtime (h) ≈ Wh × efficiency / average W.
- Output torque after gearing = motor torque × ratio × η, with η ≈ 0.9 per spur stage (lower for printed).

## Sizing a drive: steps
1. **Load torque.** Lifting a mass at radius r: T = m g r. Add acceleration: T = J α (J moment of inertia,
   α angular acceleration). Add friction.
2. **Speed.** Required output rpm (from travel and time).
3. **Margin.** Choose a motor that gives at least 2× the required torque at the working speed (stepper: operate
   at no more than 50–70% of rated torque *at that speed*; DC: keep continuous torque ≤ about 30–50% of stall).
4. **Gearing.** ratio = motor speed / output speed; check output torque including η.
5. **Power, heat, battery.** Compute electrical power with motor efficiency (brushed 60–80%, brushless 80–90%,
   stepper poor and constant draw when holding) and size the battery and wiring.

## Wheeled robot example
Force to move: F = m a + m g sin θ + C_rr m g (C_rr ≈ 0.01–0.02 on hard floor). Wheel torque = F × wheel radius
(per driven wheel: divide by the number of driven wheels). Speed v = ω × r. Example: 5 kg, 0.5 m/s², flat
floor, 50 mm wheel radius, two driven wheels: F ≈ 5 × 0.5 + 0.015 × 5 × 9.81 ≈ 3.2 N → wheel torque per wheel
≈ 3.2 × 0.05 / 2 ≈ 0.08 N·m. Check gear ratio for the motor's speed.

## Motor types
- **Brushed DC:** simple, cheap, torque ∝ current, speed ∝ voltage; wears; needs a driver (H-bridge).
- **Brushless (BLDC):** efficient, long life, needs an ESC/driver; good for fans, drones, gimbals.
- **Stepper:** open-loop positioning, high holding torque, torque drops sharply with speed, can lose steps;
  use microstepping and enough current; gets hot when holding.
- **Servo / closed loop:** feedback gives precision and torque at speed; costlier. Hobby servos have gearboxes
  with limited torque and ~180° range.
- **Linear actuators:** force and stroke given by the screw; usually slow and self-locking.

## Gearbox selection
Planetary: compact, efficient, moderate backlash. Worm: high ratio, self-locking, inefficient. Harmonic and
cycloidal: very low backlash, expensive. Printed gears: prototypes only for loads near the printed material's limits.

## Power and wiring (rough guidance; check your parts' ratings and local code)
- Fuse the battery positive close to the battery; pick a fuse above the normal load current but below the wire's rating, so it protects the wiring.
- Indicative continuous current for short hookup wire: 22 AWG ≈ 3–5 A, 18 AWG ≈ 10 A, 14 AWG ≈ 15–20 A.
  Longer runs and bundles need heavier wire. Voltage drop matters for motors and LEDs.
- Add a master switch/e-stop for anything that moves with force; separate logic and motor power with a common ground.
- Mains voltage (110/230 V) is lethal: use a certified enclosure and have a qualified person design and
  check it. Do not design exposed mains wiring.
- **Lithium batteries (LiPo, Li-ion):** do not puncture, crush, short, overcharge or over-discharge; charge
  on non-flammable surfaces with the right charger; use a BMS; allow venting space; do not mount where an
  impact can crush them.

## Fitting electronics into a model
Reserve volume for the board, connectors, and wire bends (at least 3–5× the wire diameter radius); leave
access for plugs and a USB port; screws for boards with standoffs ≥ 3 mm; ventilation slots or heat paths for
power electronics; keep batteries and motors away from heat-sensitive plastic; leave cable routing channels.

## Thermal
Steady-state temperature rise ≈ P_loss × R_θ (thermal resistance in °C/W). Motor, driver and regulator losses
heat the enclosure; PLA softens at ~55–60 °C. See `thermal-and-fluids`.
