# Setting up Contrapt with your AI

Contrapt is an MCP server. Any AI app that can run a local MCP server can drive it. When the server
starts it also opens a **live 3D viewer** on localhost, so you can watch the model appear as the AI builds it.

> **Status: early.** Contrapt is pre-release. The stdio server below is tested end to end with the official
> MCP client library. It has not yet been verified inside every AI app; if one misbehaves, please open an
> issue with the app name and what you saw.

> **Coming from npm?** Once published, `claude mcp add contrapt -- npx -y contrapt` is all you need (no clone). The package is built and
> smoke-tested from a clean install on every push; publishing is the owner's step. Until then, use the clone-based setup below.

## 1. Requirements

- **Node.js 22.18 or newer** (check with `node -v`). Contrapt runs TypeScript directly, so no build step is needed.
- About 100 MB of disk (most of it is the OpenCASCADE geometry engine).

## 2. Install

```bash
git clone https://github.com/ToxinNozaki/Contrapt.git
cd Contrapt
npm install
```

Try it without an AI first. This shows a sample bracket in the viewer:

```bash
npm run demo -w @contrapt/mcp
```

Open the printed address (usually `http://localhost:4317/`). Drag to orbit, scroll to zoom, double-click to fit.

## 3. Connect your AI

> **Easiest:** run `npm run setup-help` in the Contrapt folder. It prints the exact commands and JSON for
> your machine with the real path already filled in. (Pasting `/path/to/Contrapt` literally is the most
> common mistake: the server then "connects" to nothing and fails.)

In every case the server command is the same:

```
node /path/to/Contrapt/packages/mcp/src/cli.ts
```

Replace `/path/to/Contrapt` with where you cloned it (on Windows, something like `C:\path\to\Contrapt`).
Exports and saved models go in a `contrapt-out` folder in the directory the AI app starts the server from;
change it with `--out /some/folder` or the `CONTRAPT_OUT` environment variable.

### Claude Code

Verified working: after adding, `claude mcp list` shows `contrapt` as **Connected**.

```bash
claude mcp add contrapt -- node /path/to/Contrapt/packages/mcp/src/cli.ts
```

### Claude Desktop

Open Settings, then Developer, then Edit Config, and add:

```json
{
  "mcpServers": {
    "contrapt": {
      "command": "node",
      "args": ["/path/to/Contrapt/packages/mcp/src/cli.ts"]
    }
  }
}
```

Restart Claude Desktop. You should see the Contrapt tools listed.

### LM Studio and other local-model apps

Apps that support MCP servers over stdio (LM Studio, and most editors with MCP support) take the same
`command` and `args` as above in their MCP settings file (often `mcp.json`). Local models work best with a
tool-calling model of at least 7B parameters; smaller models tend to struggle with the exact step format.

### ChatGPT and other remote apps (MCP over HTTP)

Some apps only talk to MCP servers over HTTP. Contrapt can serve MCP that way:

```bash
node /path/to/Contrapt/packages/mcp/src/cli.ts --http 4318
```

The endpoint is `http://localhost:4318/mcp`. It listens on your computer only, accepts only `localhost` as the Host, and
all connected clients share the one live design (so the viewer shows everything).

**Reaching it from the internet is your decision and needs a secret.** A remote app cannot see `localhost`, so you would run a
tunnel yourself (for example Cloudflare Tunnel or ngrok) and then start Contrapt with the tunnel's host name and a token:

```bash
node /path/to/Contrapt/packages/mcp/src/cli.ts --http 4318 --token "a-long-random-secret" --allow-host my-tunnel.example.com
```

Contrapt **refuses to start** with `--allow-host` and no token, because an open public server would let anyone edit your models and
write files in your output folder. Clients must send `Authorization: Bearer <token>`.

> **Honest status:** the HTTP transport is tested with the official MCP client library (sessions, token, host and origin checks).
> It has **not** been tried with ChatGPT itself. ChatGPT's connector settings decide which authentication styles they accept, and a
> plain bearer token may not be one of them. If you try it, please report what you find.

## 4. First prompts to try

- "Call get_docs, then model a 60 × 40 × 6 mm mounting plate with four 5 mm holes, 4 mm rounded corners, and
  a 9 mm radius boss in the middle. Measure it and show me the viewer link."
- "Make the plate thickness a parameter, then change it to 10 mm."
- "Export it as STEP and STL."

The AI gets a build report after every change (which steps worked, plus measured volume, size and centre of
mass), so it can check its own work and fix mistakes.

## 4b. Make the AI think like an engineer

Contrapt ships **engineering knowledge** (materials, strength formulas, fasteners, tolerances, 3D printing, CNC/laser,
sheet metal, molding, mechanisms, motors, thermal, structures, robotics, safety, failure modes) and **playbooks**
(advanced prompts). Start a conversation with:

- "Use the Contrapt `engineer` playbook." (or pick the **engineer** prompt in apps with a prompt menu)
- "Use the `design_part` playbook: a bracket that holds a 3 kg shelf, 3D printed in PETG."
- "Use the `design_review` playbook on the current model."

Other playbooks: `proof_loop` (requirements, checks, optimise, Build Pack), `design_for_process`, `strength_check`, `size_mechanism`,
`brainstorm_invention`, `recreate_from_reference`, `explain_design`, `build_pack`. Apps without prompt menus can use the `get_playbook` tool; `list_knowledge` / `get_knowledge` read any topic.

## 4c. Bring in a file from another CAD program

Put the file in the `imports` folder inside the output folder (`contrapt-out/imports`), then ask: "Inspect and import
`Bracket.step`." STEP files import as exact solids you can measure and edit. **Inventor files (.ipt, .iam, .idw)** are a
closed format. Contrapt cannot read their geometry yet, but `inspect_file` does read, without Inventor installed, the
Inventor version, part number and material, and the **preview image**, which a capable AI can look at. It also tells the
AI how to export STEP from Inventor (File > Export > CAD Format > STEP) for an exact import, and the
`recreate_from_reference` playbook rebuilds a part approximately from the preview plus a few measurements. Direct
geometry reading is planned. Files are only read from that folder, by plain name.

### Optional: convert native CAD files with an external converter

Install the open-source [cadmpeg](https://github.com/cadmpeg/cadmpeg) command-line converter yourself (it is Rust; the
first build downloads the Rust version the project pins and takes roughly 10 minutes; the program is about 80 MB):

```bash
git clone https://github.com/cadmpeg/cadmpeg.git
cd cadmpeg
cargo build --release --locked -p cadmpeg --no-default-features --features inventor,step
# the program is now target/release/cadmpeg  (cadmpeg.exe on Windows)
```

Then start Contrapt
with `--cadmpeg <path to cadmpeg>` (or set `CONTRAPT_CADMPEG`) and the AI can call `convert_file` on a file in the imports
folder (Inventor `.ipt`/`.iam`, Fusion, SolidWorks, ...). It writes `<name>.converted.step`, which `import_file` then reads. Only
you choose which program runs; the AI cannot pass options, and it only touches files in the imports folder. Support for
newer file versions varies: always check the imported size with `measure`. Verified so far on one real Inventor 2026.4 part (the
geometry converts and imports exactly; sketches, features and history are not transferred).

## 5. Tools at a glance

| Tool | What it does |
|---|---|
| `get_docs` | Conventions (axes, planes, units), every step type, selectors, workflow, examples |
| `new_model`, `set_param` | Start fresh; create or change a named parameter or expression |
| `add_step` | Add one step: box, cylinder, sphere, sketch, constrained_sketch, extrude, revolve, loft, sweep, fillet, chamfer, shell, boolean, transform, hole, pattern, mirror, mate, material, import |
| `run_script` | Build the whole model from one short script (compiles to the same steps) |
| `suppress_step`, `remove_step` | Edit the timeline |
| `get_model`, `measure` | Full timeline and build report; volume, area, centre of mass, mass, bounding box |
| `mass_properties` | Centre of mass, full inertia tensor, principal moments, inertia about any axis |
| `check_interference`, `check_assembly`, `bom`, `motion_check` | Overlap/gap between two bodies; all pairs; bill of materials with mass; sweep a body and find the first collision |
| `section_properties`, `beam_check`, `column_check` | Cross-section properties and hand-calculation beam and column checks |
| `frame_analysis`, `frame_modes`, `frame_buckling` | 3D beam-element FEA: stress and deflection, natural frequencies, Euler buckling load factors |
| `solid_fea` | Stress and displacement of a solid body on a fitted hexahedral grid |
| `solid_modes` | Natural frequencies and mode shapes of a solid body, given its supports |
| `thermal_analysis` | Steady-state heat conduction and convection in a solid (heat paths, temperatures, heat balance), with optional thermal stress |
| `mechanism_sweep`, `fourbar_check`, `dynamics_sim` | Planar linkage kinematics, four-bar Grashof analysis, 1-DOF dynamics in SI units |
| `print_check` | FDM overhangs, support estimate, best print orientation, thin walls, build-volume fit |
| `drawing` | SVG drawing sheet: three views, hidden lines, overall dimensions, title block |
| `add_spec`, `remove_spec`, `check_specs`, `optimize_param` | The Proof Loop: requirements, verdict, one-parameter optimisation |
| `journal_add`, `get_journal`, `build_pack` | Design Journal and the Build Pack (README with verdict, STEP and STL per part) |
| `export_model` | STEP (exact CAD) or STL (3D printing) into the output folder |
| `save_model`, `load_model`, `list_models` | Keep work between sessions (specs and journal are saved with the model) |
| `view` | The live viewer link |
| `render_view` | Render the model to images (iso, top, front, ...) so the AI can see its own work |
| `convert_file` | (optional) convert a native CAD file to STEP with a converter you enabled |
| `inspect_file`, `import_file` | Identify a file from another CAD program; import a STEP as an exact body |
| `get_playbook`, `list_knowledge`, `get_knowledge` | Expert prompts and engineering knowledge for any client |

## 6. Troubleshooting

- **"Cannot find module" or syntax errors on start:** your Node is too old. Check `node -v` is 22.18 or newer.
- **The AI app shows no tools:** run the command from step 3 in a terminal. It should print `viewer:` and
  `MCP server ready on stdio` to stderr and then wait. Any other output means a setup problem.
- **Viewer address already in use:** Contrapt tries the next ports automatically; the address is printed at
  startup and returned by the `view` tool. Use `--no-viewer` to turn the viewer off.
- **Nothing in the viewer:** the model is empty until the AI adds a step. The viewer says so.
