# KimiX Code — Architecture

KimiX Code is a VS Code extension that drives an **opencode-compatible** AI
coding server over plain HTTP + SSE. It has **no API-key dependency**: the only
hard requirement is a configurable executable that exposes the
`<exe> serve --hostname <h> --port <p>` interface and the opencode HTTP/SSE
protocol.

## Monorepo layout

```
packages/
  vscode-ext/        Extension host (Node / VS Code APIs, esbuild bundle)
    src/
      extension.ts            Activation + command registration
      config.ts               Reads kimix.* settings
      logger.ts               OutputChannel wrapper
      protocol/
        types.ts              Wire types (Session/Agent/Provider/Message)
        sseParser.ts          SSE line parser + opencode event decoder
        client.ts             HTTP + SSE client (native fetch, no vscode dep)
        messages.ts           Host <-> Webview message contract
      server/
        serverProcess.ts      Low-level spawn, port alloc, health poll, & process-tree cleanup
        serverManager.ts      Lifecycle manager: PID file, reuse, own, exit safety net
      serverStatusBar.ts      Status-bar item + quick-pick server menu
      session/
        sessionManager.ts     Active-session stream + session list
      controller/
        kimixController.ts    Orchestrator + webview message bridge
      webview/
        webviewManager.ts     Sidebar provider + tab panel + HTML/CSP
    tests/                    Vitest unit tests (+ vscode mock)
  webview-ui/        React + Vite + Zustand frontend
    src/
      main.tsx, App.tsx
      store.ts, vscodeApi.ts, protocol.ts
      components/             Toolbar, MessageList, Composer, SessionList, ...
```

## Layering & decoupling

The dependency direction is strictly one-way:

```
extension.ts
  ├─ controller/KimixController
  │    ├─ server/ServerLifecycleManager (process lifecycle + PID file)
  │    │    └─ server/ServerProcess     (low-level child process)
  │    ├─ protocol/OpencodeClient       (HTTP + SSE)        ← no vscode import
  │    │    └─ protocol/sseParser       (pure functions)    ← no vscode import
  │    └─ session/SessionManager        (stream orchestration) ← no vscode import
  ├─ serverStatusBar                    (status-bar UI)
  └─ webview/webviewManager → controller (message bridge)
```

- `protocol/*`, `session/*` and `server/*` contain **zero `vscode` imports**, so
  they are unit-testable with plain Vitest and reusable outside the editor.
- The webview never talks to the server directly; everything flows through the
  controller's typed message bridge.

## Data flow (a single prompt)

```
User types in Composer
  → postToHost({ sendPrompt })
  → KimixController.dispatch
  → SessionManager.sendPrompt
  → OpencodeClient.sendPromptAsync (POST /session/:id/prompt_async, 204)

Server streams over GET /event (global SSE)
  → OpencodeClient.streamEvents (reconnecting)
  → sseParser.parseEvent (filters by sessionID)
  → SessionManager emits text/tool/idle/permission
  → KimixController.post → webview.postMessage
  → store.applyHostMessage → React re-render
```

See `docs/PROTOCOL.md`, `docs/WEBVIEW.md`, `docs/SESSIONS.md` for details.

## Lifecycle

### Extension activation / deactivation

```
activate()
  └─ KimixController (context.subscriptions.push)
       └─ ServerLifecycleManager.start()
            ├─ read PID file → probe base port
            ├─ reuse/adopt or spawn on free port
            └─ write PID file

deactivate() / VS Code subscriptions dispose
  └─ KimixController.dispose() (async)
       └─ ServerLifecycleManager.stop() (async)
            ├─ killWindows()  — taskkill /t /f (Windows)
            └─ killUnix()     — SIGTERM → 3s → SIGKILL (Unix)
            └─ delete PID file

Process-exit safety net (extension host crash)
  └─ process.on('exit' | 'SIGTERM' | 'SIGINT' | 'SIGHUP')
       └─ ServerLifecycleManager synchronous cleanup
            ├─ unlink PID file
            └─ kill owned child (best-effort)
```

The controller is registered with `context.subscriptions.push(controller)`, but
`deactivate()` also explicitly calls `await _controller.dispose()` as a
fallback for abrupt shutdown scenarios.

## Build

```
pnpm install
pnpm --filter kimix-vscode-ext run build     # webview → copy → esbuild
pnpm --filter kimix-vscode-ext run package    # produce .vsix
```

## Configuration (`kimix.*`)

| Setting                      | Default       | Purpose                                   |
| ---------------------------- | ------------- | ----------------------------------------- |
| `kimix.executable`           | `opencode`    | Server CLI name or absolute path          |
| `kimix.host`                 | `127.0.0.1`   | Bind host                                 |
| `kimix.basePort`             | `4096`        | Starting port (scans upward if taken)     |
| `kimix.environmentVariables` | `{}`          | Extra env vars for the server process     |
| `kimix.showThinking`         | `true`        | Show reasoning content in the UI          |
