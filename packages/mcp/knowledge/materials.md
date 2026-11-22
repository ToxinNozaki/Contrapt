---
title: Materials
summary: Typical properties of common metals, plastics and wood, and how to pick one.
---
# Materials

**Typical values only.** They vary with grade, temper, heat treatment, print settings, moisture and supplier.
Use the datasheet for the actual material and add safety factor. E = Young's modulus, σy = yield (or
tensile strength where plastics do not yield cleanly), ρ = density.

| Material | E (GPa) | σy / tensile (MPa) | ρ (g/cm³) | Notes |
|---|---|---|---|---|
| Aluminium 6061-T6 | 69 | ~275 yield | 2.70 | Default for machined/extruded parts; weldable; good corrosion resistance |
| Aluminium 7075-T6 | 72 | ~500 yield | 2.81 | Much stronger, not weldable, less corrosion resistant |
| Mild steel (A36 / 1018) | 200 | ~250–370 yield | 7.85 | Cheap, weldable, rusts; stiff |
| Stainless 304 | 193 | ~215 yield (annealed) | 8.0 | Corrosion resistant; work-hardens; harder to machine |
| Alloy steel 4140 | 205 | 415+ (annealed); far higher heat-treated | 7.85 | Shafts, gears, high strength |
| Brass (C360) | 97 | ~310 | 8.5 | Easy to machine, bushings, fittings |
| Copper | 117 | ~70 (annealed) | 8.96 | Electrical/thermal conductor, soft |
| Titanium Ti-6Al-4V | 114 | ~880 | 4.43 | Strong and light, expensive, hard to machine |
| PLA (printed) | ~3.5 | ~40–55 in-plane | 1.24 | Easy, stiff, brittle; softens ~55–60 °C; creeps |
| PETG (printed) | ~2.1 | ~40–50 | 1.27 | Tougher than PLA; up to ~70 °C; stringy |
| ABS / ASA (printed) | ~2.2 | ~35–40 | 1.05 | Tougher, heat to ~95 °C, warps, fumes (ventilate); ASA is UV stable |
| Nylon PA12/PA6 | 1.5–2.5 | 40–70 | 1.1 | Tough, wear resistant; absorbs moisture (dry before printing) |
| Polycarbonate | 2.3 | ~60 | 1.2 | Impact resistant, ~110+ °C, hard to print |
| TPU | low (rubbery) | flexible | 1.2 | Gaskets, grips, feet; choose by Shore hardness |
| Acrylic (PMMA) | 3.2 | ~70 brittle | 1.18 | Laser-cuts cleanly with polished edge; cracks at holes/notches |
| Acetal / Delrin (POM) | 3.1 | ~65 | 1.41 | Machines well, low friction, gears and bushings |
| Birch plywood | ~9–12 along grain | varies | 0.6–0.7 | Laser/CNC; strong in-plane, weak across plies |
| Hardwood (oak/maple) | ~11–13 along grain | varies | 0.6–0.75 | Strong along the grain, weak across; moves with humidity |

## Thermal expansion (per °C, × 10⁻⁶)
Steel ~12; stainless ~17; aluminium ~23; brass ~20; PLA ~68; ABS ~90; nylon ~80. A 300 mm aluminium part
grows about 0.14 mm over a 20 °C change; plastics several times more. Mixing plastics with metals in tight fits
needs clearance or slots.

## Thermal properties (typical, used by thermal_analysis)
| Material | k (W/m·K) | α (× 10⁻⁶ /K) |
|---|---|---|
| Aluminium 6061-T6 | 167 | 23.6 |
| Aluminium 7075-T6 | 130 | 23.4 |
| Mild steel (A36 / 1018) | 50 | 12 |
| Stainless 304 | 16 | 17.3 |
| Alloy steel 4140 | 42 | 12.3 |
| Brass (C360) | 115 | 20.5 |
| Copper | 390 | 17 |
| Titanium Ti-6Al-4V | 6.7 | 8.6 |
| PLA (printed) | 0.13 | 68 |
| PETG (printed) | 0.2 | 60 |
| ABS / ASA (printed) | 0.17 | 90 |
| Nylon PA12/PA6 | 0.25 | 80 |
| Polycarbonate | 0.2 | 65 |
| Acrylic (PMMA) | 0.19 | 70 |
| Acetal / Delrin (POM) | 0.31 | 110 |
| Birch plywood | 0.13 | varies |
| Hardwood (oak/maple) | 0.17 | varies |

Values are typical handbook numbers: plastics vary with grade, filler and print settings, and wood expansion depends on the
grain direction, so no single number is given. Use the supplier datasheet for anything that matters. Metals conduct tens to
hundreds of times better than plastics, which is why a heat sink must be metal and a handle should not be.

## Choosing a material
- **Stiffness per weight** (E/ρ) is nearly the same for steel, aluminium and titanium; shape matters more
  than alloy for stiffness. Pick steel when cheap and stiff matters, aluminium when light matters.
- **Strength per weight** favours aluminium 7075, titanium, and heat-treated steel.
- **Prototyping and low volume:** PLA/PETG for fit and concept, nylon or PETG for functional parts,
  aluminium or acetal for machined parts.
- **Wear / sliding:** acetal, nylon, brass or bronze bushings, hardened steel shafts.
- **Outdoors:** ASA, PETG, stainless, anodised aluminium, galvanised steel; avoid PLA and untreated wood.
- **Heat:** PLA no; PETG moderate; ABS/ASA/PC higher; metals high. Check the operating temperature first.
- **Electrical:** copper/brass conduct; most plastics and wood insulate (but check the datasheet).
- **Food or skin contact, or anything regulated:** needs the correct certified material. Do not assume.

## Mass from volume
mass (g) = volume (mm³) × density (g/cm³) / 1000. Use `measure` for volume, then convert. Example: 16 400 mm³
of aluminium ≈ 16 400 × 2.70 / 1000 ≈ 44 g.
