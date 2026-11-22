---
title: Thermal and fluids basics
summary: Thermal expansion, conduction and cooling, thin-wall pressure, pneumatic/hydraulic force, simple flow estimates.
---
# Thermal and fluids basics

Fluids and transient heating are hand estimates only (Contrapt has no flow simulation). Steady-state conduction and convection can be solved with `thermal_analysis` (heat paths, temperatures, thermal stress): use the convection coefficients below as inputs. Pressurised systems are a real safety
hazard: see `safety-and-ethics`.

## Thermal expansion
ΔL = α L ΔT. Aluminium α ≈ 23×10⁻⁶ /°C, steel ≈ 12×10⁻⁶, PLA ≈ 68×10⁻⁶. Fixed constraints between different
materials create stress or warp; allow slots, floating joints or clearance. Example: a 500 mm aluminium
rail warms by 30 °C → ΔL = 23×10⁻⁶ × 500 × 30 ≈ 0.35 mm.

## Heat transfer
- **Conduction:** Q = k A ΔT / L (W). k ≈ 200 W/m·K aluminium (alloys 130–180), 400 copper, 50 steel, 15
  stainless, 0.2 plastics, 0.026 air.
- **Convection:** Q = h A ΔT. h ≈ 5–25 W/m²K for still air (natural), 25–250 with a fan; liquids far higher.
- **Radiation** matters above ~100 °C or in vacuum; black surfaces radiate and absorb better than shiny ones.
- **Steady-state temperature:** T = T_ambient + P × R_θ, where R_θ is the total thermal resistance (°C/W).
  Heat sinks lower R_θ with more surface area (fins) and airflow; fin gaps of ≥ 3–5 mm work for natural convection.
- Electronics: check junction/case limits on the datasheet; keep PLA and other low-temperature plastics away
  from motors, regulators, and sun-heated enclosures (cars reach 70 °C+ in summer).

## Thin-wall pressure vessels (small pressure, thin wall t ≪ radius r)
Hoop stress σ_h = p r / t; axial stress σ_a = p r / (2 t). Units: p in MPa, r and t in mm gives MPa. Real vessels
need code-compliant design (pressure rating, safety factor ≥ 4, burst testing). **Do not design or build
pressure vessels or air tanks beyond very low pressure without qualified review and testing.** Stored
compressed gas releases energy violently when something fails; water-filled (hydrostatic) tests are safer
than air tests.

## Pneumatics and hydraulics
- Force F = p × A. For a cylinder of bore d: A = π d² / 4. p in MPa and A in mm² gives N. Example: 40 mm bore at 0.6 MPa
  (6 bar) → A = 1257 mm² → F ≈ 754 N (extend), less on the rod side (area minus the rod).
- Speed = flow rate / area; size tubing to avoid choking (bigger bores = faster).
- Hydraulics use incompressible oil at much higher pressure for large force in small space; leaks and hot
  oil injection are hazards; use rated hoses and fittings.

## Simple flow estimates
- Volume flow Q = A × v. Reynolds number Re = ρ v D / μ: below ~2300 pipe flow is laminar, above ~4000 turbulent.
- Bernoulli (frictionless): p + ½ ρ v² + ρ g h = constant; friction losses grow with v² and length.
- Fans: choose by airflow (CFM or m³/h) at the system's back-pressure, not the free-air number. Mount so
  the airflow passes over the hot parts, with inlet and outlet vents; filter dust where needed.

## Heat and plastics in enclosures
Add vents high and low (convection), standoffs for boards, thermal pads for power parts, and metal
heat spreaders. Keep walls near hot components at least 3–5 mm away for PLA/PETG, or use ABS/ASA/nylon.
