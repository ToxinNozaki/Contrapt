---
title: Design for CNC machining and laser cutting
summary: Rules for milled and turned parts, laser/waterjet cut sheet, finger joints and slots, and safety notes.
---
# Design for CNC machining and laser cutting

## CNC milling
- **Internal corners are round** (the cutter is round). Make internal vertical corner radius at least the tool
  radius; a little larger (about 1.3×) lets the machine cut smoothly. Common end mills: 3, 6, 10 mm diameter.
- **Pocket depth:** keep to about 3–4× the cutter diameter for easy machining (deeper needs long tools and slow
  cuts). Wider pockets are cheaper than narrow deep ones.
- **Wall thickness:** at least ~0.8 mm in metal, ~1.5 mm in plastic, thicker for tall walls (they chatter).
- **Holes:** use standard drill sizes; depth up to ~4–6× diameter is easy; threaded depth ~1–1.5× diameter is
  enough (deeper threads add little strength). Specify tap drill diameters from `fasteners-and-joints`.
- **Access:** every feature must be reachable by a tool from some side; avoid features that need many
  setups. Use one datum face and design to it.
- **Fillets at pocket floors** (radius ≥ 0.5–1 mm) are cheaper than sharp floors.
- **Avoid** very thin ribs, thin tall pins, deep narrow slots, and tight tolerances on non-critical faces.
- **Stock:** design around standard bar, plate and tube sizes; fewer cut operations = lower cost.

## Turning (lathe)
Parts are round; add chamfers on edges, thread reliefs (grooves) where threads end, and avoid thin long
unsupported sections (they flex; keep length/diameter under about 4–6 unless a steady rest is used). Shoulders
on shafts for bearings and gears; undercuts for retaining rings.

## Laser cutting (sheet: wood, acrylic, metals by fibre laser)
- **Kerf** (width of the cut) is about 0.1–0.3 mm; compensate for it in slots and press fits.
- **Smallest features:** holes and slots at least about the material thickness; keep at least 1–2× thickness
  between cuts or edges so thin webs do not burn or warp.
- **Thickness limits (typical hobby CO₂):** wood to ~6–10 mm, acrylic to ~10–20 mm (slow at the top), thin
  non-reflective sheet. Fibre lasers cut steel, stainless, and aluminium (thickness depends on power).
- **Edges** have a slight taper and burn marks on wood; acrylic edges polish clean; plan finishing.
- **Nesting:** lay parts out tightly on the sheet; tell the operator the material and thickness.
- **Finger joints and T-slots:** tab length ~2–3× thickness; slot width = thickness − kerf adjustment + a
  small fit allowance (test on scrap); add a T-slot (nut trap + screw slot) for strong screw joints.
- **Living hinges** work in thin wood/acrylic with a pattern of short cuts; fragile in acrylic.
- **DXF/SVG export** is the usual hand-off; Contrapt's flat-pattern export is planned.

## Waterjet and plasma
Waterjet cuts almost anything thick without heat damage with a wider kerf (~0.8–1 mm) and some taper;
plasma cuts conductive metals fast with a rougher edge. Keep features larger than on a laser.

## Safety notes (real hazards)
- **Never laser-cut PVC, vinyl, or anything containing chlorine**; it releases toxic gas and corrodes the
  machine. Also avoid unknown plastics; check the safety data.
- Fire risk with wood and acrylic: never leave a laser running unattended, and keep the exhaust working.
- Machining and cutting is operator-safety critical: guards, eye protection, no loose clothing, proper
  workholding. A design note is not a substitute for training.
