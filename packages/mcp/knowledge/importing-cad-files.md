---
title: Importing files from other CAD programs
summary: What Contrapt can read today (STEP), how to get Inventor/SolidWorks/Fusion/etc. files in, units, assemblies, drawings, and what is planned.
---
# Importing files from other CAD programs

## What works today
- **STEP (.step / .stp)** imports as exact solids. After import you can measure, cut, fillet, shell, transform,
  and export it like any other body.
- Everything else is **recognised and explained** (`inspect_file`) so you can give the user the right next step,
  but is not readable yet.

## Workflow
1. Ask the user to place the file in the **imports folder** (`<output folder>/imports`). You never pass paths,
   only plain file names.
2. `inspect_file` with no name lists what is there; `inspect_file {file}` says what the file is, whether it can
   be imported, and how to convert it if not. For STEP it also reports the schema, the originating program, and
   the solid and product counts.
3. `import_file {file}` adds an `import` step to the timeline and rebuilds. A checksum is recorded: if the file
   changes later the build fails clearly instead of silently using different geometry.
4. **Verify the import with `measure`:** compare the bounding box and volume with what the user expects. If it is
   25.4× too small or large, the units were inches vs mm: use `scale` (for example `25.4`).
5. Edit by adding steps on top (cuts, holes, fillets). The imported body keeps its id.

## Autodesk Inventor files
- **.ipt (part)** and **.iam (assembly):** closed, proprietary formats. Contrapt cannot read them directly yet.
  Ask the user to open the file in Inventor and use File > Export > CAD Format > STEP. Without Inventor,
  Autodesk's free Inventor View and Autodesk's cloud converter (Model Derivative) can produce STEP/OBJ/STL from
  IPT and IAM files (an Autodesk account is needed for the cloud route).
- **.iam assemblies** only *reference* their parts: export with all referenced files present. A STEP assembly
  arrives as a single body holding several solids (the structure is not kept as joints; mates are lost).
- **.idw (drawing):** a 2D sheet of views, dimensions and notes. It has no 3D geometry of its own. The 3D model
  is in the referenced .ipt/.iam. Export the drawing to PDF or DXF/DWG from Inventor for the 2D content; Contrapt
  will treat imported drawings as reference only. Do not claim to have "read the drawing's dimensions" unless the user
  gave you the text of them.
- **.ipn (presentation):** exploded views and animations only; export the assembly instead.
- **iLogic rules, iProperties, features history:** not in a STEP file. If the user needs the original parametric
  history, it stays in Inventor; you can rebuild the key dimensions as Contrapt parameters from their description.

## What `inspect_file` reads from an Inventor file today (no Inventor needed)
- The Inventor version that saved it (for example "2026.4"), part number, material name, author/title if set, and the
  container facts (how many data segments it holds).
- The **embedded preview image** (a PNG, often 512×512), returned as a real image so you can look at it, and saved
  under `previews/`. This is one isometric view: it has no dimensions and hides back faces and internal features.
- It does **not** read the geometry. If asked for dimensions or features, say so; do not estimate them from the picture
  as if they were measured. Use the `recreate_from_reference` playbook to rebuild approximately, labelled as approximate.

## Converters that may read the geometry (status)
An open-source command-line project (cadmpeg) advertises Inventor part/assembly decoding and STEP output, with a
published support envelope (specific container/schema versions; read-only; no feature history; assemblies and design
intent only partly). It has been verified on a real Inventor 2026.4 part (geometry decoded and imported exactly; sketches, features and history were not transferred), but coverage varies by file version, so it is only known by trying. Treat any
such converter as optional and external: results must be checked with `measure` against known dimensions.

If the user has enabled a converter, `convert_file {file}` writes `<name>.converted.step` next to the original; then
`import_file` that. If `convert_file` says no converter is configured, or the conversion fails (common for the newest file
versions), fall back to asking for a STEP export, or `recreate_from_reference`. Never present a converted body as exact
until its size matches what the user knows.

## Other programs (all via STEP)
SolidWorks (.sldprt/.sldasm), Fusion (.f3d), CATIA, NX/Creo (.prt), Rhino (.3dm), FreeCAD (.fcstd): export STEP.
Meshes (STL, OBJ, 3MF, glTF, SketchUp, Blender) have no exact faces: they are approximate, and a mesh importer
is planned; editing them as solids is not possible.
2D DXF/DWG will come as sketch/reference geometry.

## Things to tell the user honestly
- An imported STEP is a *dumb solid*: no feature history, no named parameters. You can add to it but not change its
  original dimensions unless you rebuild it.
- Names and colours from the source are not kept.
- Very large assemblies can be slow; export a sub-assembly or the one part you need.
- If the import fails, read the message: it usually names the problem (not a solid, a surface-only model,
  a corrupt file). Suggest re-exporting with "solid" bodies selected.

## Planned direct support (see the roadmap)
Native readers and bridge adapters for Inventor files (a local Inventor automation bridge on Windows, an Autodesk
cloud converter adapter using the user's own credentials, and evaluation of the open-source Inventor codec), plus
IGES, mesh, DXF and glTF importers. Until they exist, STEP is the route.
