---
title: Strength and stiffness
summary: Hand-calculation formulas for stress, beams, deflection, buckling, torsion, safety factors, with a worked example.
---
# Strength and stiffness (hand calculations)

Units: mm, N, MPa (= N/mm²). Small-deflection linear elasticity; valid below yield. Always sanity-check.

## Stress
- Axial: σ = F / A.  Axial stretch: δ = F L / (A E).
- Bending: σ = M c / I = M / S, where c is the distance to the outer fibre and S = I / c.
- Shear (average) τ = V / A; for a rectangular section the peak is about 1.5 V / A.
- Torsion, solid round shaft: τ = T r / J with J = π d⁴ / 32; twist θ = T L / (G J) (radians).
- Combine bending + axial by adding stresses at the critical point; for combined bending + torsion use
  von Mises: σ_vm = √(σ² + 3 τ²).

## Section properties (I about the bending axis)
- Rectangle b wide, h deep (bending in the h direction): I = b h³ / 12. **Depth counts cubed.**
  Doubling depth makes it 8× stiffer; doubling width only 2×.
- Solid round: I = π d⁴ / 64.  Round tube: I = π (D⁴ − d⁴) / 64.
- Rectangular tube: I = (b h³ − b_i h_i³) / 12.
- Tubes and I-shapes give far more stiffness per mass than solid bars. Ribs add depth cheaply.

## Beam cases (L = span, E = modulus, w = load per mm)
| Case | Max deflection | Max moment |
|---|---|---|
| Cantilever, tip load F | F L³ / (3 E I) | F L (at the wall) |
| Cantilever, uniform w | w L⁴ / (8 E I) | w L² / 2 |
| Simply supported, centre load F | F L³ / (48 E I) | F L / 4 |
| Simply supported, uniform w | 5 w L⁴ / (384 E I) | w L² / 8 |
| Fixed-fixed, centre load F | F L³ / (192 E I) | F L / 8 |

Common deflection limits for visible/precision parts: L/360 or tighter; machines: depends on the function.

## Buckling of slender columns (Euler)
P_cr = π² E I / (K L)², with effective-length factor K: pinned-pinned 1.0, fixed-free 2.0,
fixed-pinned 0.7, fixed-fixed 0.5. Use the smallest I. Applies only to long slender members; short ones
fail by crushing. Apply a safety factor of at least 3 to buckling loads.

## Stress concentrations
Holes, notches, and sharp internal corners raise local stress: a small round hole in a plate in tension is
about 3× the nominal stress. Add generous radii (at least 0.5–1× the wall thickness at internal corners),
keep holes away from edges and from each other (at least 2 hole diameters), and avoid loading across
thin sections.

## Safety factors (rules of thumb, compare to *yield* for ductile materials)
- Known static loads, ductile metal: 1.5–2.
- Uncertain loads or consequences moderate: 2–3.  Impact, shock, or uncertain use: 3–5.
- Brittle materials, 3D-printed plastics, glued joints: 3–5 or more.
- Fatigue (repeated loading), vibration, people at risk: use more, and get qualified review.

## Fatigue in one paragraph
Repeated loads cause cracks at stress well below yield. Steels have roughly an endurance limit near half the
ultimate strength under ideal conditions; aluminium has no true limit. Notches, welds, surface finish, and
corrosion cut it sharply. If a part sees more than about 10⁴ load cycles, treat fatigue as the likely
failure mode and avoid sharp corners.

## Printed and plastic parts
FDM prints are weakest across layer lines (often 30–60% of in-plane strength); orient the part so loads run
along layers, not across them. Plastics creep (slowly deform) under constant load and soften with heat:
PLA softens near 55–60 °C, so avoid it in hot cars or near motors.

## Worked example
Aluminium 6061 cantilever arm, 100 mm long, 20 mm wide, 5 mm thick (bending in the 5 mm direction),
50 N tip load, E = 69 000 MPa, yield about 276 MPa.
- I = 20 × 5³ / 12 = 208.3 mm⁴.
- Tip deflection δ = 50 × 100³ / (3 × 69 000 × 208.3) ≈ 1.16 mm.
- Max stress at the wall: σ = M c / I = (50 × 100) × 2.5 / 208.3 ≈ 60 MPa → safety factor ≈ 276 / 60 ≈ 4.6.
Deflection (not strength) is what limits this arm. Making it 8 mm deep cuts deflection by (8/5)³ ≈ 4×.
