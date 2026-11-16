---
title: Design failure modes (red-team checklist)
summary: A checklist of the ways real designs commonly fail, for design reviews and "what could go wrong".
---
# Design failure modes: red-team checklist

Run through this list when reviewing a design. For each item, say *checked / not applicable / risk found*,
with numbers where possible.

## Mechanical
- **Overstress / yielding:** compare worst-case stress to yield with a safety factor (`strength-and-stiffness`).
- **Excess deflection:** floppy arms, sagging shelves, misaligned bearings. Check against the function.
- **Buckling:** slender compression members, thin walls under compression or shear.
- **Fatigue:** repeated loading, sharp corners, holes near edges, welds; likely over ~10⁴ cycles.
- **Stress concentrations:** sharp internal corners, thin sections next to thick, holes in tension.
- **Creep and cold flow:** plastics under constant load (PLA clips, screws into plastic) loosen over weeks.
- **Impact and shock:** brittle materials (PLA, acrylic, cast iron) crack; add radii or use tougher material.
- **Wear and friction:** sliding plastic on plastic, unlubricated metal on metal, edges that rub.
- **Loosening fasteners:** vibration; add thread-locker, locking nuts, or a locking design.
- **Thread stripping:** screws in thin plastic, aluminium with short engagement, over-torque.
- **Bolted-joint slip or fretting:** too few or too small fasteners; no preload.
- **Misalignment and over-constraint:** two bearings plus a rigid coupling, three rails on one carriage; the
  mechanism binds as parts expand or flex.
- **Backlash and play** that ruins positioning; compliance in mounts.
- **Resonance:** a panel or beam that vibrates at the motor's operating speed.
- **Tipping or falling.** CoG height vs base width; hidden dynamic loads.

## Thermal and environmental
- **Heat softening/deformation:** PLA near motors or in sun; adhesives that release warm.
- **Thermal expansion:** mixed materials (plastic on metal), long runs, tight clearances that bind when hot.
- **Moisture and corrosion:** nylon swells, steel rusts, galvanic corrosion between dissimilar metals in
  contact with water (aluminium and steel/copper), wood warps.
- **UV and outdoors:** PLA/PETG degrade; ASA, stainless, and coatings last.
- **Dust, ingress, and cleaning:** gaps for fingers and dirt; sealing; drainage.

## Electrical and control
- Brownouts and voltage sag when motors start; shared grounds; EMI from motors into sensors.
- Overcurrent, stalls, and thermal overload; no fuse; reversed polarity.
- Missing end-stops, no emergency stop, runaway if software crashes.
- Batteries: mounting, venting, charge protection (see `motors-power-and-electronics`).

## Manufacturing and assembly
- **Unmakeable features:** zero-radius internal corners in CNC, undercuts in molds, overhangs without support in
  printing, features thinner than the process allows.
- **Tolerance stack-up:** parts do not assemble or rattle; no adjustment provided.
- **Assembly order impossible,** or no tool access for screws, wrenches, or fingers; captive parts that
  cannot be inserted.
- **Cost and lead-time traps:** tiny tolerances, unusual stock sizes, many setups.
- **Serviceability:** can you replace the wearing part without destroying the rest?

## Human factors
Misuse and foreseeable abuse; pinch points and sharp edges; unclear orientation (parts that fit backward);
instructions missing; failure that is silent or dangerous (see `safety-and-ethics`).

## Review output format
List the top 3–5 risks ranked by (likelihood × consequence), the evidence or calculation for each, the
suggested change, and what remains unverified.
