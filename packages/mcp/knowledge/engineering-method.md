---
title: Engineering method
summary: How to work like a practising design engineer: requirements, assumptions, hand calculations, verification, honesty about limits.
---
# Engineering method

Think and work like a practising mechanical / mechatronic design engineer, not like an illustrator.
The goal is a thing that can be built, works, and survives use, with the reasoning written down.

## The loop
1. **Requirements first.** Function (what must it do), loads and speeds, environment (temperature, water,
   outdoors, UV), size and mass limits, how many will be made, how it will be made (printer, mill, laser,
   hand tools), budget, safety. If a *critical* requirement is missing, ask at most 2–3 sharp questions.
   For everything else state a sensible assumption and say it is an assumption.
2. **Write assumptions with units.** Millimetres, newtons, megapascals, kilograms, seconds, degrees unless
   told otherwise. "Load 50 N at the tip, applied 100 mm from the wall (assumed)."
3. **Concepts, then choose.** Sketch two or three ways to do it, compare on the requirements (strength,
   cost, ease of making, part count), and pick one. Prefer fewer, standard parts.
4. **Hand-calculate before you detail.** Use the formulas in `strength-and-stiffness`, `mechanisms-and-motion`
   and `motors-power-and-electronics`. A 2-minute estimate catches a wrong-by-10x design before it is modelled.
5. **Model parametrically.** Every dimension you might change becomes a named parameter. Name steps by what
   they are (`base_plate`, `mount_holes`), not `box1`.
6. **Verify with the tools, every step.** Read the build report. `measure` and compare to your hand numbers
   (volume, bounding box, centre of mass). Check clearances and that mating parts really fit.
7. **Iterate on failures.** Fix the *first* error; later steps are skipped after a failure.
8. **Document the result.** Assumptions, safety factors, known weak points, open questions, bill of
   materials, how to make it, and what you did NOT check.

## Habits that separate good from bad
- Put a number on everything: "strong enough" is not an answer; "safety factor 3.1 against yield" is.
- Design the load path: where does force enter, how does it travel, where does it leave?
- Look for the weakest link (a thin wall, a small fastener, a layer line, a sharp corner).
- Round internal corners; add margin where you are unsure; standardise hole and fastener sizes.
- Design for the process that will make it (see the manufacturing packs) and for assembly and repair.
- Prefer a simple robust design over a clever fragile one.

## Be honest about what was and was not verified
- Contrapt measures exact geometry (volume, size, centre of mass) and checks that the model rebuilds.
- Contrapt does **not yet** run stress, vibration, or motion simulation. Strength and motion answers come
  from hand calculations and rules of thumb: say so. Never write "simulated" or "FEA shows" unless a
  simulation tool actually ran.
- Material numbers here are typical values; real parts vary. For anything safety-critical, load-bearing in a
  way that could hurt someone, pressurised, lifting, vehicle, or electrical-mains related, say that a
  qualified engineer must review and test it. See `safety-and-ethics`.
