# contrapt

**Open-source, AI-drivable parametric CAD with a built-in MCP server and a live 3D viewer.** The AI doesn't just draw it, it proves it works.

```bash
# Claude Code
claude mcp add contrapt -- npx -y contrapt

# Claude Desktop / LM Studio / most editors: add to your MCP servers
{ "mcpServers": { "contrapt": { "command": "npx", "args": ["-y", "contrapt"] } } }
```

Then ask your AI to design something. A live viewer opens on localhost (the address is printed on stderr and returned by the `view` tool).

Options: `--out <folder>` (exports, saved models, imports), `--no-viewer`, `--port 4317`, `--http [port] --token <secret>` (MCP over HTTP),
`--cadmpeg <path>` (optional converter for Inventor and other native CAD files).

Needs Node.js 20+. Full documentation, the roadmap and the feature ledger: https://github.com/ToxinNozaki/Contrapt

MIT licensed. Third-party components are listed in NOTICE.md. Not affiliated with Autodesk, Anthropic or OpenAI.
