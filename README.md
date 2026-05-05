# Kimi Code (TypeScript Reconstruction)

This directory contains a TypeScript reconstruction of the Kimi Code VS Code extension.

## Background

The original source files (`src/`) were not present in the workspace — only the compiled `dist/` output remained. This TypeScript source has been reverse-engineered from the bundled JavaScript (`dist/extension.js` and `dist/webview.js`) using deep static analysis.

## Structure

- `src/` — Extension backend (Node.js / VS Code APIs)
- `webview-ui/` — React webview frontend (Vite + Tailwind + Zustand)

## Build

```bash
# Extension backend
pnpm install
pnpm run typecheck
pnpm run build:extension

# Webview frontend
pnpm --filter @moonshot-ai/vscode_extension-webview-ui build
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a detailed breakdown of the system design.

## Key Features Reconstructed

- **JSON-RPC CLI Client** — Spawns and communicates with the `kimi` CLI
- **Session Management** — Conversation forking, history, turn tracking
- **File Baseline Tracking** — Tracks AI-generated file changes with revert capability
- **Bridge / RPC Layer** — 50+ typed methods between webview and extension
- **React Webview UI** — Streaming chat with tool call visualization
- **MCP Integration** — Model Context Protocol server management
- **Auth Flow** — Login/logout with device code flow

## Notes

Some implementation details (especially CLI download logic and exact SDK schemas) are approximations based on the compiled output. The architecture and public APIs are faithful reconstructions.
