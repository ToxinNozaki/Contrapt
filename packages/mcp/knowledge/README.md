# Engineering knowledge packs

Each `.md` file here is one **topic** that AI assistants can read through Contrapt (`list_knowledge`,
`get_knowledge`, MCP resources `contrapt://knowledge/<topic>`) and that the **playbooks** (advanced prompts, see
`src/prompts.ts`) embed. This is how Contrapt gives an AI real engineering knowledge, and it is designed to grow:
add a file, open a pull request.

## Adding or improving a pack
1. Create `topic-name.md` (lowercase, hyphens). The file name is the topic id.
2. Start with front matter:
   ```
   ---
   title: Human-readable title
   summary: One line saying what is in it and when to use it
   ---
   ```
3. Write for an AI that has to *act*: formulas with units, typical values with ranges, rules of thumb flagged as such,
   worked examples with real arithmetic, checklists, and "what to tell the user".
4. Be honest. Mark typical values as typical. Never imply Contrapt does something it does not (no simulation yet).
   Say when a qualified engineer must review something.
5. Check every number and formula against a reputable source and work the example yourself. A confident wrong
   number is worse than no number.
6. Run `npm test`: it checks front matter, that links between packs resolve, and that no personal paths slipped in.

## Ideas for new packs
Gears in depth (strength, lubrication), welding design, springs, fluid power circuits, bearings selection,
vibration and acoustics, composite layups, electronics enclosures and EMC, woodworking joinery, CNC fixturing, 3D
printing materials in depth, cost estimating, accessibility and ergonomics, hydraulics, optics mounting, cryogenics,
marine, aerospace practices (with the right safety framing).
