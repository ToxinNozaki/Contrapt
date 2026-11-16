# Contrapt

**Open-source, AI-drivable CAD and simulator that proves a design works before you build it.**

> **Status: early (pre-release).** You can already drive Contrapt from an AI and watch the part appear live.
> Progress: [docs/ROADMAP.md](docs/ROADMAP.md) · [docs/FEATURES.md](docs/FEATURES.md)

## Quick start

Needs Node.js 22.18+.

```bash
git clone https://github.com/ToxinNozaki/Contrapt.git
cd Contrapt && npm install
npm run demo -w @contrapt/mcp     # sample bracket in the live viewer
```

Then connect your AI (Claude Code, Claude Desktop, LM Studio…) — step-by-step in [docs/SETUP.md](docs/SETUP.md).
For Claude Code it is one line:

```bash
claude mcp add contrapt -- node /path/to/Contrapt/packages/mcp/src/cli.ts
```

**What works today:** parametric parts (box, cylinder, sphere, sketch + extrude, fillet, chamfer, shell,
booleans, transforms) with named parameters and expressions; build either by tool calls or by script; a
per-step build report with measured volume, size and centre of mass after every change; STEP and STL
export; save/load; a live 3D viewer with dimension callouts; STEP import (and clear guidance for Inventor and other CAD files);
**18 engineering knowledge packs and 10 expert playbooks** (design a part, review a design, strength check, size a mechanism,
and more) so an AI works like a design engineer, not just a modeller.

Contrapt is a lightweight parametric 3D CAD app with a built-in
[Model Context Protocol](https://modelcontextprotocol.io) server, so an AI assistant (Claude, a local
model, and more) can model, measure, and export parts — with simulation and assemblies on the roadmap — while you watch live in a
browser viewer. It is an open-source alternative to tools like Autodesk Inventor, built for inventing.

## The idea: the Proof Loop

Most AI-CAD tools stop at "the AI drew a shape." Contrapt makes the AI **prove** it:

1. State requirements as code (`mass < 200 g`, `deflection < 1 mm at 50 N`, `fits 100×100×100`).
2. Build the model; the engine checks every requirement after every change, with numbers.
3. Simulate (stress, vibration, motion) and let the optimizer tune parameters until it passes.
4. Export a **Build Pack**: BOM, cut list, STEP/STL/DXF, drawings, assembly steps.

## Roadmap

See [docs/FEATURES.md](docs/FEATURES.md) (full feature ledger) and [docs/DESIGN.md](docs/DESIGN.md) (design and
architecture). Setup guides for each AI client will land with the first MCP release.

## License

MIT — see [LICENSE](LICENSE). Third-party components are listed in [NOTICE.md](NOTICE.md).
Not affiliated with Autodesk, Anthropic, or OpenAI.
