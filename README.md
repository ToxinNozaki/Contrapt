# Contrapt

**Open-source, AI-drivable CAD and simulator that proves a design works before you build it.**

> Status: early development — foundations only. Follow progress in [docs/FEATURES.md](docs/FEATURES.md).

Contrapt is a lightweight parametric 3D CAD app with a built-in
[Model Context Protocol](https://modelcontextprotocol.io) server, so an AI assistant (Claude, ChatGPT,
or a local model) can model, measure, simulate, and export a part or assembly — while you watch live in a
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
