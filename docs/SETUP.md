# Setting up Contrapt with your AI

Contrapt is an MCP server. Any AI app that can run a local MCP server can drive it. When the server
starts it also opens a **live 3D viewer** on localhost, so you can watch the model appear as the AI builds it.

> **Status: early.** Contrapt is pre-release. The stdio server below is tested end to end with the official
> MCP client library. It has not yet been verified inside every AI app; if one misbehaves, please open an
> issue with the app name and what you saw.

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

In every case the server command is the same:

```
node /path/to/Contrapt/packages/mcp/src/cli.ts
```

Replace `/path/to/Contrapt` with where you cloned it (on Windows, something like `C:\path\to\Contrapt`).
Exports and saved models go in a `contrapt-out` folder in the directory the AI app starts the server from;
change it with `--out /some/folder` or the `CONTRAPT_OUT` environment variable.

### Claude Code

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

### ChatGPT and other remote-only apps

These connect to MCP servers over the internet (HTTP), not local stdio, and Contrapt does not have an HTTP
transport yet. It is on the roadmap (see [FEATURES.md](FEATURES.md), P9). Until then, use a client that
supports local stdio servers.

## 4. First prompts to try

- "Call get_docs, then model a 60 × 40 × 6 mm mounting plate with four 5 mm holes, 4 mm rounded corners, and
  a 9 mm radius boss in the middle. Measure it and show me the viewer link."
- "Make the plate thickness a parameter, then change it to 10 mm."
- "Export it as STEP and STL."

The AI gets a build report after every change (which steps worked, plus measured volume, size and centre of
mass), so it can check its own work and fix mistakes.

## 5. Tools at a glance

| Tool | What it does |
|---|---|
| `get_docs` | Conventions (axes, planes, units), step types, selectors, workflow, examples |
| `new_model`, `set_param` | Start fresh; create or change a named parameter or expression |
| `add_step` | Add one step: box, cylinder, sphere, sketch, extrude, fillet, chamfer, shell, boolean, transform |
| `run_script` | Build the whole model from one short script (compiles to the same steps) |
| `suppress_step`, `remove_step` | Edit the timeline |
| `get_model`, `measure` | Full timeline and build report; volume, area, centre of mass, bounding box |
| `export_model` | STEP (exact CAD) or STL (3D printing) into the output folder |
| `save_model`, `load_model`, `list_models` | Keep work between sessions |
| `view` | The live viewer link |

## 6. Troubleshooting

- **"Cannot find module" or syntax errors on start:** your Node is too old. Check `node -v` is 22.18 or newer.
- **The AI app shows no tools:** run the command from step 3 in a terminal. It should print `viewer:` and
  `MCP server ready on stdio` to stderr and then wait. Any other output means a setup problem.
- **Viewer address already in use:** Contrapt tries the next ports automatically; the address is printed at
  startup and returned by the `view` tool. Use `--no-viewer` to turn the viewer off.
- **Nothing in the viewer:** the model is empty until the AI adds a step. The viewer says so.
