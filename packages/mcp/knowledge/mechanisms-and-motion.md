---
title: Mechanisms and motion
summary: Degrees of freedom, linkages (Grashof), slider-cranks, gears, belts, lead screws, cams, springs, bearings, levers.
---
# Mechanisms and motion

Contrapt has no motion simulation yet: check mechanisms by hand (this pack) and by placing bodies at the
extremes of travel and measuring clearances.

## Degrees of freedom
- Planar mechanism (Gruebler): M = 3(n − 1) − 2 j₁ − j₂, where n counts links including the fixed frame,
  j₁ is the number of one-DOF joints (pins, sliders), j₂ is two-DOF joints (cam/gear contacts). M = 1 means a
  single input drives it. M ≤ 0 means locked or over-constrained: it binds unless parts flex.
- Avoid over-constraint: two bearings plus a rigid coupling to a misaligned shaft, or a rigid frame with
  three or more rails, will bind. Use compliance (a flexible coupling, a floating bearing, slotted holes).

## Four-bar linkages
Lengths: shortest s, longest l, the other two p and q. **Grashof:** if s + l ≤ p + q at least one link can
rotate fully (crank-rocker, double-crank, or double-rocker depending on which is fixed). Otherwise every link only
rocks. Keep the transmission angle (between coupler and output link) between about 40° and 140° so the
mechanism does not lock at the extremes.

## Slider-crank
Crank radius r, connecting-rod length l. Stroke = 2 r. Piston/slider position
x = r cos θ + √(l² − r² sin²θ). Keep l ≥ ~3 r for smooth motion. Torque varies with angle; a flywheel smooths it.

## Gears (involute spur, 20° pressure angle)
- Module m (mm) = pitch diameter / teeth; pitch diameter d = m × z; outside diameter = m (z + 2).
- Center distance a = m (z₁ + z₂) / 2; ratio = z₂ / z₁ (output speed = input × z₁/z₂); output torque ×z₂/z₁ × efficiency.
- Meshing gears must share the same module and pressure angle.
- Practical minimum teeth ~17 (fewer undercuts the tooth unless profile-shifted); use 14+ only with shifted gears.
- Backlash: roughly 0.05–0.1 × module for machined gears; printed gears need ≥ 0.2–0.4 mm of extra center
  distance. Efficiency per spur stage ≈ 95–98% (printed lower); worm gears are 40–90% and often self-locking.
- Helical gears are quieter but add axial thrust; bevel gears turn axes 90°.
- Gear ratio per stage is practical up to ~5–6:1; chain stages for more.
- Worked example: motor at 3000 rpm and 0.1 N·m through 20T→60T gives 1000 rpm, torque ≈ 0.1 × 3 × 0.95 ≈ 0.29 N·m.

## Belts and chains
Timing belts (GT2: 2 mm pitch): pulley pitch diameter = teeth × pitch / π (20 teeth → 12.7 mm). Speed ratio
as gears. Needs tensioning (idler or adjustable motor); no slip, low noise. V-belts and round belts slip,
which can be useful as a torque limiter. Chains handle high loads and need lubrication.

## Screws (lead screws and ball screws)
- Lead L (mm per revolution) = pitch × number of starts. Linear speed v = L × rpm / 60.
- Axial force from torque: F = 2 π η T / L (η efficiency). Trapezoidal (ACME) with bronze nut η ≈ 0.2–0.4;
  ball screws ≈ 0.9 and back-driveable.
- A screw self-locks if friction angle exceeds lead angle: many trapezoidal screws hold a load unpowered; ball
  screws do not (add a brake).
- Whip limits long thin screws at high speed; support both ends.

## Cams and followers
Rise/dwell/return profile; keep pressure angle ≤ ~30° for roller followers; use smooth (not constant-
acceleration) motion laws to avoid jerk; spring or groove keeps the follower on the cam.

## Springs
Coil compression spring rate k = G d⁴ / (8 D³ N) (G shear modulus, d wire dia, D mean coil dia, N active
coils); F = k x. Do not compress to solid; keep at least 10–15% of travel as margin. Torsion and
extension springs have their own limits; pick catalogue springs.

## Bearings, bushings, shafts
- Plain bushings (bronze, acetal, nylon, PTFE) are cheap and quiet at low speed and load.
- Ball bearings (e.g., 608, 6200 series) carry radial load, some axial; support a shaft with two
  bearings spaced apart (a few times the bearing width) so it cannot tilt.
- Linear: round rods with linear bearings or bushings, profile rails, or V-wheels on aluminium extrusion.
- Use shoulders, circlips, or collars to fix axial position; fit housings and shafts per
  `tolerances-and-fits`.

## Levers and mechanical advantage
F₁ × L₁ = F₂ × L₂ about the pivot. Pulleys: n supporting rope segments give n× force at n× the rope travel
(ideal). Inclined plane: force along slope = m g sin θ.

## Checking a mechanism in Contrapt today
Model the moving part at both ends of travel and at mid positions (use `transform`), then `measure` clearances
and check nothing intersects, and that hardware stays within envelope. Report what was verified by position.
