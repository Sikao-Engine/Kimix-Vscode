# KimiX Code — VS Code Plugin

A VS Code extension for AI-assisted, in-repo development, driven by an
**opencode-compatible** server over HTTP + SSE.

The extension is deliberately **decoupled from any API key**. Its only hard
requirement is a configurable executable that supports
`<exe> serve --hostname <h> --port <p>` and the opencode HTTP/SSE protocol
(`kimix.executable`, default `opencode`).

## Features

- **Model selection** and **Agent selection** from the server's catalogue
- **Plan Mode** toggle (plan-only prompt decoration)
- **Compact context** button (server-side summarization)
- **Session management** — create / switch / delete, live transcript, now via a
  compact toolbar dropdown instead of a fixed side rail
- **Streaming** assistant text, reasoning, and tool calls over SSE with
  automatic reconnect, skeleton loaders, and auto-scroll
- **Reasoning collapse** — fold/unfold individual thinking blocks or all at once
- **Model labels** — every assistant message shows the provider/model that
  generated it; switching models does not rewrite history
- **@ file/symbol mentions** — reference workspace files and symbols directly
  from the composer
- **Pending queue** — stack follow-up prompts while the model is busy; edit,
  delete, or lock the next one
- **Instant stop** — Stop immediately frees the composer; the backend aborts
  asynchronously
- **Inline permission** prompts (allow once / always / reject)
- Sidebar view **and** editor-tab surfaces sharing one state

## Structure

```
packages/
  vscode-ext/    Extension host (Node / VS Code APIs, esbuild)
  webview-ui/    React + Vite + Zustand frontend
docs/            Architecture, protocol, webview, sessions, testing
```

## Develop

```
pnpm install
pnpm build-ext
pnpm --filter kimix-vscode-ext run test        # extension unit tests
pnpm --filter kimix-webview-ui run test        # frontend store tests
pnpm package-ext
```

Press `F5` in `packages/vscode-ext` to launch the Extension Development Host.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layering & data flow
- [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — HTTP/SSE + host↔webview contract
- [`docs/WEBVIEW.md`](docs/WEBVIEW.md) — webview surfaces & CSP
- [`docs/SESSIONS.md`](docs/SESSIONS.md) — session lifecycle & streaming
- [`docs/TESTING.md`](docs/TESTING.md) — tests & acceptance flow
