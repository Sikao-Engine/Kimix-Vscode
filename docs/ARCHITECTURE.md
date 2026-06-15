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
        serverManager.ts      Lifecycle manager: PID file, reuse, exit safety net
      serverStatusBar.ts      Status-bar item + quick-pick server menu
      session/
        sessionManager.ts     # Active-session stream + session list
      plan/
        planManager.ts        # Plan-mode orchestrator (no vscode import)
        planPrompts.ts        # Pure prompt templates
      controller/
        kimixController.ts    # Orchestrator + webview message bridge
      webview/
        webviewManager.ts     Sidebar provider + tab panel + HTML/CSP
    tests/                    Vitest unit tests (+ vscode mock)
  webview-ui/        React + Vite + Zustand frontend
    src/
      main.tsx, App.tsx
      store.ts, vscodeApi.ts, protocol.ts
      components/             Toolbar, MessageList, Composer, PendingQueue, ReasoningBlock, PermissionPrompt, ...
    tests/                    Vitest + jsdom store tests
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
  │    ├─ session/SessionManager        (stream orchestration) ← no vscode import
  │    └─ plan/PlanManager              (plan file + review loop) ← no vscode import
  ├─ serverStatusBar                    (status-bar UI; shows plan phase when active)
  └─ webview/webviewManager → controller (message bridge)
```

- `protocol/*`, `session/*` and `server/*` contain **zero `vscode` imports**, so
  they are unit-testable with plain Vitest and reusable outside the editor.
- The webview never talks to the server directly; everything flows through the
  controller's typed message bridge.

## Data flow

### Single prompt

```
User types in Composer
  → postToHost({ sendPrompt, turnId })
  → KimixController.dispatch
  → SessionManager.sendPrompt
  → OpencodeClient.sendPromptAsync (POST /session/:id/prompt_async, 204)

Server streams over GET /event (global SSE)
  → OpencodeClient.streamEvents (reconnecting)
  → sseParser.parseEvent (filters by sessionID)
  → SessionManager emits text/tool/idle/permission
  → KimixController.post (attaches turnId) → webview.postMessage
  → store.applyHostMessage → React re-render
```

### Plan Mode

```
User toggles Plan Mode → types requirement → Composer.send()
  → postToHost({ generatePlan, text, turnId })
  → KimixController.dispatch
  → PlanManager.enterPlanning(requirement)
       → resolve & delete stale plan file
       → create/select planning session via OpencodeClient
       → send planner prompt (agent or decorated fallback)
       → consume planning SSE stream
       → buffer text; on idle flush to plan file
       → emit planState({ phase: "reviewing", planFile })
  → host opens plan file in editor (if enabled)
  → webview renders PlanReview: Implement / Revise / Discard

Implement  → PlanManager.implementPlan() → send plan to regular session → follow-up review prompt
Revise     → PlanManager.revisePlan(feedback) → regenerate plan file
Discard    → PlanManager.discardPlan() → delete plan file → phase idle
```

### Pending queue & turn id

The webview keeps a local **pending queue**. When the user sends while the model
is busy, the prompt is enqueued instead of being dropped. When `streamIdle`
arrives for the matching `turnId`, the locked (next) queued prompt is sent
automatically.

```
Composer.send() while busy
  → store.enqueuePrompt(text)
  → PendingQueue renders above Composer

streamIdle for current turnId
  → store.applyHostMessage
  → if pending has locked item: sendPrompt(locked, newTurnId)
  → else: busy=false, refresh messages
```

### Stop / abort

Clicking **Stop** immediately clears `busy` and `activeTurnId` in the webview,
then asks the host to abort in the background. Any late SSE events carrying the
old `turnId` are ignored by the store.

```
Stop click
  → store.stopGeneration(): busy=false, activeTurnId=undefined
  → postToHost({ abort, turnId })
  → KimixController aborts the session asynchronously
  → posts { aborted, turnId } to the webview
```

### @ file / symbol mentions

```
User types '@' in Composer
  → MentionPicker opens
  → requestFileList / requestWorkspaceSymbols
  → Host: workspace.findFiles / executeWorkspaceSymbolProvider
  → fileList / workspaceSymbols pushed to webview
  → User selects item
  → Attachment chip rendered in Composer
  → Send prepends '@path' references to the prompt text
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
```

Process-exit safety net (extension host crash)
  └─ process.on('exit' | 'SIGTERM' | 'SIGINT' | 'SIGHUP')
       └─ ServerLifecycleManager synchronous cleanup
            ├─ unlink PID file
            └─ kill owned child (best-effort)

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
| `kimix.autoScroll`           | `true`        | Auto-scroll during streaming              |
| `kimix.enableMentions`       | `true`        | Enable @ file/symbol mentions             |
| `kimix.planModeEnabled`      | `true`        | Enable full plan-mode workflow            |
| `kimix.planFilePath`         | `.kimix/plan.md` | Relative path for generated plans      |
| `kimix.planAgent`            | `""`          | Agent name for planning; empty = auto-detect/fallback |
| `kimix.planMaxAttempts`      | `3`           | Max plan generation/revision attempts     |
| `kimix.openPlanFileAfterGeneration` | `true` | Open plan file in editor after planning |
